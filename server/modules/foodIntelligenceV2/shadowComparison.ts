/**
 * Issue #1307 — sanitised V1/V2 comparison. An observed difference is not
 * independent proof that either resolver is wrong (ADR §1.3, §19.7).
 * Deliberately never serialize raw text, media, food names or owner identity.
 */
import { AI_CAPABILITIES, type AiCapabilityId } from "../../_core/ai/capabilities";
import type { AiCapabilityAttemptMetric } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult, MealDraftItem } from "../../nutritionEngineTypes";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";
import { z } from "zod";
import { abs, costMetric, exactDifference, metric, pairFoodShadowItems, persistedFamilyId, persistedVariantId } from "./shadowPairing";

export type FoodShadowModality = "text" | "audio_transcript" | "image" | "multimodal";
export type FoodShadowClass = "generic" | "commercial" | "quantity" | "label" | "ambiguous" | "unknown" | "mixed";
export type FoodShadowEntrypoint = "web" | "whatsapp" | "meal_add" | "meal_edit" | "label_continuation" | "replay";
export type FoodShadowOutcome = "resolved" | "partially_resolved" | "ambiguous" | "unknown" | "clarification" | "failed" | "not_compared";
export type FoodShadowFailure = "none" | "gate_unavailable" | "evidence_unavailable" | "language_unavailable" | "resolver_unavailable" | "telemetry_unavailable";
export type FoodShadowContextStatus = "available" | "absent" | "expired" | "unavailable" | "not_applicable" | "not_instrumented";

export type FoodShadowCapabilityUsage = {
  capability: AiCapabilityId;
  calls: number;
  retries: number;
  totalLatencyMs: number;
  estimatedCostUsd: number | null;
  costMeasuredCalls: number;
};

/** Safe for 10,000 replay events and millisecond measurements rounded to 0.001 ms.
 * This arithmetic integrity bound is not an operational latency SLO.
 */
export const MAX_SHADOW_TIMING_MS = Math.floor(Number.MAX_SAFE_INTEGER / (10_000 * 1_000));
// Four independently rounded values (three stages and one total) can differ
// by up to 0.002 ms without any real overlap or missing elapsed time.
const TIMING_ROUNDING_TOLERANCE_MS = 0.002;

export type FoodShadowEvent = {
  schemaVersion: 1;
  /** A server-generated random UUID; it is never derived from user text. */
  traceId: string;
  modality: FoodShadowModality;
  entrypoint: FoodShadowEntrypoint;
  scenarioClass: FoodShadowClass;
  run: "compared" | "partial" | "failed";
  failure: FoodShadowFailure;
  v1Outcome: FoodShadowOutcome;
  v2Outcome: FoodShadowOutcome;
  /** A present but empty list is observable; a failed/missing snapshot is not. */
  v1ItemsObserved: boolean;
  v2ItemsObserved: boolean;
  v1ItemCount: number;
  v2ItemCount: number;
  v2Stages: { s1: number; s2: number; s3: number };
  context: { previousMessage: FoodShadowContextStatus; preferences: FoodShadowContextStatus; recentHistory: FoodShadowContextStatus };
  differences: {
    comparablePairs: number;
    /** Sanitised missing-item counts, preserving which resolver omitted an item. */
    unpairedItems: number;
    v1UnpairedItems: number;
    v2UnpairedItems: number;
    identity: number;
    variant: number;
    /** Paired by legacy labels without a comparable persisted variant ID. */
    variantIdUnverifiable: number;
    quantity: number;
    nutrition: number;
    source: number;
    clarification: boolean | null;
    /** Absolute differences, not the underlying personal nutritional values. */
    macros: { calories: number | null; protein: number | null; carbs: number | null; fat: number | null };
    confidence: number | null;
  };
  flagged: {
    /** An indicator for human investigation, not a confirmed accuracy failure. */
    possibleSilentFallback: number;
    v2MissingNutritionProvenance: number;
    explicitFailure: number;
    sourceConflicts: number;
  };
  timings: { v1Ms: number; languageMs: number; resolverMs: number; totalMs: number };
  /** Null means no capability instrumentation was provided; it is not zero calls. */
  capabilityUsage: FoodShadowCapabilityUsage[] | null;
  /** Verified accuracy needs independent labels from a separate corpus review. */
  verifiedCorrect: null;
};

/** Timings are sequential in C4: V1 -> language -> resolver -> completion.
 * Reject impossible samples before they can alter diagnostic percentiles.
 */
export function hasConsistentFoodShadowTimings(timings: FoodShadowEvent["timings"]): boolean {
  const values = [timings.v1Ms, timings.languageMs, timings.resolverMs, timings.totalMs];
  return values.every(value => Number.isFinite(value) && value >= 0 && value <= MAX_SHADOW_TIMING_MS) &&
    timings.v1Ms + timings.languageMs + timings.resolverMs <=
      timings.totalMs + TIMING_ROUNDING_TOLERANCE_MS;
}

/** Typed telemetry dimensions; validators reject untrusted free-form labels. */
const segmentation = z.object({
  modality: z.enum(["text", "audio_transcript", "image", "multimodal"]),
  entrypoint: z.enum(["web", "whatsapp", "meal_add", "meal_edit", "label_continuation", "replay"]),
  scenarioClass: z.enum(["generic", "commercial", "quantity", "label", "ambiguous", "unknown", "mixed"]),
});

function emptyMacroDifferences(): FoodShadowEvent["differences"]["macros"] {
  // These are *missing deltas*, never hardcoded nutrition values.
  return { calories: null, protein: null, carbs: null, fat: null };
}

const hasNutrition = (item: MealDraftItem) =>
  [item.calories, item.protein, item.carbs, item.fat].some(value => Number.isFinite(value) && value > 0);
const v1Origin = (item: MealDraftItem) => item.resolution?.nutritionOrigin ?? null;
const v2Origin = (item: FoodResolutionDecision) => {
  const nutritionEvidence = item.evidence.filter(event => item.nutrition.evidenceIds.includes(event.evidenceId));
  if (!nutritionEvidence.length) return null;
  const origins = new Set(nutritionEvidence.map(event => event.origin));
  if (origins.size !== 1) return null;
  const origin = nutritionEvidence[0].origin;
  return origin === "catalog" ? "catalog" : origin === "nutrition_label" ? "nutrition_label"
    : origin === "web_research" ? "web_research"
    : origin === "ai_estimate" ? "ai_estimate" : origin === "provisional_estimate" ? "provisional_estimate" : null;
};

function summarizeV1(result: CanonicalMealProcessingResult | null, failed: "clarification" | "failed" | null): FoodShadowOutcome {
  if (failed) return failed;
  if (!result) return "not_compared";
  return result.semanticContract.needsClarification ? "clarification" : "resolved";
}

function summarizeV2(decisions: readonly FoodResolutionDecision[] | null): FoodShadowOutcome {
  if (decisions === null) return "not_compared";
  if (!decisions.length) return "unknown";
  if (decisions.some(item => item.nextAction === "clarify")) return "clarification";
  if (decisions.some(item => item.status === "unknown")) return "unknown";
  if (decisions.some(item => item.status === "ambiguous")) return "ambiguous";
  if (decisions.some(item => item.status === "partially_resolved")) return "partially_resolved";
  return "resolved";
}

export function summarizeFoodShadowCapabilityUsage(
  observations: readonly AiCapabilityAttemptMetric[] | null,
): FoodShadowCapabilityUsage[] | null {
  if (observations === null) return null;
  const summaries = new Map<AiCapabilityId, FoodShadowCapabilityUsage>();
  for (const event of observations) {
    // Never allow dynamic provider labels, user-controlled capability strings or
    // raw correlation fields into the output. One event is one external attempt.
    if (!AI_CAPABILITIES.includes(event.capability)) continue;
    const entry = summaries.get(event.capability) ?? {
      capability: event.capability, calls: 0, retries: 0,
      totalLatencyMs: 0, estimatedCostUsd: 0, costMeasuredCalls: 0,
    };
    // Invalid capture is unknown, not a fabricated zero-duration provider call.
    if (!Number.isFinite(event.latencyMs) || event.latencyMs < 0 ||
        event.latencyMs > MAX_SHADOW_TIMING_MS ||
        entry.totalLatencyMs + event.latencyMs > MAX_SHADOW_TIMING_MS) {
      throw new TypeError("invalid-shadow-capability-latency");
    }
    entry.calls++;
    if (event.callRole === "retry") entry.retries++;
    entry.totalLatencyMs += metric(event.latencyMs);
    if (event.estimatedCostUsd !== null && Number.isFinite(event.estimatedCostUsd) &&
        event.estimatedCostUsd >= 0) {
      entry.estimatedCostUsd = (entry.estimatedCostUsd ?? 0) + event.estimatedCostUsd;
      entry.costMeasuredCalls++;
    }
    summaries.set(event.capability, entry);
  }
  return [...summaries.values()].sort((a, b) => a.capability.localeCompare(b.capability)).map(item => ({
    ...item, totalLatencyMs: metric(item.totalLatencyMs),
    estimatedCostUsd: item.costMeasuredCalls === item.calls ? costMetric(item.estimatedCostUsd ?? 0) : null,
  }));
}

/** This function must be the ONLY path from private V1/V2 outputs to the sink. */
export function buildFoodShadowEvent(input: {
  traceId: string;
  modality: FoodShadowModality;
  entrypoint: FoodShadowEntrypoint;
  scenarioClass: FoodShadowClass;
  v1: CanonicalMealProcessingResult | null;
  v1Failure: "clarification" | "failed" | null;
  v2: readonly FoodResolutionDecision[] | null;
  observations: readonly FoodObservation[];
  failure: FoodShadowFailure;
  partialEvidence?: boolean;
  context?: Partial<FoodShadowEvent["context"]>;
  timings: FoodShadowEvent["timings"];
  capabilityEvents?: readonly AiCapabilityAttemptMetric[] | null;
}): FoodShadowEvent {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.traceId)) {
    throw new TypeError("invalid-shadow-trace-id");
  }
  if (!segmentation.safeParse({
    modality: input.modality, entrypoint: input.entrypoint, scenarioClass: input.scenarioClass,
  }).success) throw new TypeError("invalid-shadow-segmentation");
  // Guard raw durations *before* metric() could round an extreme value to 0.
  if (!hasConsistentFoodShadowTimings(input.timings)) {
    throw new TypeError("invalid-shadow-timings");
  }
  const v1 = input.v1?.items ?? [];
  const v2 = input.v2 ?? [];
  const pairing = input.v1 && input.v2 ? pairFoodShadowItems(v1, v2) :
    { pairs: [], unpairedVariantChanges: 0 };
  const matchedPairs = pairing.pairs;
  const comparablePairs = matchedPairs.length;
  const leftUnpaired = input.v1 && input.v2 ? v1.length - comparablePairs : 0;
  const rightUnpaired = input.v1 && input.v2 ? v2.length - comparablePairs : 0;
  const macros = emptyMacroDifferences();
  const macroKeys = Object.keys(macros) as Array<keyof typeof macros>;
  const differences = {
    comparablePairs, unpairedItems: leftUnpaired + rightUnpaired,
    v1UnpairedItems: leftUnpaired, v2UnpairedItems: rightUnpaired,
    // Remaining unmatched items on both sides indicate a possible identity change,
    // not a verified error or a license to compare unrelated macro values.
    identity: Math.min(leftUnpaired, rightUnpaired),
    variant: pairing.unpairedVariantChanges, variantIdUnverifiable: 0,
    quantity: 0, nutrition: 0, source: 0,
    clarification: null as boolean | null, macros, confidence: null as number | null,
  };
  let possibleSilentFallback = 0;
  for (const item of v1) {
    // Missing provenance on numeric nutrition is suspicious, not a verified failure.
    if (hasNutrition(item) && !v1Origin(item)) possibleSilentFallback++;
  }
  let missingProvenanceCount = 0;
  let explicitFailure = 0;
  let sourceConflicts = 0;
  for (const item of v2) {
    if (item.nutrition.consumed !== null && (
      !item.nutrition.evidenceIds.length || (!item.nutrition.verified && !item.nutrition.provisional)
    )) missingProvenanceCount++;
    if (item.nextAction === "reject" || item.status === "unknown") explicitFailure++;
    if (item.reasonCodes.includes("source_conflict")) sourceConflicts++;
  }

  let confidenceTotal = 0;
  let confidenceN = 0;
  for (const { left, right } of matchedPairs) {
    const leftId = persistedVariantId(left);
    const rightId = right.identity.variantId;
    const leftFamilyId = persistedFamilyId(left);
    const rightFamilyId = right.identity.foodEntityId;
    if (leftId === null || rightId === null) differences.variantIdUnverifiable++;
    if (leftId !== null && rightId !== null && leftId !== rightId) {
      throw new Error("unpaired-known-variant-identity");
    }
    if (leftFamilyId !== null && leftFamilyId !== rightFamilyId) {
      throw new Error("unpaired-known-family-identity");
    }
    // A renamed label remains visible even with a stable variant or family ID.
    if (((leftId !== null && rightId !== null) ||
         (leftFamilyId !== null && rightFamilyId !== null)) &&
        exactDifference(left.canonicalName || left.foodName, right.identity.canonicalName)) {
      differences.identity++;
    }
    if (exactDifference(left.brand, right.identity.brand) ||
        exactDifference(left.productVariant, right.identity.variant)) differences.variant++;
    if (left.quantity !== right.quantity.value ||
        exactDifference(left.unit, right.quantity.unit) ||
        (right.quantity.grams !== null && abs(left.estimatedGrams, right.quantity.grams) !== 0))
      differences.quantity++;
    const nutrition = right.nutrition.consumed;
    if (!nutrition) {
      if (hasNutrition(left)) differences.nutrition++;
    } else {
      let any = false;
      for (const key of macroKeys) {
        const delta = abs(left[key], nutrition[key]);
        if (delta === null) continue;
        macros[key] = metric((macros[key] ?? 0) + delta);
        if (delta > 0) any = true;
      }
      if (any) differences.nutrition++;
    }
    const origin1 = v1Origin(left), origin2 = v2Origin(right);
    if (origin1 && origin2 && origin1 !== origin2) differences.source++;
    if (right.identity.confidence !== null && Number.isFinite(left.confidence)) {
      confidenceTotal += Math.abs(left.confidence - right.identity.confidence);
      confidenceN++;
    }
  }
  differences.confidence = confidenceN ? metric(confidenceTotal / confidenceN) : null;
  // A V1 clarification exception still has an observable response-level outcome,
  // but no item snapshot. Compare clarification without inventing item pairs.
  // Typed outcome projection, not a lexical decision about food attributes.
  const v1FailureClarifies = { clarification: true, failed: null } as const;
  const v1Clarifies = input.v1?.semanticContract.needsClarification ??
    (input.v1Failure ? v1FailureClarifies[input.v1Failure] : null);
  if (v1Clarifies !== null && input.v2 !== null) {
    differences.clarification = v1Clarifies !== v2.some(item => item.nextAction === "clarify");
  }
  const stages = { s1: 0, s2: 0, s3: 0 };
  for (const item of input.observations) {
    const stage = item.normalizationPath.at(-1)?.stage ?? "S1";
    if (stage === "S1") stages.s1++;
    if (stage === "S2") stages.s2++;
    if (stage === "S3") stages.s3++;
  }
  const context = input.context ?? {};
  const contextCodes: readonly FoodShadowContextStatus[] = [
    "available", "absent", "expired", "unavailable", "not_applicable", "not_instrumented",
  ];
  const safeContext = (value: FoodShadowContextStatus | undefined): FoodShadowContextStatus =>
    value && contextCodes.includes(value) ? value : "not_instrumented";
  return {
    schemaVersion: 1, traceId: input.traceId,
    modality: input.modality, entrypoint: input.entrypoint, scenarioClass: input.scenarioClass,
    run: input.failure !== "none" ? "failed" :
      input.partialEvidence || !input.v1 || !input.v2 ? "partial" : "compared",
    failure: input.failure,
    v1Outcome: summarizeV1(input.v1, input.v1Failure),
    v2Outcome: summarizeV2(input.v2),
    v1ItemsObserved: input.v1 !== null, v2ItemsObserved: input.v2 !== null,
    v1ItemCount: v1.length, v2ItemCount: v2.length, v2Stages: stages,
    context: {
      previousMessage: safeContext(context.previousMessage),
      preferences: safeContext(context.preferences),
      recentHistory: safeContext(context.recentHistory),
    },
    differences,
    flagged: { possibleSilentFallback, v2MissingNutritionProvenance: missingProvenanceCount, explicitFailure, sourceConflicts },
    timings: {
      v1Ms: metric(input.timings.v1Ms), languageMs: metric(input.timings.languageMs),
      resolverMs: metric(input.timings.resolverMs), totalMs: metric(input.timings.totalMs),
    },
    capabilityUsage: summarizeFoodShadowCapabilityUsage(input.capabilityEvents ?? null),
    verifiedCorrect: null,
  };
}

export { buildFoodShadowBaseline } from "./shadowBaseline";
export type { FoodShadowBaselineSegment } from "./shadowBaseline";
