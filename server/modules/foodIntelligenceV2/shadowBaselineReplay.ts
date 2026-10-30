/**
 * #1307 / A-004: bounded, read-only replay of previously sanitised C4 telemetry.
 * This is a diagnostic, not an approval verifier or a production event sink.
 */
import { z } from "zod";
import { AI_CAPABILITIES } from "../../_core/ai/capabilities";
import { MAX_SHADOW_EVENT_COST_USD, MAX_SHADOW_MACRO_EVENT_DELTA } from "./shadowPairing";
import { buildFoodShadowBaseline, hasConsistentFoodShadowTimings,
  MAX_SHADOW_TIMING_MS, type FoodShadowEvent, type FoodShadowOutcome } from "./shadowComparison";

const nonnegative = z.number().finite().nonnegative();
const boundedTiming = nonnegative.max(MAX_SHADOW_TIMING_MS);
const boundedCost = nonnegative.max(MAX_SHADOW_EVENT_COST_USD);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const optionalDelta = nonnegative.nullable();
const boundedMacroDelta = nonnegative.max(MAX_SHADOW_MACRO_EVENT_DELTA).nullable();
const states = z.enum([
  "resolved", "partially_resolved", "ambiguous", "unknown", "clarification", "failed", "not_compared",
]);
const contextStatus = z.enum([
  "available", "absent", "expired", "unavailable", "not_applicable", "not_instrumented",
]);
// Outcome metadata describes snapshot presence, never a new food decision.
// Clarification can be either a returned V1 snapshot or a thrown V1 error.
const v1OutcomeSnapshot: Record<FoodShadowOutcome, boolean | null> = {
  resolved: true, partially_resolved: true, ambiguous: true, unknown: true,
  clarification: null, failed: false, not_compared: false,
};
const v2OutcomeSnapshot: Record<FoodShadowOutcome, boolean> = {
  resolved: true, partially_resolved: true, ambiguous: true, unknown: true,
  clarification: true, failed: false, not_compared: false,
};
const capability = z.object({
  capability: z.enum(AI_CAPABILITIES),
  calls: count, retries: count, totalLatencyMs: boundedTiming,
  estimatedCostUsd: boundedCost.nullable(), costMeasuredCalls: count,
}).strict().refine(v => v.calls > 0 && v.retries <= v.calls && v.costMeasuredCalls <= v.calls &&
  (v.costMeasuredCalls === v.calls) === (v.estimatedCostUsd !== null));

/** Reject unexpected keys recursively, including text, media, IDs and provider payloads. */
const shadowEvent = z.object({
  schemaVersion: z.literal(1),
  traceId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
  modality: z.enum(["text", "audio_transcript", "image", "multimodal"]),
  entrypoint: z.enum(["web", "whatsapp", "meal_add", "meal_edit", "label_continuation", "replay"]),
  scenarioClass: z.enum(["generic", "commercial", "quantity", "label", "ambiguous", "unknown", "mixed"]),
  run: z.enum(["compared", "partial", "failed"]),
  failure: z.enum([
    "none", "gate_unavailable", "evidence_unavailable", "language_unavailable",
    "resolver_unavailable", "telemetry_unavailable",
  ]),
  v1Outcome: states, v2Outcome: states,
  v1ItemsObserved: z.boolean(), v2ItemsObserved: z.boolean(),
  v1ItemCount: count, v2ItemCount: count,
  v2Stages: z.object({ s1: count, s2: count, s3: count }).strict(),
  context: z.object({
    previousMessage: contextStatus, preferences: contextStatus, recentHistory: contextStatus,
  }).strict(),
  differences: z.object({
    comparablePairs: count, unpairedItems: count, v1UnpairedItems: count, v2UnpairedItems: count,
    identity: count, variant: count, variantIdUnverifiable: count,
    quantity: count, nutrition: count, source: count,
    clarification: z.boolean().nullable(),
    macros: z.object({
      calories: boundedMacroDelta, protein: boundedMacroDelta,
      carbs: boundedMacroDelta, fat: boundedMacroDelta,
    }).strict(),
    confidence: optionalDelta,
  }).strict(),
  flagged: z.object({
    possibleSilentFallback: count, v2MissingNutritionProvenance: count,
    explicitFailure: count, sourceConflicts: count,
  }).strict(),
  timings: z.object({
    v1Ms: boundedTiming, languageMs: boundedTiming, resolverMs: boundedTiming, totalMs: boundedTiming,
  }).strict(),
  capabilityUsage: z.array(capability).max(AI_CAPABILITIES.length).nullable(),
  verifiedCorrect: z.null(),
}).strict().superRefine((event, ctx) => {
  const { comparablePairs, v1UnpairedItems, v2UnpairedItems, unpairedItems } = event.differences;
  // Empty observed results differ from absent snapshots; counts alone cannot
  // distinguish those cases (including V1 clarification thrown as an error).
  const bothListsObserved = event.v1ItemsObserved && event.v2ItemsObserved;
  const v1RequiredPresence = v1OutcomeSnapshot[event.v1Outcome];
  // Each matched item can contribute at most one discrepancy per dimension.
  // Identity/variant can additionally signal one change per unmatched pair;
  // individual flags are bounded by their observed V1 or V2 population.
  const pairOrReplacementLimit = comparablePairs + Math.min(v1UnpairedItems, v2UnpairedItems);
  const invalidDifferences = event.differences.identity > pairOrReplacementLimit ||
    event.differences.variant > pairOrReplacementLimit ||
    event.differences.variantIdUnverifiable > comparablePairs ||
    event.differences.quantity > comparablePairs ||
    event.differences.nutrition > comparablePairs ||
    event.differences.source > comparablePairs ||
    (comparablePairs === 0 && Object.values(event.differences.macros).some(value => value !== null));
  const invalidFlags = event.flagged.possibleSilentFallback > event.v1ItemCount ||
    event.flagged.v2MissingNutritionProvenance > event.v2ItemCount ||
    event.flagged.explicitFailure > event.v2ItemCount ||
    event.flagged.sourceConflicts > event.v2ItemCount;
  // A-014: the producer compares the V1 clarification outcome against whether
  // any V2 decision requested clarification. A known comparison cannot omit
  // or invert that boolean; a missing side must keep it unknown (null).
  const clarificationComparable = event.v2ItemsObserved &&
    (event.v1ItemsObserved || event.v1Outcome === "clarification");
  const expectedClarification = clarificationComparable
    ? (event.v1Outcome === "clarification") !== (event.v2Outcome === "clarification")
    : null;
  const invalidClarification = event.differences.clarification !== expectedClarification;
  // A-014: `resolved`, `partially_resolved` and `ambiguous` have no rejected
  // or unknown item in the producer's outcome-priority projection. A nonempty
  // `unknown` list must contain an explicit rejection/unknown item. An empty
  // observed list is allowed to be `unknown` with zero explicit failures.
  const invalidExplicitFailures =
    (["resolved", "partially_resolved", "ambiguous"].includes(event.v2Outcome) &&
      event.flagged.explicitFailure !== 0) ||
    (event.v2Outcome === "unknown" && event.v2ItemCount > 0 &&
      event.flagged.explicitFailure === 0);
  // No observations exist when evidence is missing or language comprehension
  // throws before returning. Resolver failures *can* retain observed stages.
  const invalidPreResolutionStages =
    (event.failure === "evidence_unavailable" || event.failure === "language_unavailable") &&
    (event.v2Stages.s1 !== 0 || event.v2Stages.s2 !== 0 || event.v2Stages.s3 !== 0);
  // The resolver maps one decision to each completed language observation.
  // This also applies to partial runs with a V2 snapshot; failed resolver
  // calls have no decisions and may preserve independently observed stages.
  const observedStages = event.v2Stages.s1 + event.v2Stages.s2 + event.v2Stages.s3;
  const invalidCompletedStages = event.failure === "none" && event.v2ItemsObserved &&
    (!Number.isSafeInteger(observedStages) || observedStages !== event.v2ItemCount);
  // Only the V1 adapter can report V1 outcomes. It never emits the V2-only
  // intermediate states. Likewise, an empty V2 decision list means "unknown".
  const invalidOutcomes = ["partially_resolved", "ambiguous", "unknown"].includes(event.v1Outcome) ||
    event.v2Outcome === "failed" ||
    (event.v2ItemsObserved && event.v2ItemCount === 0 && event.v2Outcome !== "unknown");
  // The observer cannot publish V2 decisions after evidence/language/resolver
  // failure; silently combining a resolved V2 with such a failure corrupts SLOs.
  const invalidFailureState = event.failure !== "none" &&
    (event.v2ItemsObserved || event.v2Outcome !== "not_compared");
  // A real positive macro delta necessarily increments the paired nutrition
  // difference counter. Zero-sized deltas and missing (null) deltas are valid.
  const invalidMacroDifference = event.differences.nutrition === 0 &&
    Object.values(event.differences.macros).some(value => value !== null && value > 0);
  if (unpairedItems !== v1UnpairedItems + v2UnpairedItems ||
    invalidDifferences || invalidFlags || invalidClarification ||
    invalidOutcomes || invalidFailureState || invalidMacroDifference ||
    invalidExplicitFailures || invalidPreResolutionStages || invalidCompletedStages ||
    !hasConsistentFoodShadowTimings(event.timings) ||
    comparablePairs + v1UnpairedItems > event.v1ItemCount ||
    comparablePairs + v2UnpairedItems > event.v2ItemCount ||
    (!event.v1ItemsObserved && event.v1ItemCount !== 0) ||
    (!event.v2ItemsObserved && event.v2ItemCount !== 0) ||
    (!bothListsObserved && (comparablePairs !== 0 || unpairedItems !== 0)) ||
    (event.run === "compared" && !bothListsObserved) ||
    (v1RequiredPresence !== null && v1RequiredPresence !== event.v1ItemsObserved) ||
    (v2OutcomeSnapshot[event.v2Outcome] !== event.v2ItemsObserved) ||
    (bothListsObserved && (
      comparablePairs + v1UnpairedItems !== event.v1ItemCount ||
      comparablePairs + v2UnpairedItems !== event.v2ItemCount
    )) ||
    (event.run === "failed") === (event.failure === "none")) {
    ctx.addIssue({ code: "custom", message: "inconsistent-shadow-event" });
  }
  if (event.capabilityUsage && new Set(event.capabilityUsage.map(v => v.capability)).size !==
    event.capabilityUsage.length) {
    ctx.addIssue({ code: "custom", message: "duplicate-shadow-capability" });
  }
});

const replayEnvelope = z.object({
  schemaVersion: z.literal(1),
  kind: z.literal("food-v2-sanitized-shadow-events"),
  events: z.array(shadowEvent).min(1).max(10000),
}).strict();

/**
 * Never accepts a claimed approval or an accuracy label. No trace IDs or
 * individual events leave this function. The caller must independently prove
 * capture provenance, Gate A, sampling window, oracle and privacy approval.
 */
export function replaySanitizedFoodShadowEvents(raw: unknown) {
  const checked = replayEnvelope.safeParse(raw);
  if (!checked.success) throw new TypeError("invalid-sanitized-shadow-events");
  const ids = new Set<string>();
  for (const event of checked.data.events) {
    if (ids.has(event.traceId)) throw new TypeError("duplicate-shadow-trace-id");
    ids.add(event.traceId);
  }
  const baseline = buildFoodShadowBaseline(checked.data.events as FoodShadowEvent[]);
  return {
    schemaVersion: 1 as const,
    status: "diagnostic-only" as const,
    gateAApproved: false as const,
    sampleProvenanceVerified: false as const,
    baseline,
  };
}
