import type { NutritionSourceSelection } from "./nutritionSourceSelection";

export const NUTRITION_ESTIMATE_EVALUATION_VERSION = "nutrition-estimate-evaluation-v1";

export type NutritionMacroValues = {
  caloriesKcal: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type EstimatedNutritionRecord = {
  foodName: string;
  brandName?: string | null;
  category?: string | null;
  preparation?: string | null;
  unit?: string | null;
  grams?: number | null;
  values: NutritionMacroValues;
  source: NutritionSourceSelection;
};

export type ConfirmedNutritionRecord = {
  foodName: string;
  brandName?: string | null;
  category?: string | null;
  preparation?: string | null;
  unit?: string | null;
  grams?: number | null;
  values: NutritionMacroValues;
  source: NutritionSourceSelection;
};

export type NutritionEstimateEvaluationThresholds = {
  caloriesAbsoluteKcal?: number;
  caloriesRelativeRatio?: number;
  macroAbsoluteG?: number;
  macroRelativeRatio?: number;
};

export type NutrientDivergence = {
  nutrient: keyof NutritionMacroValues;
  estimated: number;
  confirmed: number;
  absoluteError: number;
  relativeError: number | null;
};

export type NutritionEstimateEvaluationResult = {
  foodName: string;
  brandName: string | null;
  category: string | null;
  preparation: string | null;
  unit: string | null;
  grams: number | null;
  estimatedSource: NutritionSourceSelection;
  confirmedSource: NutritionSourceSelection;
  divergences: NutrientDivergence[];
  maxRelativeError: number | null;
  caloriesAbsoluteError: number;
  caloriesRelativeError: number | null;
  relevantDivergence: boolean;
  reviewReason: "estimated_vs_confirmed_divergence" | "estimate_source_not_reviewable" | "within_threshold";
  reviewPriority: "low" | "medium" | "high" | "critical";
  confidenceAdjustment: number;
  evaluationVersion: typeof NUTRITION_ESTIMATE_EVALUATION_VERSION;
};

export type NutritionEstimateCategoryMetric = {
  category: string;
  sampleCount: number;
  relevantDivergenceCount: number;
  averageCaloriesAbsoluteError: number;
  averageCaloriesRelativeError: number | null;
  maxCaloriesRelativeError: number | null;
  averageMaxRelativeError: number | null;
};

const DEFAULT_THRESHOLDS: Required<NutritionEstimateEvaluationThresholds> = {
  caloriesAbsoluteKcal: 50,
  caloriesRelativeRatio: 0.25,
  macroAbsoluteG: 8,
  macroRelativeRatio: 0.3,
};

const ESTIMATED_SOURCE_TYPES = new Set<NutritionSourceSelection["type"]>([
  "documented_estimate",
  "ai_inferred",
  "pending_review",
]);

function round(value: number) {
  return Math.round(value * 100) / 100;
}

function finiteNumber(value: number | null | undefined, fallback = 0) {
  return Number.isFinite(value ?? NaN) ? Number(value) : fallback;
}

function relativeError(estimated: number, confirmed: number) {
  if (confirmed === 0) return estimated === 0 ? 0 : null;
  return Math.abs(estimated - confirmed) / Math.abs(confirmed);
}

function normalizeValues(values: NutritionMacroValues): NutritionMacroValues {
  return {
    caloriesKcal: finiteNumber(values.caloriesKcal),
    proteinG: finiteNumber(values.proteinG),
    carbsG: finiteNumber(values.carbsG),
    fatG: finiteNumber(values.fatG),
  };
}

function maxNullable(values: Array<number | null>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  return finite.length ? Math.max(...finite) : null;
}

function averageNullable(values: Array<number | null>) {
  const finite = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (!finite.length) return null;
  return round(finite.reduce((sum, value) => sum + value, 0) / finite.length);
}

export function isReviewableEstimatedNutritionSource(source: NutritionSourceSelection) {
  return source.isEstimated || ESTIMATED_SOURCE_TYPES.has(source.type);
}

export function buildMacroValuesFromPer100g(params: {
  grams: number;
  caloriesKcalPer100g: number;
  proteinGPer100g: number;
  carbsGPer100g: number;
  fatGPer100g: number;
}): NutritionMacroValues {
  const factor = finiteNumber(params.grams) / 100;
  return {
    caloriesKcal: round(finiteNumber(params.caloriesKcalPer100g) * factor),
    proteinG: round(finiteNumber(params.proteinGPer100g) * factor),
    carbsG: round(finiteNumber(params.carbsGPer100g) * factor),
    fatG: round(finiteNumber(params.fatGPer100g) * factor),
  };
}

function buildDivergences(estimated: NutritionMacroValues, confirmed: NutritionMacroValues): NutrientDivergence[] {
  return (["caloriesKcal", "proteinG", "carbsG", "fatG"] as Array<keyof NutritionMacroValues>).map(nutrient => {
    const estimatedValue = estimated[nutrient];
    const confirmedValue = confirmed[nutrient];
    return {
      nutrient,
      estimated: estimatedValue,
      confirmed: confirmedValue,
      absoluteError: round(Math.abs(estimatedValue - confirmedValue)),
      relativeError: relativeError(estimatedValue, confirmedValue) === null
        ? null
        : round(relativeError(estimatedValue, confirmedValue) as number),
    };
  });
}

function hasRelevantDivergence(divergences: NutrientDivergence[], thresholds: Required<NutritionEstimateEvaluationThresholds>) {
  return divergences.some(divergence => {
    if (divergence.nutrient === "caloriesKcal") {
      return divergence.absoluteError >= thresholds.caloriesAbsoluteKcal
        || (divergence.relativeError !== null && divergence.relativeError >= thresholds.caloriesRelativeRatio);
    }

    return divergence.absoluteError >= thresholds.macroAbsoluteG
      || (divergence.relativeError !== null && divergence.relativeError >= thresholds.macroRelativeRatio);
  });
}

function reviewPriority(result: Pick<NutritionEstimateEvaluationResult, "relevantDivergence" | "caloriesAbsoluteError" | "caloriesRelativeError" | "maxRelativeError">) {
  if (!result.relevantDivergence) return "low" as const;
  if (result.caloriesAbsoluteError >= 180 || (result.caloriesRelativeError ?? 0) >= 0.6 || (result.maxRelativeError ?? 0) >= 1) {
    return "critical" as const;
  }
  if (result.caloriesAbsoluteError >= 100 || (result.caloriesRelativeError ?? 0) >= 0.4 || (result.maxRelativeError ?? 0) >= 0.6) {
    return "high" as const;
  }
  return "medium" as const;
}

function confidenceAdjustment(params: { relevantDivergence: boolean; maxRelativeError: number | null; caloriesRelativeError: number | null }) {
  if (!params.relevantDivergence) return 0;
  const maxError = Math.max(params.maxRelativeError ?? 0, params.caloriesRelativeError ?? 0);
  if (maxError >= 1) return -0.25;
  if (maxError >= 0.6) return -0.18;
  if (maxError >= 0.3) return -0.12;
  return -0.08;
}

export function compareNutritionEstimateWithConfirmedSource(params: {
  estimated: EstimatedNutritionRecord;
  confirmed: ConfirmedNutritionRecord;
  thresholds?: NutritionEstimateEvaluationThresholds;
}): NutritionEstimateEvaluationResult {
  const thresholds = { ...DEFAULT_THRESHOLDS, ...params.thresholds };
  const estimatedValues = normalizeValues(params.estimated.values);
  const confirmedValues = normalizeValues(params.confirmed.values);
  const divergences = buildDivergences(estimatedValues, confirmedValues);
  const calories = divergences.find(divergence => divergence.nutrient === "caloriesKcal");
  const relevantDivergence = hasRelevantDivergence(divergences, thresholds);
  const maxRelativeError = maxNullable(divergences.map(divergence => divergence.relativeError));
  const reviewableEstimate = isReviewableEstimatedNutritionSource(params.estimated.source);
  const caloriesRelativeError = calories?.relativeError ?? null;
  const baseResult = {
    relevantDivergence: reviewableEstimate && relevantDivergence,
    caloriesAbsoluteError: calories?.absoluteError ?? 0,
    caloriesRelativeError,
    maxRelativeError,
  };

  return {
    foodName: params.estimated.foodName,
    brandName: params.estimated.brandName ?? params.confirmed.brandName ?? null,
    category: params.estimated.category ?? params.confirmed.category ?? null,
    preparation: params.estimated.preparation ?? params.confirmed.preparation ?? null,
    unit: params.estimated.unit ?? params.confirmed.unit ?? null,
    grams: params.estimated.grams ?? params.confirmed.grams ?? null,
    estimatedSource: params.estimated.source,
    confirmedSource: params.confirmed.source,
    divergences,
    maxRelativeError,
    caloriesAbsoluteError: baseResult.caloriesAbsoluteError,
    caloriesRelativeError,
    relevantDivergence: baseResult.relevantDivergence,
    reviewReason: !reviewableEstimate
      ? "estimate_source_not_reviewable"
      : baseResult.relevantDivergence
        ? "estimated_vs_confirmed_divergence"
        : "within_threshold",
    reviewPriority: reviewPriority(baseResult),
    confidenceAdjustment: confidenceAdjustment(baseResult),
    evaluationVersion: NUTRITION_ESTIMATE_EVALUATION_VERSION,
  };
}

export function aggregateNutritionEstimateErrorMetrics(results: NutritionEstimateEvaluationResult[]): NutritionEstimateCategoryMetric[] {
  const groups = new Map<string, NutritionEstimateEvaluationResult[]>();
  for (const result of results) {
    const category = result.category?.trim() || "sem_categoria";
    groups.set(category, [...(groups.get(category) ?? []), result]);
  }

  return Array.from(groups.entries())
    .map(([category, group]) => ({
      category,
      sampleCount: group.length,
      relevantDivergenceCount: group.filter(result => result.relevantDivergence).length,
      averageCaloriesAbsoluteError: round(group.reduce((sum, result) => sum + result.caloriesAbsoluteError, 0) / group.length),
      averageCaloriesRelativeError: averageNullable(group.map(result => result.caloriesRelativeError)),
      maxCaloriesRelativeError: maxNullable(group.map(result => result.caloriesRelativeError)),
      averageMaxRelativeError: averageNullable(group.map(result => result.maxRelativeError)),
    }))
    .sort((left, right) => {
      if (right.relevantDivergenceCount !== left.relevantDivergenceCount) {
        return right.relevantDivergenceCount - left.relevantDivergenceCount;
      }
      return right.averageCaloriesAbsoluteError - left.averageCaloriesAbsoluteError;
    });
}

export function adjustFutureEstimateConfidence(params: {
  currentConfidence: number;
  evaluations: NutritionEstimateEvaluationResult[];
}) {
  const adjustment = params.evaluations.reduce((sum, evaluation) => sum + evaluation.confidenceAdjustment, 0);
  return Math.max(0, Math.min(1, round(params.currentConfidence + adjustment)));
}