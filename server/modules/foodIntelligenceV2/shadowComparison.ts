/**
 * Issue #1307 — sanitised V1/V2 comparison. An observed difference is not
 * independent proof that either resolver is wrong (ADR §1.3, §19.7).
 * Deliberately never serialize raw text, media, food names or owner identity.
 */
import { AI_CAPABILITIES, type AiCapabilityId } from "../../_core/ai/capabilities";
import type { AiInferenceEvent } from "../../_core/ai/observability";
import type { CanonicalMealProcessingResult, MealDraftItem } from "../../nutritionEngineTypes";
import type { FoodObservation, FoodResolutionDecision } from "./schemas";

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
    unpairedItems: number;
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

const metric = (n: number): number => Number.isFinite(n) && n >= 0 ? Math.round(n * 1000) / 1000 : 0;
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
  observations: readonly AiInferenceEvent[] | null,
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
    estimatedCostUsd: item.costMeasuredCalls === item.calls ? metric(item.estimatedCostUsd ?? 0) : null,
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
  capabilityEvents?: readonly AiInferenceEvent[] | null;
}): FoodShadowEvent {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.traceId)) {
    throw new TypeError("invalid-shadow-trace-id");
  }
  const v1 = input.v1?.items ?? [];
  const v2 = input.v2 ?? [];
  const comparablePairs = input.v1 && input.v2 ? Math.min(v1.length, v2.length) : 0;
  const macroKeys = ["calories", "protein", "carbs", "fat"] as const;
  const macros: FoodShadowEvent["differences"]["macros"] = { calories: null, protein: null, carbs: null, fat: null };
  const differences = {
    comparablePairs, unpairedItems: input.v1 && input.v2 ? Math.abs(v1.length - v2.length) : 0,
    identity: 0, variant: 0, quantity: 0, nutrition: 0, source: 0,
    clarification: null as boolean | null, macros, confidence: null as number | null,
  };
  let possibleSilentFallback = 0;
  for (const item of v1) {
    // Missing provenance on numeric nutrition is suspicious, not a verified failure.
    if (hasNutrition(item) && !v1Origin(item)) possibleSilentFallback++;
  }
  let v2MissingNutritionProvenance = 0;
  let explicitFailure = 0;
  let sourceConflicts = 0;
  for (const item of v2) {
    if (item.nutrition.consumed !== null && (
      !item.nutrition.evidenceIds.length || (!item.nutrition.verified && !item.nutrition.provisional)
    )) v2MissingNutritionProvenance++;
    if (item.nextAction === "reject" || item.status === "unknown") explicitFailure++;
    if (item.reasonCodes.includes("source_conflict")) sourceConflicts++;
  }

  let confidenceTotal = 0;
  let confidenceN = 0;
  for (let i = 0; i < comparablePairs; i++) {
    const left = v1[i], right = v2[i];
    if (exactDifference(left.canonicalName, right.identity.canonicalName)) differences.identity++;
    if (exactDifference(left.brand, right.identity.brand) ||
        exactDifference(left.productVariant, right.identity.variant)) differences.variant++;
    if (left.quantity !== right.quantity ||
        exactDifference(left.unit, right.quantity.unit) ||
        (right.quantity.grams !== null && abs(left.estimatedGrams, right.quantity.grams) !== 0))
      differences.quantity++;
    const nutrition = right.nutrition.consumed;
    if (!nutrition) {
      if (hasNutrition(left)) differences.nutrition++;
    } else {
      let any = false;
      for (const key of macroKeys) {
        const delta = abs(left[key === "calories" ? "calories" : key], nutrition[key]);
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
    flagged: { possibleSilentFallback, v2MissingNutritionProvenance, explicitFailure, sourceConflicts },
    timings: {
      v1Ms: metric(input.timings.v1Ms), languageMs: metric(input.timings.languageMs),
      resolverMs: metric(input.timings.resolverMs), totalMs: metric(input.timings.totalMs),
    },
    capabilityUsage: summarizeFoodShadowCapabilityUsage(input.capabilityEvents ?? null),
    verifiedCorrect: null,
  };
}

export type FoodShadowBaselineSegment = {
  modality: FoodShadowModality; scenarioClass: FoodShadowClass;
  runs: number; compared: number; failed: number; partial: number;
  pairedItems: number; identityDifferences: number; variantDifferences: number;
  quantityDifferences: number; nutritionDifferences: number; sourceDifferences: number;
  clarificationDifferences: number; potentialSilentFallbacks: number;
  missingNutritionProvenance: number; explicitFailures: number;
  macroAbsDelta: FoodShadowEvent["differences"]["macros"];
  totalMs: number; external: FoodShadowCapabilityUsage[] | null;
  /** Never derived from V2 resolved rate or V1/V2 agreement. */
  verifiedAccuracy: null;
};

/** Replays safely from previously sanitised records, never from personal input. */
export function buildFoodShadowBaseline(events: readonly FoodShadowEvent[]) {
  const segments = new Map<string, FoodShadowBaselineSegment>();
  for (const event of events) {
    const key = event.modality + ":" + event.scenarioClass;
    const row = segments.get(key) ?? {
      modality: event.modality, scenarioClass: event.scenarioClass,
      runs: 0, compared: 0, failed: 0, partial: 0, pairedItems: 0,
      identityDifferences: 0, variantDifferences: 0, quantityDifferences: 0,
      nutritionDifferences: 0, sourceDifferences: 0, clarificationDifferences: 0,
      potentialSilentFallbacks: 0, missingNutritionProvenance: 0, explicitFailures: 0,
      macroAbsDelta: { calories: null, protein: null, carbs: null, fat: null },
      totalMs: 0, external: null, verifiedAccuracy: null,
    } satisfies FoodShadowBaselineSegment;
    row.runs++;
    if (event.run === "compared") row.compared++;
    if (event.run === "partial") row.partial++;
    if (event.run === "failed") row.failed++;
    // Partial/unpaired events are visible, but never in the comparison denominator.
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
          ? null : metric(existing.estimatedCostUsd + usage.estimatedCostUsd);
      }
    }
    segments.set(key, row);
  }
  return {
    schemaVersion: 1 as const, totalRuns: events.length,
    /** No corpus oracle has been supplied by this telemetry, even if V1 and V2 agree. */
    verifiedAccuracy: null,
    rolloutEligible: false as const,
    segments: [...segments.values()].sort((a, b) =>
      a.modality.localeCompare(b.modality) || a.scenarioClass.localeCompare(b.scenarioClass)),
  };
}
