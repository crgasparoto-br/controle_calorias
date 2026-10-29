/**
 * #1307 — V1 remains the sole decision maker. V2 runs only in read-only
 * shadow after a separately verified Gate A; it never changes the return value,
 * emits user messages, calls external providers, or stages knowledge.
 */
import { randomUUID } from "node:crypto";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult, MealProcessingInput } from "../../nutritionEngineTypes";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import { resolveFoodObservations, type FoodResolverContext } from "./resolver";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";
import {
  buildFoodShadowEvent, type FoodShadowClass, type FoodShadowContextStatus,
  type FoodShadowEntrypoint, type FoodShadowEvent, type FoodShadowFailure,
  type FoodShadowModality,
} from "./shadowComparison";

export type GateAApproval = {
  status: "approved";
  /** An actual, independently verified Gate A artifact reference, not a fixture. */
  evidenceReference: string;
  baseSha: string;
};

export type FoodShadowDependencies = {
  /** Existing production V1 path, called exactly once even when Gate A is blocked. */
  runV1: (input: MealProcessingInput) => Promise<CanonicalMealProcessingResult>;
  lexicon: LinguisticLexiconStore;
  knowledge: FoodKnowledgeStore;
  userId: number | null;
  knowledgeRevision: string;
  lexiconRevision: string;
  policyVersion: string;
  resolverVersion: string;
  entrypoint: FoodShadowEntrypoint;
  scenarioClass: FoodShadowClass;
  /** Gated by FOOD_V2_SHADOW_ENABLED unless a test/replay overrides it. */
  enabled?: boolean;
  /** Independent operational approval source; absent/invalid/throwing => no shadow. */
  verifyGateA?: () => Promise<GateAApproval | null>;
  /** Request-scoped AI observations, never a global cross-user event list. */
  readCapabilityEvents?: () => readonly AiInferenceEvent[];
  /** The sink accepts *only* a fixed, sanitised event, not a decision or input. */
  emit?: (event: FoodShadowEvent) => void | Promise<void>;
  context?: Partial<{
    previousMessage: FoodShadowContextStatus;
    preferences: FoodShadowContextStatus;
    recentHistory: FoodShadowContextStatus;
  }>;
  /** A trusted request correlation ID, not a user-supplied text identifier. */
  traceId?: string;
  now?: Date;
};

export function isFoodV2ShadowEnabled(): boolean {
  return process.env.FOOD_V2_SHADOW_ENABLED?.trim().toLowerCase() === "true";
}

/**
 * The V2 interface is limited to reads. Defensive wrapper protects even a
 * future caller accidentally supplying an external lookup or staging a cache.
 */
export function readOnlyFoodKnowledge(store: FoodKnowledgeStore): FoodKnowledgeStore {
  return {
    readLocal(request) { return store.readLocal(request); },
    readPendingEvidence(request) { return store.readPendingEvidence(request); },
    async stagePendingEvidence() { throw new Error("shadow-knowledge-write-denied"); },
  };
}

type LanguageEvidence = {
  text: string | null;
  modality: FoodShadowModality;
  linguisticModality: "text" | "audio_transcript" | "image";
  partial: boolean;
};

function selectOriginalEvidence(input: MealProcessingInput): LanguageEvidence {
  const text = typeof input.text === "string" ? input.text.trim() || null : null;
  const transcript = typeof input.transcript === "string" ? input.transcript.trim() || null : null;
  const hasImage = typeof input.imageUrl === "string" && input.imageUrl.length > 0;
  const hasAudio = typeof input.audioUrl === "string" && input.audioUrl.length > 0;
  const multimodal = Boolean((hasImage || hasAudio) && (text || transcript) || text && transcript);
  // Never feed a V1 semanticContract, V1 model output or synthetic text
  // reconstructed from an image back into the V2 linguistic layer.
  const sourceText = text ?? transcript;
  return {
    text: sourceText,
    modality: hasImage && !sourceText ? "image" : multimodal ? "multimodal" :
      transcript || hasAudio ? "audio_transcript" : "text",
    linguisticModality: text ? "text" : transcript ? "audio_transcript" : "image",
    partial: multimodal || hasImage && !sourceText || hasAudio && !transcript,
  };
}

function classifyV1Error(error: unknown): "clarification" | "failed" {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  return code === "food_identity_clarification_required" ||
    code === "food_component_quantity_required" ||
    code === "image_identity_unresolved"
    ? "clarification" : "failed";
}

function validGateA(value: GateAApproval | null | undefined): value is GateAApproval {
  return value?.status === "approved" &&
    typeof value.evidenceReference === "string" && value.evidenceReference.length > 5 &&
    /^[0-9a-f]{40}$/i.test(value.baseSha);
}

function elapsed(start: number) {
  return Math.max(0, Date.now() - start);
}

/**
 * Public result is exactly the V1 value (or the very same thrown error).
 * Failure of the V2 path, gate verifier or telemetry sink is observational only.
 * If the Gate A approval is not verifiable, no V2 code path is touched.
 *
 * Image-only evidence requires an authorised upstream OCR/vision observation
 * adapter. Without one it is explicitly "not_compared", never guessed.
 */
export async function runMealWithFoodV2Shadow(
  input: MealProcessingInput,
  deps: FoodShadowDependencies,
): Promise<CanonicalMealProcessingResult> {
  // Capture the original surface before V1 can normalize or mutate the input.
  // A changed V1 draft is never evidence for a separate V2 observation.
  const evidence = selectOriginalEvidence(input);
  const v1Start = Date.now();
  let v1: CanonicalMealProcessingResult | null = null;
  let v1Failed = false;
  let v1Error: unknown;
  try {
    v1 = await deps.runV1(input);
  } catch (error) {
    v1Failed = true;
    v1Error = error;
  }
  const v1Ms = elapsed(v1Start);
  const replayV1 = () => {
    if (v1Failed) throw v1Error;
    return v1 as CanonicalMealProcessingResult;
  };
  if (!(deps.enabled ?? isFoodV2ShadowEnabled()) || !deps.verifyGateA) return replayV1();
  let approval: GateAApproval | null;
  try { approval = await deps.verifyGateA(); }
  catch { return replayV1(); }
  if (!validGateA(approval)) return replayV1();

  // Never use user identifiers or user content as telemetry correlation values.
  const traceId = deps.traceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deps.traceId)
    ? deps.traceId : randomUUID();
  const now = deps.now ?? new Date();
  const runnerStart = Date.now();
  let languageMs = 0;
  let resolverMs = 0;
  let observations: FoodObservation[] = [];
  let decisions: FoodResolutionDecision[] | null = null;
  let failure: FoodShadowFailure = "none";

  if (!evidence.text) {
    failure = "evidence_unavailable";
  } else {
    try {
      const begin = Date.now();
      observations = await comprehendFoodLanguage({
        rawText: evidence.text,
        modality: evidence.linguisticModality,
        sourceRef: "food-shadow:" + traceId,
        ownerUserId: deps.userId,
        lexiconRevision: deps.lexiconRevision,
        locale: "pt-BR",
        now,
        // #1306 thresholds are not approved; never invoke residual S3.
      }, deps.lexicon);
      languageMs = elapsed(begin);
    } catch {
      failure = "language_unavailable";
    }
    if (failure === "none") {
      const begin = Date.now();
      try {
        const context: Omit<FoodResolverContext, "previousDecision"> = {
          traceId, userId: deps.userId, knowledgeRevision: deps.knowledgeRevision,
          policyVersion: deps.policyVersion, resolverVersion: deps.resolverVersion, now,
        };
        decisions = await resolveFoodObservations(observations, context, readOnlyFoodKnowledge(deps.knowledge));
      } catch {
        failure = "resolver_unavailable";
      }
      resolverMs = elapsed(begin);
    }
  }

  try {
    const event = buildFoodShadowEvent({
      traceId, modality: evidence.modality, entrypoint: deps.entrypoint,
      scenarioClass: deps.scenarioClass, v1,
      v1Failure: v1Failed ? classifyV1Error(v1Error) : null,
      v2: decisions, observations, partialEvidence: evidence.partial,
      failure, context: deps.context,
      timings: { v1Ms, languageMs, resolverMs, totalMs: elapsed(v1Start) },
      capabilityEvents: deps.readCapabilityEvents?.() ?? null,
    });
    await deps.emit?.(event);
  } catch {
    // The shadow observer is not allowed to turn a successful V1 meal into
    // an error or to replace an existing V1 clarification with a new one.
  }
  void runnerStart;
  return replayV1();
}
