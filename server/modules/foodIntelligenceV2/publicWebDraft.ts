/** #1308: gated text/audio web review flow with short-lived structured state. */
import { randomUUID } from "node:crypto";
import { zonedDateTimeLocalToIso } from "../../../shared/timeZone";
import type { FoodD1WebDraft } from "../../../shared/foodD1WebDraft";
import type { ProcessMealDraftInput } from "../meals/schemas";
import { transcribeAudio } from "../../_core/voiceTranscription";
import { createFoodV2KnowledgeRepository } from "./repository";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import {
  buildD1OperationPlan,
  type FoodD1Dependencies,
  type FoodD1Request,
  type FoodD1Result,
} from "./entrypointMigration";
import {
  createFoodD1RouteDbStore,
} from "./entrypointRouteRepository";
import {
  isCurrentFoodD1GateApproval,
  isFoodD1EntrypointCutoverRequested,
  isD1V1Route,
  isD1V2Route,
  isFoodD1VisualCutoverRequested,
  isValidD1OperationId,
  routeFoodD1Operation,
  type FoodD1RouteStore,
} from "./entrypointRouting";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { FoodObservation } from "./schemas";
import { coalesceEquivalentMultimodalEvidence } from "./multimodalEvidence";
import { traceFoodD1WebSubmission, checkedFoodD1WebReplay } from "./publicWebDraftIdentity";
import { isConfirmedFoodD1WebDraft } from "./publicWebDraftRepository";
import {
  FOOD_AUDIO_TRANSCRIPT_INPUT_TYPE,
  FOOD_MULTIMODAL_INPUT_TYPE,
  FOOD_TEXT_INPUT_TYPE,
} from "./contracts";
import {
  extractD1VisualSurfaces,
  isValidD1VisualContentDigest,
  parseFoodD1VisualKind,
  type FoodD1VisualSurfaces,
  type FoodD1VisualKind,
} from "./publicVisualSurfaces";
import { buildEnvelope, buildDependencies, toReviewItem } from "./publicWebDraftSupport";
import { readFoodD1PublicContextSources } from "./publicContextSources";
import { createFoodD1PublicWebDraftConfirmation } from "./publicWebDraftConfirmation";
export { FoodD1WebDraftNotFoundError, hashFoodD1WebDraftConfirmation } from "./publicWebDraftConfirmation";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import {
  getFoodD1WebDraft,
  getFoodD1WebDraftByOperationKey,
  saveFoodD1WebDraft,
  type FoodD1WebDraftRecord,
} from "./publicWebDraftRepository";

export type PublicD1WebDraftDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  readContextSources?: typeof readFoodD1PublicContextSources;
  lexicon?: LinguisticLexiconStore;
  knowledge?: FoodD1Dependencies["knowledge"];
  comprehend?: typeof comprehendFoodLanguage;
  buildPlan?: typeof buildD1OperationPlan;
  routeStore?: FoodD1RouteStore;
  saveDraft?: typeof saveFoodD1WebDraft;
  readDraft?: typeof getFoodD1WebDraft;
  readDraftByOperationKey?: typeof getFoodD1WebDraftByOperationKey;
  run?: typeof runFoodD1Migration;
  transcribe?: typeof transcribeAudio;
  extractVisualSurfaces?: (input: {
    image: NonNullable<ProcessMealDraftInput["image"]>;
    kind: FoodD1VisualKind;
  }) => Promise<FoodD1VisualSurfaces>;
};

const unavailablePublicD1WebDraftContext: PublicD1WebDraftDependencies = {
  readAuthorizedContext: async () => null,
};

function mediaDataUrl(media: NonNullable<ProcessMealDraftInput["audio"]>): string {
  return media.base64.startsWith("data:")
    ? media.base64
    : `data:${media.mimeType};base64,${media.base64}`;
}

function operationKey(userId: number, operationId: string): string {
  return `d1-web-${userId}:${operationId}`;
}

function isD1WebDraftResult(value: unknown): value is FoodD1Result {
  return Boolean(value && typeof value === "object" &&
    "schemaVersion" in value && value.schemaVersion === 2 &&
    "entrypoint" in value && "items" in value &&
    Array.isArray(value.items) && "committed" in value && value.committed === false);
}

function getStoredRecord(record: FoodD1WebDraftRecord): FoodD1WebDraft {
  if (isConfirmedFoodD1WebDraft(record)) {
    throw new Error("food-d1-web-draft-operation-already-confirmed");
  }
  return record.payload.draft;
}

export function createFoodD1PublicWebDraft(deps: PublicD1WebDraftDependencies) {
  const comprehend = deps.comprehend ?? comprehendFoodLanguage;
  const buildPlan = deps.buildPlan ?? buildD1OperationPlan;

  async function tryRunFoodD1PublicWebDraft(input: {
    userId: number;
    request: ProcessMealDraftInput;
    timeZone: string;
  }): Promise<FoodD1WebDraft | null> {
    const request = input.request;
    if (request.source !== "web") return null;
    const hasText = Boolean(request.text?.trim());
    const hasAudio = Boolean(request.audio);
    const hasImage = Boolean(request.image);
    const visualSelection = hasImage ? parseFoodD1VisualKind(request.imageKind) : null;
    const visualKind = visualSelection?.kind ?? null;
    // Image role is explicitly chosen by the user, never guessed from a caption.
    // A nutrition-label continuation requires an existing physical item and
    // separately verified source evidence: a new web draft cannot authorize it.
    const combinesInputs = Boolean((hasImage && visualKind && (hasText || hasAudio)) ||
      (hasText && hasAudio));
    const entrypoint: FoodD1WebDraft["entrypoint"] | null = hasImage && visualKind
      ? combinesInputs ? FOOD_MULTIMODAL_INPUT_TYPE : visualKind
      : hasText && hasAudio
        ? FOOD_MULTIMODAL_INPUT_TYPE
        : hasText ? FOOD_TEXT_INPUT_TYPE
          : hasAudio ? FOOD_AUDIO_TRANSCRIPT_INPUT_TYPE : null;
    // A stable web submission already owned by V2 must never be reinterpreted
    // by V1 after the flag is disabled or the user changes modality. Check the
    // durable route before returning null to the public V1 draft handler.
    if (Number.isSafeInteger(input.userId) && input.userId > 0 &&
        isValidD1OperationId(request.d1OperationId ?? "")) {
      const pinned = await (deps.routeStore ?? createFoodD1RouteDbStore())
        .readPinnedRoute(operationKey(input.userId, request.d1OperationId!), input.userId);
      if (isD1V2Route(pinned?.resolver)) {
        if (!entrypoint || pinned.originEntrypoint !== entrypoint) {
          throw new Error("food-d1-entrypoint-changed-during-operation");
        }
        if (!isFoodD1EntrypointCutoverRequested(pinned.originEntrypoint)) {
          throw new Error("food-d1-operation-paused-by-rollback");
        }
      }
      if (isD1V1Route(pinned?.resolver)) return null;
    }
    if (!entrypoint) {
      if (hasImage && isFoodD1VisualCutoverRequested()) {
        throw new Error("food-d1-public-web-image-role-required");
      }
      return null;
    }
    if (!isFoodD1EntrypointCutoverRequested(entrypoint)) return null;
    if (hasImage && !visualKind) {
      throw new Error("food-d1-public-web-image-role-required");
    }
    if (hasImage && visualKind &&
        (!isFoodD1EntrypointCutoverRequested(visualKind) ||
        (combinesInputs &&
          !isFoodD1EntrypointCutoverRequested(FOOD_MULTIMODAL_INPUT_TYPE)))) {
      throw new Error("food-d1-public-web-image-rollout-incomplete");
    }
    if (!Number.isSafeInteger(input.userId) || input.userId <= 0 ||
        !isValidD1OperationId(request.d1OperationId ?? "") ||
        !request.mealLabel?.trim() || !request.occurredAt?.trim()) {
      throw new Error("food-d1-public-web-draft-operation-required");
    }
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-web-draft-gate-unavailable");
    }

    const now = new Date();
    const occurredAt = new Date(zonedDateTimeLocalToIso(request.occurredAt, input.timeZone));
    if (!Number.isFinite(occurredAt.getTime())) {
      throw new Error("food-d1-public-web-draft-invalid-time");
    }
    const operationKeyValue = operationKey(input.userId, request.d1OperationId!);
    const traceId = traceFoodD1WebSubmission({
      operationKey: operationKeyValue, entrypoint, request,
    });
    // A bound V2 operation recovers its original server-side review. Missing
    // storage is not permission to return V1 or silently regenerate facts.
    const prior = await (deps.readDraftByOperationKey ?? getFoodD1WebDraftByOperationKey)({
      ownerUserId: input.userId, operationKey: operationKeyValue,
    });
    if (prior) return checkedFoodD1WebReplay({
      record: prior, operationKey: operationKeyValue, traceId,
      entrypoint, ownerUserId: input.userId,
      mealLabel: request.mealLabel.trim(), occurredAt,
      timeZone: input.timeZone, revisions: context.revisions,
    });
    // Query authenticated sources once per new operation, before any AI/provider.
    // A pinned replay always reuses its persisted context instead.
    const contextSources = await (deps.readContextSources ?? readFoodD1PublicContextSources)({
      ownerUserId: input.userId, source: "web", at: occurredAt,
    });
    let transcript: string | undefined;
    if (request.audio) {
      const transcription = await (deps.transcribe ?? transcribeAudio)({
        audioBase64: mediaDataUrl(request.audio),
        mimeType: request.audio.mimeType,
        language: "pt",
        prompt: "Transcreva a refeição narrada pelo usuário com foco em alimentos e porções.",
      }, {
        observability: { origin: "web", flow: "voice_transcription" },
      });
      if ("error" in transcription || !transcription.text.trim()) {
        throw new Error("food-d1-public-web-audio-transcription-unavailable");
      }
      transcript = transcription.text;
    }

    const visual = hasImage && visualKind
      ? await (deps.extractVisualSurfaces ?? extractD1VisualSurfaces)({
        image: request.image!, kind: visualKind,
      }) : null;
    if (visual && (!isValidD1VisualContentDigest(visual.contentDigest) ||
        !Array.isArray(visual.surfaces) || visual.surfaces.length === 0 ||
        visual.surfaces.length > 30 ||
        visual.surfaces.some(surface => typeof surface !== "string" ||
          !surface.trim() || surface.length > 240))) {
      throw new Error("food-d1-public-web-visual-evidence-invalid");
    }
    const envelope = buildEnvelope({
      userId: input.userId,
      operationKey: operationKeyValue,
      traceId,
      mealLabel: request.mealLabel.trim(),
      occurredAt,
      timeZone: input.timeZone,
      entrypoint,
      revisions: context.revisions,
      contextSources,
    });

    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    const textObservations: FoodObservation[] = [];
    const transcriptObservations: FoodObservation[] = [];
    if (hasText) {
      const parsed = await comprehend({
        rawText: request.text!.trim(),
        sourceRef: `${operationKeyValue}:text`,
        modality: FOOD_TEXT_INPUT_TYPE,
        ownerUserId: input.userId,
        lexiconRevision: context.revisions.lexicon,
        locale: "pt-BR",
        now,
      }, lexicon);
      textObservations.push(...parsed);
    }
    if (transcript) {
      const parsed = await comprehend({
        rawText: transcript,
        sourceRef: `${operationKeyValue}:audio`,
        modality: "audio_transcript",
        ownerUserId: input.userId,
        lexiconRevision: context.revisions.lexicon,
        locale: "pt-BR",
        now,
      }, lexicon);
      transcriptObservations.push(...parsed);
    }
    const imageObservations: FoodObservation[] = [];
    if (visual && visualKind) {
      for (const [index, surface] of visual.surfaces.entries()) {
        imageObservations.push(...await comprehend({
          rawText: surface,
          // Preserve a verifiable media fingerprint without any image bytes,
          // signed URL, original filename, or user-supplied caption.
          sourceRef: `d1-image:${visual.contentDigest}:${index}`,
          modality: "image",
          imageRegionRole: visualSelection!.imageRegionRole,
          ownerUserId: input.userId,
          lexiconRevision: context.revisions.lexicon,
          locale: "pt-BR",
          now,
        }, lexicon));
      }
    }
    let observations: FoodObservation[] = [...textObservations, ...transcriptObservations, ...imageObservations];
    if (combinesInputs) {
      const pairedTextAudio = textObservations.length && transcriptObservations.length
        ? coalesceEquivalentMultimodalEvidence(textObservations, transcriptObservations)
        : [...textObservations, ...transcriptObservations];
      observations = imageObservations.length
        ? coalesceEquivalentMultimodalEvidence(pairedTextAudio, imageObservations)
        : pairedTextAudio;
    }
    if (!observations.length) throw new Error("food-d1-public-web-draft-no-observations");
    const evidence = { kind: "structured" as const, observations };
    const d1Request: FoodD1Request = {
      authenticatedUserId: input.userId,
      entrypoint,
      envelope,
      evidence,
      now,
    };
    const d1Dependencies = buildDependencies({
      userId: input.userId,
      entrypoint,
      evidence,
      lexicon,
      knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
    });
    const plan = await routeFoodD1Operation<FoodD1Result>({
      envelope,
      authenticatedUserId: input.userId,
      entrypoint,
      source: "web",
      store: deps.routeStore ?? createFoodD1RouteDbStore(),
      expectedAuditedBaseSha: context.expectedAuditedBaseSha,
      verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
      runV1: async () => { throw new Error("food-d1-public-web-draft-cannot-replay-v1"); },
      runV2: () => buildPlan(d1Request, d1Dependencies),
    });
    if (!isD1WebDraftResult(plan) || plan.items.length !== observations.length) {
      throw new Error("food-d1-public-web-draft-invalid-plan");
    }

    const draftId = randomUUID();
    const draftBase = {
      resolver: "food-v2" as const,
      operationKey: operationKeyValue,
      entrypoint,
      mealLabel: request.mealLabel.trim(),
      occurredAt: occurredAt.toISOString(),
      items: plan.items.map(toReviewItem),
    };
    const stored = await (deps.saveDraft ?? saveFoodD1WebDraft)({
      draftId,
      ownerUserId: input.userId,
      operationKey: operationKeyValue,
      now,
      payload: {
        draft: draftBase,
        envelope,
        occurredAt,
        observations: observations.map(observation => ({
          ...observation, rawInput: null, normalizedInput: null,
        })),
      },
    });
    return getStoredRecord(stored);
  }

  return {
    tryRunFoodD1PublicWebDraft,
    confirmFoodD1PublicWebDraft: createFoodD1PublicWebDraftConfirmation(deps),
  };
}

const publicWebDraft = createFoodD1PublicWebDraft(unavailablePublicD1WebDraftContext);
export const tryRunFoodD1PublicWebDraft = publicWebDraft.tryRunFoodD1PublicWebDraft;
export const confirmFoodD1PublicWebDraft = publicWebDraft.confirmFoodD1PublicWebDraft;
