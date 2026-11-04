/** #1308: gated text/audio web review flow with short-lived structured state. */
import { createHash, randomUUID } from "node:crypto";
import { getDateKeyInTimeZone, zonedDateTimeLocalToIso } from "../../../shared/timeZone";
import type { FoodD1WebDraft, FoodD1WebDraftItem } from "../../../shared/foodD1WebDraft";
import type { ProcessMealDraftInput, ConfirmFoodD1WebDraftInput } from "../meals/schemas";
import { transcribeAudio } from "../../_core/voiceTranscription";
import { createFoodV2KnowledgeRepository } from "./repository";
import { governedLinguisticLexiconStore } from "./linguisticLexiconRepository";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import {
  buildD1OperationPlan,
  type FoodD1Dependencies,
  type FoodD1Entrypoint,
  type FoodD1Request,
  type FoodD1Result,
} from "./entrypointMigration";
import {
  createFoodD1RouteDbStore,
} from "./entrypointRouteRepository";
import {
  isCurrentFoodD1GateApproval,
  isFoodD1EntrypointCutoverRequested,
  isValidD1OperationId,
  routeFoodD1Operation,
  type FoodD1GateApproval,
  type FoodD1RouteStore,
} from "./entrypointRouting";
import {
  runFoodD1Migration,
} from "./entrypointRunner";
import type { FoodOperationEnvelope, FoodObservation } from "./schemas";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import {
  getFoodD1WebDraft,
  saveFoodD1WebDraft,
  type FoodD1WebDraftRecord,
} from "./publicWebDraftRepository";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";

export class FoodD1WebDraftNotFoundError extends Error {
  constructor() {
    super("Rascunho V2 não encontrado ou expirado.");
    this.name = "FoodD1WebDraftNotFoundError";
  }
}

export type PublicD1WebDraftDependencies = {
  readAuthorizedContext: () => Promise<AuthorizedD1SimulationContext | null>;
  lexicon?: LinguisticLexiconStore;
  knowledge?: FoodD1Dependencies["knowledge"];
  comprehend?: typeof comprehendFoodLanguage;
  buildPlan?: typeof buildD1OperationPlan;
  routeStore?: FoodD1RouteStore;
  saveDraft?: typeof saveFoodD1WebDraft;
  readDraft?: typeof getFoodD1WebDraft;
  run?: typeof runFoodD1Migration;
  transcribe?: typeof transcribeAudio;
};

export function hashFoodD1WebDraftConfirmation(input: {
  userId: number;
  timeZone: string;
  occurredAt: Date;
  request: ConfirmFoodD1WebDraftInput;
}): string {
  return createHash("sha256").update(JSON.stringify({
    userId: input.userId,
    timeZone: input.timeZone,
    draftId: input.request.draftId,
    mealLabel: input.request.mealLabel,
    occurredAt: input.occurredAt.toISOString(),
    notes: input.request.notes?.trim() || null,
    items: [...input.request.items]
      .sort((left, right) => left.observationId.localeCompare(right.observationId))
      .map(({ observationId, foodName, quantity, unit }) => ({
        observationId, foodName, quantity, unit,
      })),
  })).digest("hex");
}

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

function buildEnvelope(input: {
  userId: number;
  operationKey: string;
  traceId: string;
  mealLabel: string;
  occurredAt: Date;
  timeZone: string;
  entrypoint: FoodD1Entrypoint;
  revisions: FoodOperationEnvelope["revisions"];
}): FoodOperationEnvelope {
  const unavailable = (reason: string) => ({
    status: "unavailable" as const, reason, sourceRef: null,
  });
  return {
    schemaVersion: 2,
    traceId: input.traceId,
    idempotencyKey: input.operationKey,
    ownerUserId: input.userId,
    conversationRef: null,
    turnRef: null,
    effectiveTimeZone: input.timeZone,
    mealOperation: {
      action: "add",
      targetMeal: input.mealLabel,
      date: getDateKeyInTimeZone(input.occurredAt, input.timeZone),
    },
    contextSources: {
      previousMessage: unavailable("web_draft_has_no_conversation_snapshot"),
      preferences: unavailable("web_draft_has_no_authorized_preference_snapshot"),
      recentHistory: unavailable("web_draft_has_no_authorized_history_snapshot"),
    },
    revisions: { ...input.revisions },
  };
}

function toReviewItem(item: FoodD1Result["items"][number]): FoodD1WebDraftItem {
  const decision = item.decision;
  const consumed = decision.nutrition.verified ? decision.nutrition.consumed : null;
  return {
    observationId: item.observationId,
    foodName: decision.identity.canonicalName ?? decision.alternatives[0]?.name ?? "",
    quantity: decision.quantity.value,
    unit: decision.quantity.unit,
    disposition: item.disposition,
    reasonCodes: [...item.reasonCodes],
    nutrition: {
      verified: consumed !== null,
      calories: consumed?.calories ?? null,
      protein: consumed?.protein ?? null,
      carbs: consumed?.carbs ?? null,
      fat: consumed?.fat ?? null,
    },
  };
}

function buildDependencies(input: {
  userId: number;
  entrypoint: FoodD1Entrypoint;
  evidence: FoodD1Request["evidence"];
  lexicon: LinguisticLexiconStore;
  knowledge: FoodD1Dependencies["knowledge"];
}): FoodD1Dependencies {
  return {
    lexicon: input.lexicon,
    knowledge: input.knowledge,
    authorizeEvidence: async request =>
      request.ownerUserId === input.userId &&
      request.entrypoint === input.entrypoint &&
      request.evidence === input.evidence,
    authorizeExistingItem: async () => false,
  };
}

function isD1WebDraftResult(value: unknown): value is FoodD1Result {
  return Boolean(value && typeof value === "object" &&
    "schemaVersion" in value && value.schemaVersion === 2 &&
    "entrypoint" in value && "items" in value &&
    Array.isArray(value.items) && "committed" in value && value.committed === false);
}

function getStoredRecord(record: FoodD1WebDraftRecord): FoodD1WebDraft {
  if (record.status === "confirmed") {
    throw new Error("food-d1-web-draft-operation-already-confirmed");
  }
  return record.payload.draft;
}

function isConfirmedDraft(
  record: FoodD1WebDraftRecord | null | undefined,
): record is Extract<FoodD1WebDraftRecord, { status: "confirmed" }> {
  return record?.status === "confirmed";
}

function sameReviewItem(
  current: { name: string; quantity: number | null; unit: string | null },
  original: { name: string; quantity: number | null; unit: string | null },
): boolean {
  return current.name === original.name &&
    current.quantity === original.quantity &&
    current.unit === original.unit;
}

function assertReviewMeasurement(
  current: { quantity: number | null; unit: string | null },
  originalUnit: string | null,
): void {
  if (current.quantity !== null && !current.unit) {
    throw new Error("food-d1-public-web-draft-quantity-unit-required");
  }
  if (current.quantity === null && current.unit !== originalUnit) {
    throw new Error("food-d1-public-web-draft-quantity-required-for-unit-change");
  }
}

function isNativeDraftNotPending(error: unknown): boolean {
  return error instanceof Error &&
    error.message === "food-d1-native-web-draft-not-pending";
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
    const entrypoint: Extract<FoodD1Entrypoint, "text" | "audio_transcript" | "multimodal"> | null = hasText && hasAudio
      ? "multimodal"
      : hasText ? "text" : hasAudio ? "audio_transcript" : null;
    if (!entrypoint || !isFoodD1EntrypointCutoverRequested(entrypoint)) return null;
    if (request.image) {
      throw new Error("food-d1-public-web-image-entrypoint-incomplete");
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

    const operationKeyValue = operationKey(input.userId, request.d1OperationId!);
    const surfaces: Array<{ text: string; modality: "text" | "audio_transcript"; source: string }> = [];
    if (hasText) {
      surfaces.push({ text: request.text!.trim(), modality: "text", source: "text" });
    }
    if (transcript) {
      surfaces.push({ text: transcript, modality: "audio_transcript", source: "audio" });
    }
    const sourceHashes = surfaces.map(surface => ({
      modality: surface.modality,
      digest: createHash("sha256").update(surface.text).digest("hex"),
    }));
    const traceId = `d1-trace-${createHash("sha256").update(JSON.stringify({
      operationKey: operationKeyValue, entrypoint, sourceHashes,
    })).digest("hex")}`;
    const envelope = buildEnvelope({
      userId: input.userId,
      operationKey: operationKeyValue,
      traceId,
      mealLabel: request.mealLabel.trim(),
      occurredAt,
      timeZone: input.timeZone,
      entrypoint,
      revisions: context.revisions,
    });

    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    const observations: FoodObservation[] = [];
    for (const surface of surfaces) {
      observations.push(...await comprehend({
        rawText: surface.text,
        sourceRef: `${operationKeyValue}:${surface.source}`,
        modality: surface.modality,
        ownerUserId: input.userId,
        lexiconRevision: context.revisions.lexicon,
        locale: "pt-BR",
        now,
      }, lexicon));
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

  async function confirmPublicWebDraft(input: {
    userId: number;
    request: ConfirmFoodD1WebDraftInput;
    timeZone: string;
    occurredAt: Date;
  }): Promise<FoodD1CommitResult> {
    const confirmationHash = hashFoodD1WebDraftConfirmation(input);
    const record = await (deps.readDraft ?? getFoodD1WebDraft)({
      draftId: input.request.draftId,
      ownerUserId: input.userId,
    });
    if (!record) throw new FoodD1WebDraftNotFoundError();
    if (isConfirmedDraft(record)) {
      if (record.confirmationHash !== confirmationHash) {
        throw new Error("food-d1-web-draft-confirmation-conflict");
      }
      return record.result;
    }
    const { draft, envelope, observations } = record.payload;
    if (draft.mealLabel !== input.request.mealLabel ||
        getDateKeyInTimeZone(input.occurredAt, input.timeZone) !==
          envelope.mealOperation?.date) {
      throw new Error("food-d1-public-web-draft-operation-scope-changed");
    }
    if (input.request.items.length !== draft.items.length) {
      throw new Error("food-d1-public-web-draft-item-set-changed");
    }
    const originalById = new Map(draft.items.map(item => [item.observationId, item]));
    const observationById = new Map(observations.map(item => [item.observationId, item]));
    const submittedIds = new Set<string>();
    const lexicon = deps.lexicon ?? governedLinguisticLexiconStore;
    const resolvedObservations: FoodObservation[] = [];
    for (const item of input.request.items) {
      const original = originalById.get(item.observationId);
      const originalObservation = observationById.get(item.observationId);
      if (!original || !originalObservation || submittedIds.has(item.observationId)) {
        throw new Error("food-d1-public-web-draft-item-scope-mismatch");
      }
      submittedIds.add(item.observationId);
      const unchanged = sameReviewItem(
        { name: item.foodName, quantity: item.quantity, unit: item.unit },
        { name: original.foodName, quantity: original.quantity, unit: original.unit },
      );
      if (unchanged) {
        resolvedObservations.push(originalObservation);
        continue;
      }
      assertReviewMeasurement(item, original.unit);
      const quantitySurface = item.quantity === null
        ? ""
        : `${item.quantity} ${item.unit} de `;
      const surface = `${quantitySurface}${item.foodName}`.trim();
      const corrected = await comprehend({
        rawText: surface,
        sourceRef: `${draft.operationKey}:correction:${item.observationId}`,
        modality: "text",
        ownerUserId: input.userId,
        lexiconRevision: envelope.revisions.lexicon,
        locale: "pt-BR",
        now: new Date(),
      }, lexicon);
      if (corrected.length !== 1) {
        throw new Error("food-d1-public-web-draft-correction-ambiguous");
      }
      const correctedObservation = {
        ...corrected[0],
        observationId: item.observationId,
      };
      if (item.quantity === null && item.unit !== null) {
        correctedObservation.quantityHints = {
          ...correctedObservation.quantityHints,
          unit: item.unit,
        };
        correctedObservation.evidence = [
          ...correctedObservation.evidence.filter(item => item.field !== "quantity.unit"),
          ...originalObservation.evidence.filter(item => item.field === "quantity.unit"),
        ];
      }
      resolvedObservations.push(correctedObservation);
    }
    if (submittedIds.size !== draft.items.length) {
      throw new Error("food-d1-public-web-draft-item-set-changed");
    }
    const context = await deps.readAuthorizedContext();
    if (!context || !isCurrentFoodD1GateApproval(
      context.approval, context.expectedAuditedBaseSha,
    ) || context.revisions.code !== context.expectedAuditedBaseSha) {
      throw new Error("food-d1-public-web-draft-gate-unavailable");
    }
    const evidence = { kind: "structured" as const, observations: resolvedObservations };
    const request: FoodD1Request = {
      authenticatedUserId: input.userId,
      entrypoint: draft.entrypoint,
      envelope,
      evidence,
      now: new Date(),
    };
    let result: FoodD1CommitResult | FoodD1Result | null;
    try {
      result = await (deps.run ?? runFoodD1Migration)({
        request,
        source: "web",
        occurredAt: input.occurredAt,
        notes: input.request.notes,
        draftId: input.request.draftId,
        draftConfirmationHash: confirmationHash,
        dependencies: buildDependencies({
          userId: input.userId,
          entrypoint: draft.entrypoint,
          evidence,
          lexicon,
          knowledge: deps.knowledge ?? createFoodV2KnowledgeRepository(),
        }),
        legacy: async () => {
          throw new Error("food-d1-public-web-draft-cannot-replay-v1");
        },
        expectedAuditedBaseSha: context.expectedAuditedBaseSha,
        verifyGates: async () => (await deps.readAuthorizedContext())?.approval ?? null,
        beforeCommit: plan => {
          if (plan.items.length !== draft.items.length ||
              plan.items.some(item => item.disposition !== "ready")) {
            throw new Error("food-d1-public-web-draft-needs-clarification");
          }
        },
      });
    } catch (error) {
      if (!isNativeDraftNotPending(error)) throw error;
      const latest = await (deps.readDraft ?? getFoodD1WebDraft)({
        draftId: input.request.draftId,
        ownerUserId: input.userId,
      });
      if (isConfirmedDraft(latest) &&
          latest.confirmationHash === confirmationHash) {
        return latest.result;
      }
      if (isConfirmedDraft(latest)) {
        throw new Error("food-d1-web-draft-confirmation-conflict");
      }
      throw error;
    }
    if (!result || typeof result !== "object" || !("committed" in result) ||
        result.committed !== true || !("recordedItemIds" in result)) {
      throw new Error("food-d1-public-web-draft-commit-unavailable");
    }
    return result;
  }

  return {
    tryRunFoodD1PublicWebDraft,
    confirmFoodD1PublicWebDraft: confirmPublicWebDraft,
  };
}

const publicWebDraft = createFoodD1PublicWebDraft(unavailablePublicD1WebDraftContext);
export const tryRunFoodD1PublicWebDraft = publicWebDraft.tryRunFoodD1PublicWebDraft;
export const confirmFoodD1PublicWebDraft = publicWebDraft.confirmFoodD1PublicWebDraft;
