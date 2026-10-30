/**
 * #1307 — V1 remains the sole decision maker. V2 runs only in read-only
 * shadow after a separately verified Gate A; it never changes the return value,
 * emits user messages, calls external providers, or stages knowledge.
 */
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { withAiInferenceAttemptCapture, type AiCapabilityAttemptMetric } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult, MealProcessingInput } from "../../nutritionEngineTypes";
import { comprehendFoodLanguage, type LinguisticLexiconStore } from "./linguisticComprehension";
import { resolveFoodObservations, type FoodResolverContext } from "./resolver";
import type { FoodKnowledgeStore } from "./knowledgeRead";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";
import { snapshotFoodV1ForShadow, type FoodShadowV1Snapshot } from "./shadowV1Snapshot";
import {
  buildFoodShadowEvent, summarizeFoodShadowCapabilityUsage, type FoodShadowClass, type FoodShadowContextStatus,
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
  /** Test-only override (NODE_ENV=test); production always requires the flag. */
  enabled?: boolean;
  /** Independent operational approval source; absent/invalid/throwing => no shadow. */
  verifyGateA?: () => Promise<GateAApproval | null>;
  /** Request-scoped AI observations, never a global cross-user event list. */
  readCapabilityEvents?: () => readonly AiCapabilityAttemptMetric[] | null;
  /** The sink accepts *only* a fixed, sanitised event, not a decision or input. */
  emit?: (event: FoodShadowEvent) => void | Promise<void>;
  /** Optional task-lifetime hook; invoked on a later event-loop turn, after V1 settles. */
  trackShadowTask?: (task: Promise<void>) => void;
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

/** Read a JSON-like own data property without invoking arbitrary getters. */
function ownEvidenceString(input: MealProcessingInput, field: "text" | "transcript" | "imageUrl" | "audioUrl"): string | null {
  const descriptor = Object.getOwnPropertyDescriptor(input, field);
  if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") return null;
  return descriptor.value.trim() || null;
}

function selectOriginalEvidence(input: MealProcessingInput): LanguageEvidence {
  try {
    // Snapshot the original data before V1 may normalize the request. Accessor
    // properties are not evaluated: they may throw or mutate the V1 input.
    const text = ownEvidenceString(input, "text");
    const transcript = ownEvidenceString(input, "transcript");
    const hasImage = ownEvidenceString(input, "imageUrl") !== null;
    const hasAudio = ownEvidenceString(input, "audioUrl") !== null;
    const multimodal = Boolean((hasImage || hasAudio) && (text || transcript) || text && transcript);
    const sourceText = text ?? transcript;
    return {
      text: sourceText,
      modality: hasImage && !sourceText ? "image" : multimodal ? "multimodal" :
        transcript || hasAudio ? "audio_transcript" : "text",
      linguisticModality: text ? "text" : transcript ? "audio_transcript" : "image",
      partial: multimodal || hasImage && !sourceText || hasAudio && !transcript,
    };
  } catch {
    // Proxy descriptor traps and other untrusted auxiliary input inspection
    // are not allowed to suppress, replace or delay the V1 result.
    return { text: null, modality: "text", linguisticModality: "text", partial: true };
  }
}

function mapV1ErrorToOutcome(error: unknown): "clarification" | "failed" {
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
  return Math.max(0, performance.now() - start);
}

/** Shadow observation is best effort and must never delay the production V1 response. */
async function observeFoodV2Shadow(
  evidence: LanguageEvidence,
  deps: FoodShadowDependencies,
  v1: FoodShadowV1Snapshot | null,
  v1Failure: "clarification" | "failed" | null,
  v1Ms: number,
  v1Start: number,
): Promise<void> {
  const verifyGateA = deps.verifyGateA;
  if (!verifyGateA) return;
  let approval: GateAApproval | null;
  try { approval = await verifyGateA(); }
  catch { return; }
  if (!validGateA(approval)) return;

  // Never use user identifiers or user content as telemetry correlation values.
  const traceId = deps.traceId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deps.traceId)
    ? deps.traceId : randomUUID();
  const now = deps.now ?? new Date();
  let languageMs = 0;
  let resolverMs = 0;
  let observations: FoodObservation[] = [];
  let decisions: FoodResolutionDecision[] | null = null;
  let failure: FoodShadowFailure = "none";

  if (!evidence.text) {
    failure = "evidence_unavailable";
  } else {
    try {
      const begin = performance.now();
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
      const begin = performance.now();
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

  // The optional provider-attempt adapter must never suppress a completed
  // V1/V2 comparison. Invalid or unavailable measurement means unknown (null),
  // not zero calls, and does not weaken the event's own strict validation.
  let capabilityEvents: readonly AiCapabilityAttemptMetric[] | null = null;
  try {
    const captured = deps.readCapabilityEvents?.() ?? null;
    if (captured !== null) {
      summarizeFoodShadowCapabilityUsage(captured);
      capabilityEvents = [...captured];
    }
  } catch {
    // An unavailable or malformed auxiliary capture is not a missing meal.
  }

  try {
    const event = buildFoodShadowEvent({
      traceId, modality: evidence.modality, entrypoint: deps.entrypoint,
      scenarioClass: deps.scenarioClass, v1,
      v1Failure,
      v2: decisions, observations, partialEvidence: evidence.partial,
      failure, context: deps.context,
      timings: { v1Ms, languageMs, resolverMs, totalMs: elapsed(v1Start) },
      capabilityEvents,
    });
    await deps.emit?.(event);
  } catch {
    // The shadow observer is not allowed to turn a successful V1 meal into
    // an error or to replace an existing V1 clarification with a new one.
  }
}

/**
 * Public result is exactly the V1 value (or the very same thrown error).
 * Shadow verification, resolution and telemetry run in a detached task. A request
 * lifetime hook may keep this task alive, but is not allowed to delay V1.
 * If the Gate A approval is not verifiable, no V2 code path is touched.
 *
 * Image-only evidence requires an authorised upstream OCR/vision observation
 * adapter. Without one it is explicitly "not_compared", never guessed.
 */
export async function runMealWithFoodV2Shadow(
  input: MealProcessingInput,
  deps: FoodShadowDependencies,
): Promise<CanonicalMealProcessingResult> {
  // When the flag or Gate A callback is absent, do not inspect the request
  // at all: the wrapper must be indistinguishable from a direct V1 call.
  const enabled = process.env.NODE_ENV === "test" && deps.enabled !== undefined
    ? deps.enabled : isFoodV2ShadowEnabled();
  const shadowRequested = enabled && typeof deps.verifyGateA === "function";
  if (!shadowRequested) return deps.runV1(input);
  // Capture the original JSON data without invoking accessors or changing V1.
  const evidence = selectOriginalEvidence(input);
  const v1Start = performance.now();
  let v1: CanonicalMealProcessingResult | null = null;
  let v1Failed = false;
  let v1Error: unknown;
  let capturedAttempts: readonly AiCapabilityAttemptMetric[] | null = null;
  try {
    v1 = shadowRequested
      ? await withAiInferenceAttemptCapture(
        () => deps.runV1(input),
        attempts => { capturedAttempts = attempts; },
      )
      : await deps.runV1(input);
  } catch (error) {
    v1Failed = true;
    v1Error = error;
  }
  const v1Ms = elapsed(v1Start);
  // Capture the error outcome before rethrowing the original mutable error object.
  let frozenV1Failure: "clarification" | "failed" | null = null;
  if (shadowRequested && v1Failed) {
    try { frozenV1Failure = mapV1ErrorToOutcome(v1Error); }
    catch { frozenV1Failure = "failed"; }
  }
  // Capture only consumed comparison fields before publishing the mutable V1.
  let v1Snapshot: FoodShadowV1Snapshot | null = null;
  if (shadowRequested && !v1Failed && v1) {
    try { v1Snapshot = snapshotFoodV1ForShadow(v1); }
    catch { /* Invalid snapshot getters must never alter the V1 response. */ }
  }
  const replayV1 = () => {
    if (v1Failed) throw v1Error;
    return v1 as CanonicalMealProcessingResult;
  };
  // The scoped capture contains only capability/role/latency/cost, never full AI events.
  // An explicit request-scoped adapter can also provide observations from other emitters.
  const observerDeps: FoodShadowDependencies = deps.readCapabilityEvents
    ? deps : { ...deps, readCapabilityEvents: () => capturedAttempts };
  // A microtask can run before the caller receives this async V1 result.
  // Use a separate event-loop turn so even synchronous Gate A and task hooks
  // cannot delay successful V1 delivery or the original V1 rejection.
  setImmediate(() => {
    const shadowTask = Promise.resolve()
      .then(() => observeFoodV2Shadow(evidence, observerDeps, v1Snapshot, frozenV1Failure, v1Ms, v1Start))
      .catch(() => undefined);
    try { deps.trackShadowTask?.(shadowTask); }
    catch { /* A failing task-lifetime hook must not affect V1 or shadow. */ }
  });
  return replayV1();
}
