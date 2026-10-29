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

const metric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
/** Cost precision must not round small billable calls down to zero. */
const costMetric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 100000000) / 100000000 : 0;
const abs = (a: number, b: number): number | null =>
  Number.isFinite(a) && Number.isFinite(b) && a >= 0 && b >= 0
    ? metric(Math.abs(a - b)) : null;
const normalize = (s: string | null | undefined) =>
  (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const exactDifference = (a: string | null | undefined, b: string | null | undefined) =>
  normalize(a) !== normalize(b);
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

/**
 * Align by normalized food identity, never by array position. Match stable
 * brand/variant first; then compare remaining same-name variants to report
 * a real variant difference. Repetitions select the closest saved quantity
 * and nutrition, avoiding false macro drift after reordering.
 * No free-form identity or food name is emitted to telemetry.
 */
function shadowPairCost(left: MealDraftItem, right: FoodResolutionDecision): number {
  const nutrition = right.nutrition.consumed;
  const macroDelta = nutrition ?
    (abs(left.calories, nutrition.calories) ?? 0) +
    (abs(left.protein, nutrition.protein) ?? 0) +
    (abs(left.carbs, nutrition.carbs) ?? 0) +
    (abs(left.fat, nutrition.fat) ?? 0) : 0;
  return (exactDifference(left.brand, right.identity.brand) ? 1000000 : 0) +
    (exactDifference(left.productVariant, right.identity.variant) ? 1000000 : 0) +
    (exactDifference(left.unit, right.quantity.unit) ? 100000 : 0) +
    (right.quantity.value === null ? 1000 : (abs(left.quantity, right.quantity.value) ?? 1000)) * 1000 +
    (right.quantity.grams === null ? 0 : (abs(left.estimatedGrams, right.quantity.grams) ?? 1000) * 10) +
    macroDelta;
}

function pairFoodShadowItems(
  left: readonly MealDraftItem[], right: readonly FoodResolutionDecision[],
): Array<{ left: MealDraftItem; right: FoodResolutionDecision }> {
  const usedLeft = new Set<number>();
  const usedRight = new Set<number>();
  const pairs: Array<{ left: MealDraftItem; right: FoodResolutionDecision }> = [];
  for (const exactVariant of [true, false]) {
    const candidates: Array<{ i: number; j: number; cost: number }> = [];
    for (let i = 0; i < left.length; i++) {
      if (usedLeft.has(i)) continue;
      const name = normalize(left[i].canonicalName || left[i].foodName);
      if (!name) continue;
      for (let j = 0; j < right.length; j++) {
        if (usedRight.has(j) || name !== normalize(right[j].identity.canonicalName)) continue;
        if (exactVariant && (exactDifference(left[i].brand, right[j].identity.brand) ||
          exactDifference(left[i].productVariant, right[j].identity.variant))) continue;
        candidates.push({ i, j, cost: shadowPairCost(left[i], right[j]) });
      }
    }
    candidates.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j);
    for (const { i, j } of candidates) {
      if (usedLeft.has(i) || usedRight.has(j)) continue;
      usedLeft.add(i);
      usedRight.add(j);
      pairs.push({ left: left[i], right: right[j] });
    }
  }
  return pairs;
}

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
  const v1 = input.v1?.items ?? [];
  const v2 = input.v2 ?? [];
  const matchedPairs = input.v1 && input.v2 ? pairFoodShadowItems(v1, v2) : [];
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
    identity: Math.min(leftUnpaired, rightUnpaired), variant: 0, quantity: 0, nutrition: 0, source: 0,
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
  if (input.v1 && input.v2) {
    differences.clarification =
      input.v1.semanticContract.needsClarification !== v2.some(item => item.nextAction === "clarify");
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
    run: input.failure !== "none" ? "failed" : input.partialEvidence ? "partial" : "compared",
    failure: input.failure,
    v1Outcome: summarizeV1(input.v1, input.v1Failure),
    v2Outcome: summarizeV2(input.v2),
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
  identityDifferences: number; variantDifferences: number;
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
      identityDifferences: 0, variantDifferences: 0, quantityDifferences: 0,
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
      row.quantityDifferences += event.differences.quantity;
      row.nutritionDifferences += event.differences.nutrition;
      row.sourceDifferences += event.differences.source;
      if (event.differences.clarification) row.clarificationDifferences++;
      for (const field of ["calories", "protein", "carbs", "fat"] as const) {
        const delta = event.differences.macros[field];
        if (delta !== null) row.macroAbsDelta[field] = metric((row.macroAbsDelta[field] ?? 0) + delta);
      }
    }
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
