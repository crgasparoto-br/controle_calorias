/** Read-only aggregate replay of sanitised V1/V2 diagnostics. Never asserts Gate A. */
import { AI_CAPABILITIES } from "../../_core/ai/capabilities";
import type { FoodShadowCapabilityUsage, FoodShadowEvent, FoodShadowOutcome, FoodShadowEntrypoint, FoodShadowClass, FoodShadowModality } from "./shadowComparison";
import { metric, costMetric, boundedShadowMacroDelta, boundedShadowCount, sumShadowCounts, hasConsistentFoodShadowTimings, MAX_SHADOW_TIMING_MS, MAX_SHADOW_REPLAY_EVENTS, MAX_SHADOW_EVENT_COST_USD, MAX_SHADOW_MACRO_REPLAY_DELTA } from "./shadowPairing";

export type FoodShadowBaselineSegment = {
  modality: FoodShadowModality; entrypoint: FoodShadowEntrypoint; scenarioClass: FoodShadowClass;
  runs: number; compared: number; failed: number; partial: number;
  /** Resolution distributions are not verified accuracy rates. */
  v1Outcomes: Record<FoodShadowOutcome, number>;
  v2Outcomes: Record<FoodShadowOutcome, number>;
  /** Observed latencies. Nearest-rank percentiles, never approved SLOs. */
  v1LatencyP50Ms: number | null;
  v1LatencyP95Ms: number | null;
  shadowCompletionP95Ms: number | null;
  /** Stage percentiles include only attempts with completed timing instrumentation. */
  languageLatencySamples: number;
  languageLatencyP50Ms: number | null;
  languageLatencyP95Ms: number | null;
  resolverLatencySamples: number;
  resolverLatencyP50Ms: number | null;
  resolverLatencyP95Ms: number | null;
  /** Observed linguistic normalization stages, not claimed verified matches. */
  v2Stages: FoodShadowEvent["v2Stages"];
  pairedItems: number;
  /** Observed gaps, including partial runs; not verified matching errors. */
  unpairedItems: number; v1UnpairedItems: number; v2UnpairedItems: number;
  identityDifferences: number; variantDifferences: number; variantIdUnverifiable: number;
  quantityDifferences: number; nutritionDifferences: number; sourceDifferences: number;
  clarificationDifferences: number; potentialSilentFallbacks: number;
  missingNutritionProvenance: number; explicitFailures: number;
  sourceConflicts: number;
  macroAbsDelta: FoodShadowEvent["differences"]["macros"];
  /** null capabilityUsage means unknown instrumentation, not zero calls. */
  capabilityUsageObservedRuns: number; capabilityUsageUnavailableRuns: number;
  totalMs: number; external: FoodShadowCapabilityUsage[] | null;
  /** Never derived from V2 resolved rate or V1/V2 agreement. */
  verifiedAccuracy: null;
};

const emptyOutcomeCounts = (): Record<FoodShadowOutcome, number> => ({
  resolved: 0, partially_resolved: 0, ambiguous: 0, unknown: 0,
  clarification: 0, failed: 0, not_compared: 0,
});

/** Nearest-rank percentile; no threshold is implied by the statistic. */
function observedPercentile(values: readonly number[], fraction: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return metric(sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)]);
}

const countDifferenceFields = [
  "comparablePairs", "unpairedItems", "v1UnpairedItems", "v2UnpairedItems",
  "identity", "variant", "variantIdUnverifiable", "quantity", "nutrition", "source",
] as const;
const countFlagFields = [
  "possibleSilentFallback", "v2MissingNutritionProvenance", "explicitFailure", "sourceConflicts",
] as const;
const macroFields = ["calories", "protein", "carbs", "fat"] as const;
const MAX_SHADOW_REPLAY_TIMING_MS = MAX_SHADOW_REPLAY_EVENTS * MAX_SHADOW_TIMING_MS;

function boundedShadowTiming(value: number, max = MAX_SHADOW_TIMING_MS): number {
  if (!Number.isFinite(value) || value < 0 || value > max)
    throw new TypeError("invalid-shadow-timing");
  return value;
}

/** Check every numeric field before aggregation, even on partial/failed runs. */
function validateShadowEventNumbers(event: FoodShadowEvent): void {
  boundedShadowCount(event.v1ItemCount);
  boundedShadowCount(event.v2ItemCount);
  for (const stage of ["s1", "s2", "s3"] as const)
    boundedShadowCount(event.v2Stages[stage]);
  for (const field of countDifferenceFields)
    boundedShadowCount(event.differences[field]);
  for (const field of countFlagFields)
    boundedShadowCount(event.flagged[field]);
  for (const field of macroFields) {
    const delta = event.differences.macros[field];
    if (delta !== null) boundedShadowMacroDelta(delta);
  }
  const confidence = event.differences.confidence;
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0))
    throw new TypeError("invalid-shadow-confidence");
  if (!hasConsistentFoodShadowTimings(event.timings))
    throw new TypeError("invalid-shadow-timing");

  if (event.capabilityUsage !== null) {
    const seen = new Set<string>();
    if (event.capabilityUsage.length > AI_CAPABILITIES.length)
      throw new TypeError("invalid-shadow-capability");
    for (const usage of event.capabilityUsage) {
      if (!AI_CAPABILITIES.includes(usage.capability) || seen.has(usage.capability))
        throw new TypeError("invalid-shadow-capability");
      seen.add(usage.capability);
      const calls = boundedShadowCount(usage.calls);
      const retries = boundedShadowCount(usage.retries);
      const measured = boundedShadowCount(usage.costMeasuredCalls);
      if (calls === 0 || retries > calls || measured > calls)
        throw new TypeError("invalid-shadow-count");
      boundedShadowTiming(usage.totalLatencyMs);
      if ((measured === calls) !== (usage.estimatedCostUsd !== null) ||
          (usage.estimatedCostUsd !== null &&
           (!Number.isFinite(usage.estimatedCostUsd) || usage.estimatedCostUsd < 0 ||
            usage.estimatedCostUsd > MAX_SHADOW_EVENT_COST_USD)))
        throw new TypeError("invalid-shadow-capability-cost");
    }
  }
}

/** Replays safely from previously sanitised records, never from personal input. */
export function buildFoodShadowBaseline(events: readonly FoodShadowEvent[]) {
  if (events.length > MAX_SHADOW_REPLAY_EVENTS) throw new TypeError("invalid-shadow-count");
  const segments = new Map<string, FoodShadowBaselineSegment>();
  const samples = new Map<string, { v1: number[]; shadow: number[]; language: number[]; resolver: number[] }>();
  for (const event of events) {
    // Fail closed before the run-state decides which fields enter denominators.
    validateShadowEventNumbers(event);
    const key = [event.modality, event.entrypoint, event.scenarioClass].join(":");
    const row = segments.get(key) ?? {
      modality: event.modality, entrypoint: event.entrypoint, scenarioClass: event.scenarioClass,
      runs: 0, compared: 0, failed: 0, partial: 0, pairedItems: 0,
      v1Outcomes: emptyOutcomeCounts(), v2Outcomes: emptyOutcomeCounts(),
      v1LatencyP50Ms: null, v1LatencyP95Ms: null, shadowCompletionP95Ms: null,
      languageLatencySamples: 0, languageLatencyP50Ms: null, languageLatencyP95Ms: null,
      resolverLatencySamples: 0, resolverLatencyP50Ms: null, resolverLatencyP95Ms: null,
      v2Stages: { s1: 0, s2: 0, s3: 0 },
      unpairedItems: 0, v1UnpairedItems: 0, v2UnpairedItems: 0,
      identityDifferences: 0, variantDifferences: 0, variantIdUnverifiable: 0, quantityDifferences: 0,
      nutritionDifferences: 0, sourceDifferences: 0, clarificationDifferences: 0,
      potentialSilentFallbacks: 0, missingNutritionProvenance: 0, explicitFailures: 0,
      sourceConflicts: 0,
      macroAbsDelta: { calories: null, protein: null, carbs: null, fat: null },
      capabilityUsageObservedRuns: 0, capabilityUsageUnavailableRuns: 0,
      totalMs: 0, external: null, verifiedAccuracy: null,
    } satisfies FoodShadowBaselineSegment;
    row.runs = sumShadowCounts(row.runs, 1);
    row.v1Outcomes[event.v1Outcome] = sumShadowCounts(row.v1Outcomes[event.v1Outcome], 1);
    row.v2Outcomes[event.v2Outcome] = sumShadowCounts(row.v2Outcomes[event.v2Outcome], 1);
    const sample = samples.get(key) ?? { v1: [], shadow: [], language: [], resolver: [] };
    sample.v1.push(metric(event.timings.v1Ms));
    sample.shadow.push(metric(event.timings.totalMs));
    // A failed/missing language stage carries a default zero, not a measured
    // duration. Resolver failure still measures its attempted duration.
    if (event.v2ItemsObserved || event.failure === "resolver_unavailable") {
      sample.language.push(metric(event.timings.languageMs));
      sample.resolver.push(metric(event.timings.resolverMs));
    }
    samples.set(key, sample);
    row.v2Stages.s1 = sumShadowCounts(row.v2Stages.s1, event.v2Stages.s1);
    row.v2Stages.s2 = sumShadowCounts(row.v2Stages.s2, event.v2Stages.s2);
    row.v2Stages.s3 = sumShadowCounts(row.v2Stages.s3, event.v2Stages.s3);
    if (event.run === "compared") row.compared = sumShadowCounts(row.compared, 1);
    if (event.run === "partial") row.partial = sumShadowCounts(row.partial, 1);
    if (event.run === "failed") row.failed = sumShadowCounts(row.failed, 1);
    // Report missing items even for partial observations; they never increase
    // the eligible-pair denominator or imply a verified accuracy failure.
    row.unpairedItems = sumShadowCounts(row.unpairedItems, event.differences.unpairedItems);
    row.v1UnpairedItems = sumShadowCounts(row.v1UnpairedItems, event.differences.v1UnpairedItems);
    row.v2UnpairedItems = sumShadowCounts(row.v2UnpairedItems, event.differences.v2UnpairedItems);
    // Only complete comparisons contribute to paired/macro denominators.
    if (event.run === "compared") {
      row.pairedItems = sumShadowCounts(row.pairedItems, event.differences.comparablePairs);
      row.identityDifferences = sumShadowCounts(row.identityDifferences, event.differences.identity);
      row.variantDifferences = sumShadowCounts(row.variantDifferences, event.differences.variant);
      row.variantIdUnverifiable = sumShadowCounts(row.variantIdUnverifiable, event.differences.variantIdUnverifiable);
      row.quantityDifferences = sumShadowCounts(row.quantityDifferences, event.differences.quantity);
      row.nutritionDifferences = sumShadowCounts(row.nutritionDifferences, event.differences.nutrition);
      row.sourceDifferences = sumShadowCounts(row.sourceDifferences, event.differences.source);
      for (const field of macroFields) {
        const delta = event.differences.macros[field];
        if (delta !== null) row.macroAbsDelta[field] = boundedShadowMacroDelta(
          (row.macroAbsDelta[field] ?? 0) + delta, MAX_SHADOW_MACRO_REPLAY_DELTA);
      }
    }
    // Outcome-level clarification is comparable even when V1 threw a
    // clarification exception and item-level comparison is partial.
    if (event.differences.clarification === true) row.clarificationDifferences = sumShadowCounts(row.clarificationDifferences, 1);
    row.potentialSilentFallbacks = sumShadowCounts(row.potentialSilentFallbacks, event.flagged.possibleSilentFallback);
    row.missingNutritionProvenance = sumShadowCounts(row.missingNutritionProvenance, event.flagged.v2MissingNutritionProvenance);
    row.explicitFailures = sumShadowCounts(row.explicitFailures, event.flagged.explicitFailure);
    row.sourceConflicts = sumShadowCounts(row.sourceConflicts, event.flagged.sourceConflicts);
    row.totalMs = boundedShadowTiming(row.totalMs + event.timings.totalMs, MAX_SHADOW_REPLAY_TIMING_MS);
    if (event.capabilityUsage === null) {
      row.capabilityUsageUnavailableRuns = sumShadowCounts(row.capabilityUsageUnavailableRuns, 1);
    } else {
      row.capabilityUsageObservedRuns = sumShadowCounts(row.capabilityUsageObservedRuns, 1);
      row.external ??= [];
      for (const usage of event.capabilityUsage) {
        // Already validated before denominators were touched, including first use.
        const { calls, retries, costMeasuredCalls } = usage;
        const existing = row.external.find(item => item.capability === usage.capability);
        if (!existing) { row.external.push({ ...usage, calls, retries, costMeasuredCalls }); continue; }
        existing.calls = sumShadowCounts(existing.calls, calls);
        existing.retries = sumShadowCounts(existing.retries, retries);
        existing.totalLatencyMs = metric(boundedShadowTiming(
          existing.totalLatencyMs + usage.totalLatencyMs, MAX_SHADOW_REPLAY_TIMING_MS));
        existing.costMeasuredCalls = sumShadowCounts(existing.costMeasuredCalls, costMeasuredCalls);
        existing.estimatedCostUsd = existing.estimatedCostUsd === null || usage.estimatedCostUsd === null
          ? null : costMetric(existing.estimatedCostUsd + usage.estimatedCostUsd);
      }
    }
    segments.set(key, row);
  }
  for (const [key, row] of segments) {
    const sample = samples.get(key)!;
    row.v1LatencyP50Ms = observedPercentile(sample.v1, 0.5);
    row.v1LatencyP95Ms = observedPercentile(sample.v1, 0.95);
    row.shadowCompletionP95Ms = observedPercentile(sample.shadow, 0.95);
    row.languageLatencySamples = sample.language.length;
    row.languageLatencyP50Ms = observedPercentile(sample.language, 0.5);
    row.languageLatencyP95Ms = observedPercentile(sample.language, 0.95);
    row.resolverLatencySamples = sample.resolver.length;
    row.resolverLatencyP50Ms = observedPercentile(sample.resolver, 0.5);
    row.resolverLatencyP95Ms = observedPercentile(sample.resolver, 0.95);
  }
  return {
    schemaVersion: 1 as const, totalRuns: events.length,
    /** No corpus oracle has been supplied by this telemetry, even if V1 and V2 agree. */
    verifiedAccuracy: null,
    rolloutEligible: false as const,
    segments: [...segments.values()].sort((a, b) =>
      a.modality.localeCompare(b.modality) || a.entrypoint.localeCompare(b.entrypoint) ||
      a.scenarioClass.localeCompare(b.scenarioClass)),
  };
}
