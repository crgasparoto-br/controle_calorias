/** Read-only aggregate replay of sanitised V1/V2 diagnostics. Never asserts Gate A. */
import type { FoodShadowCapabilityUsage, FoodShadowEvent, FoodShadowOutcome, FoodShadowEntrypoint, FoodShadowClass, FoodShadowModality } from "./shadowComparison";
import { metric, costMetric } from "./shadowPairing";

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
  pairedItems: number;
  /** Observed gaps, including partial runs; not verified matching errors. */
  unpairedItems: number; v1UnpairedItems: number; v2UnpairedItems: number;
  identityDifferences: number; variantDifferences: number; variantIdUnverifiable: number;
  quantityDifferences: number; nutritionDifferences: number; sourceDifferences: number;
  clarificationDifferences: number; potentialSilentFallbacks: number;
  missingNutritionProvenance: number; explicitFailures: number;
  macroAbsDelta: FoodShadowEvent["differences"]["macros"];
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

/** Replays safely from previously sanitised records, never from personal input. */
export function buildFoodShadowBaseline(events: readonly FoodShadowEvent[]) {
  const segments = new Map<string, FoodShadowBaselineSegment>();
  const samples = new Map<string, { v1: number[]; shadow: number[] }>();
  for (const event of events) {
    const key = [event.modality, event.entrypoint, event.scenarioClass].join(":");
    const row = segments.get(key) ?? {
      modality: event.modality, entrypoint: event.entrypoint, scenarioClass: event.scenarioClass,
      runs: 0, compared: 0, failed: 0, partial: 0, pairedItems: 0,
      v1Outcomes: emptyOutcomeCounts(), v2Outcomes: emptyOutcomeCounts(),
      v1LatencyP50Ms: null, v1LatencyP95Ms: null, shadowCompletionP95Ms: null,
      unpairedItems: 0, v1UnpairedItems: 0, v2UnpairedItems: 0,
      identityDifferences: 0, variantDifferences: 0, variantIdUnverifiable: 0, quantityDifferences: 0,
      nutritionDifferences: 0, sourceDifferences: 0, clarificationDifferences: 0,
      potentialSilentFallbacks: 0, missingNutritionProvenance: 0, explicitFailures: 0,
      macroAbsDelta: { calories: null, protein: null, carbs: null, fat: null },
      totalMs: 0, external: null, verifiedAccuracy: null,
    } satisfies FoodShadowBaselineSegment;
    row.runs++;
    row.v1Outcomes[event.v1Outcome]++;
    row.v2Outcomes[event.v2Outcome]++;
    const sample = samples.get(key) ?? { v1: [], shadow: [] };
    sample.v1.push(metric(event.timings.v1Ms));
    sample.shadow.push(metric(event.timings.totalMs));
    samples.set(key, sample);
    if (event.run === "compared") row.compared++;
    if (event.run === "partial") row.partial++;
    if (event.run === "failed") row.failed++;
    // Report missing items even for partial observations; they never increase
    // the eligible-pair denominator or imply a verified accuracy failure.
    row.unpairedItems += event.differences.unpairedItems;
    row.v1UnpairedItems += event.differences.v1UnpairedItems;
    row.v2UnpairedItems += event.differences.v2UnpairedItems;
    // Only complete comparisons contribute to paired/macro denominators.
    if (event.run === "compared") {
      row.pairedItems += event.differences.comparablePairs;
      row.identityDifferences += event.differences.identity;
      row.variantDifferences += event.differences.variant;
      row.variantIdUnverifiable += event.differences.variantIdUnverifiable;
      row.quantityDifferences += event.differences.quantity;
      row.nutritionDifferences += event.differences.nutrition;
      row.sourceDifferences += event.differences.source;
      for (const field of ["calories", "protein", "carbs", "fat"] as const) {
        const delta = event.differences.macros[field];
        if (delta !== null) row.macroAbsDelta[field] = metric((row.macroAbsDelta[field] ?? 0) + delta);
      }
    }
    // Outcome-level clarification is comparable even when V1 threw a
    // clarification exception and item-level comparison is partial.
    if (event.differences.clarification === true) row.clarificationDifferences++;
    row.potentialSilentFallbacks += event.flagged.possibleSilentFallback;
    row.missingNutritionProvenance += event.flagged.v2MissingNutritionProvenance;
    row.explicitFailures += event.flagged.explicitFailure;
    row.totalMs += event.timings.totalMs;
    if (event.capabilityUsage !== null) {
      row.external ??= [];
      for (const usage of event.capabilityUsage) {
        const existing = row.external.find(item => item.capability === usage.capability);
        if (!existing) { row.external.push({ ...usage }); continue; }
        existing.calls += usage.calls;
        existing.retries += usage.retries;
        existing.totalLatencyMs = metric(existing.totalLatencyMs + usage.totalLatencyMs);
        existing.costMeasuredCalls += usage.costMeasuredCalls;
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
