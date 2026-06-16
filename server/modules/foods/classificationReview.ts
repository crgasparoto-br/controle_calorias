export const FOOD_CLASSIFICATION_REVIEW_VERSION = "food-classification-review-v1";

export type ClassificationState =
  | "classified"
  | "estimated"
  | "pending"
  | "low_confidence"
  | "unclassified";

export type ClassificationReviewStatus =
  | "pending"
  | "reviewed"
  | "rejected"
  | "substituted"
  | "reprocessable";

export type ClassificationReviewReason =
  | "new_global_food"
  | "missing_food_group"
  | "missing_food_quality"
  | "missing_processing_level"
  | "missing_classification_flags"
  | "estimated_classification"
  | "low_confidence_classification"
  | "missing_classification_origin"
  | "obsolete_source"
  | "inactive_or_merged_source"
  | "high_usage_food"
  | "high_calorie_food"
  | "new_rule_available";

export type FoodClassificationFlags = {
  isFruit?: boolean | null;
  isVegetable?: boolean | null;
  isUltraProcessed?: boolean | null;
  isBrandedProduct?: boolean | null;
  [key: string]: boolean | string | number | null | undefined;
};

export type FoodClassificationMetadata = {
  foodGroup?: string | null;
  foodQuality?: string | null;
  processingLevel?: string | null;
  flags?: FoodClassificationFlags | null;
  confidence?: number | null;
  origin?: string | null;
  sourceVersion?: string | null;
  status?: ClassificationReviewStatus | null;
  reviewedAt?: string | null;
  ruleVersion?: string | null;
  isEstimated?: boolean | null;
};

export type FoodClassificationReviewSource = {
  slug?: string | null;
  name?: string | null;
  version?: string | null;
  foodCode?: string | null;
  status?: "active" | "deprecated" | "merged" | null;
};

export type FoodClassificationReviewFood = {
  id: number;
  name: string;
  ownerUserId?: number | null;
  brandName?: string | null;
  category?: string | null;
  status?: "active" | "deprecated" | "merged" | null;
  mergedIntoFoodId?: number | null;
  source?: FoodClassificationReviewSource | null;
  caloriesKcalPer100g?: number | null;
  userSignals?: {
    usageCount?: number | null;
    lastUsedAt?: string | null;
  } | null;
  nutrientsPer100g?: {
    extra?: Record<string, unknown> | null;
  } | null;
  classification?: FoodClassificationMetadata | null;
};

export type FoodClassificationReviewPolicy = {
  minimumConfidence?: number;
  highUsageThreshold?: number;
  highCalorieThreshold?: number;
  approvedSourceVersions?: Record<string, string>;
  activeRuleVersion?: string;
};

export type FoodClassificationReviewPendingItem = {
  foodId: number;
  foodName: string;
  brandName: string | null;
  state: ClassificationState;
  reviewStatus: ClassificationReviewStatus;
  reasons: ClassificationReviewReason[];
  problematicFields: string[];
  currentConfidence: number | null;
  origin: string | null;
  source: FoodClassificationReviewSource | null;
  priority: "low" | "medium" | "high" | "critical";
  priorityScore: number;
  usageCount: number;
  caloriesKcalPer100g: number | null;
  reprocess: boolean;
  reportBucket: ClassificationState;
  detail: string;
  reviewVersion: typeof FOOD_CLASSIFICATION_REVIEW_VERSION;
};

export type FoodClassificationReviewDecision = {
  foodId: number;
  status: ClassificationReviewStatus;
  reviewedAt: string;
  reviewerId?: number;
  replacementFoodId?: number;
  reason?: string;
  ruleVersion?: string;
};

const DEFAULT_POLICY: Required<Omit<FoodClassificationReviewPolicy, "approvedSourceVersions" | "activeRuleVersion">> = {
  minimumConfidence: 0.72,
  highUsageThreshold: 10,
  highCalorieThreshold: 450,
};

function compactUnique<T extends string>(values: Array<T | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as T[]));
}

function normalizeString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeConfidence(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(Math.max(numeric, 0), 1) : null;
}

function readNestedObject(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" ? nested as Record<string, unknown> : null;
}

export function extractFoodClassificationMetadata(food: FoodClassificationReviewFood): FoodClassificationMetadata {
  const extra = food.nutrientsPer100g?.extra ?? null;
  const extraClassification = readNestedObject(extra, "classification");
  const legacyReview = readNestedObject(extra, "classificationReview");
  const direct = food.classification ?? {};

  const flags = direct.flags
    ?? (readNestedObject(extraClassification, "flags") as FoodClassificationFlags | null)
    ?? (readNestedObject(legacyReview, "flags") as FoodClassificationFlags | null)
    ?? null;

  return {
    foodGroup: normalizeString(direct.foodGroup)
      ?? normalizeString(extraClassification?.foodGroup)
      ?? normalizeString(legacyReview?.foodGroup)
      ?? normalizeString(food.category),
    foodQuality: normalizeString(direct.foodQuality)
      ?? normalizeString(extraClassification?.foodQuality)
      ?? normalizeString(legacyReview?.foodQuality),
    processingLevel: normalizeString(direct.processingLevel)
      ?? normalizeString(extraClassification?.processingLevel)
      ?? normalizeString(legacyReview?.processingLevel),
    flags,
    confidence: normalizeConfidence(direct.confidence)
      ?? normalizeConfidence(extraClassification?.confidence)
      ?? normalizeConfidence(legacyReview?.confidence),
    origin: normalizeString(direct.origin)
      ?? normalizeString(extraClassification?.origin)
      ?? normalizeString(legacyReview?.origin),
    sourceVersion: normalizeString(direct.sourceVersion)
      ?? normalizeString(extraClassification?.sourceVersion)
      ?? normalizeString(legacyReview?.sourceVersion)
      ?? normalizeString(food.source?.version),
    status: direct.status
      ?? (extraClassification?.status as ClassificationReviewStatus | undefined)
      ?? (legacyReview?.status as ClassificationReviewStatus | undefined)
      ?? null,
    reviewedAt: normalizeString(direct.reviewedAt)
      ?? normalizeString(extraClassification?.reviewedAt)
      ?? normalizeString(legacyReview?.reviewedAt),
    ruleVersion: normalizeString(direct.ruleVersion)
      ?? normalizeString(extraClassification?.ruleVersion)
      ?? normalizeString(legacyReview?.ruleVersion),
    isEstimated: Boolean(direct.isEstimated ?? extraClassification?.isEstimated ?? legacyReview?.isEstimated ?? false),
  };
}

function hasClassificationFlags(flags: FoodClassificationFlags | null | undefined) {
  if (!flags) return false;
  return [flags.isFruit, flags.isVegetable, flags.isUltraProcessed].some(value => typeof value === "boolean");
}

function compareVersion(value: string | null | undefined, expected: string | null | undefined) {
  if (!value || !expected) return 0;
  return value.localeCompare(expected, undefined, { numeric: true, sensitivity: "base" });
}

function classifyState(metadata: FoodClassificationMetadata, reasons: ClassificationReviewReason[]): ClassificationState {
  if (reasons.includes("missing_food_group")
    && reasons.includes("missing_food_quality")
    && reasons.includes("missing_processing_level")) {
    return "unclassified";
  }

  if (reasons.includes("low_confidence_classification")) {
    return "low_confidence";
  }

  if (metadata.isEstimated || reasons.includes("estimated_classification")) {
    return "estimated";
  }

  if (reasons.length > 0) {
    return "pending";
  }

  return "classified";
}

function calculatePriority(params: {
  reasons: ClassificationReviewReason[];
  usageCount: number;
  caloriesKcalPer100g: number | null;
  policy: Required<Omit<FoodClassificationReviewPolicy, "approvedSourceVersions" | "activeRuleVersion">>;
}) {
  let score = 0;
  for (const reason of params.reasons) {
    if (reason === "new_global_food" || reason === "missing_classification_origin") score += 1;
    if (reason.startsWith("missing_")) score += 2;
    if (reason === "estimated_classification" || reason === "low_confidence_classification") score += 3;
    if (reason === "obsolete_source" || reason === "new_rule_available") score += 2;
    if (reason === "inactive_or_merged_source") score += 4;
  }

  if (params.usageCount >= params.policy.highUsageThreshold) score += 3;
  if ((params.caloriesKcalPer100g ?? 0) >= params.policy.highCalorieThreshold) score += 2;

  if (score >= 9) return { priority: "critical" as const, score };
  if (score >= 6) return { priority: "high" as const, score };
  if (score >= 3) return { priority: "medium" as const, score };
  return { priority: "low" as const, score };
}

function detailForState(state: ClassificationState) {
  if (state === "classified") return "Alimento classificado com metadados suficientes.";
  if (state === "estimated") return "Classificacao estimada deve permanecer distinguivel em relatorios e revisoes.";
  if (state === "low_confidence") return "Classificacao com baixa confianca deve entrar em revisao.";
  if (state === "unclassified") return "Alimento sem classificacao minima deve entrar na fila de curadoria.";
  return "Classificacao pendente ou incompleta deve ser revisada antes de ser tratada como definitiva.";
}

export function evaluateFoodClassificationForReview(
  food: FoodClassificationReviewFood,
  policyInput: FoodClassificationReviewPolicy = {},
): FoodClassificationReviewPendingItem | null {
  const policy = { ...DEFAULT_POLICY, ...policyInput };
  const approvedSourceVersions = policyInput.approvedSourceVersions ?? {};
  const metadata = extractFoodClassificationMetadata(food);
  const confidence = metadata.confidence;
  const usageCount = Number(food.userSignals?.usageCount ?? 0);
  const caloriesKcalPer100g = Number.isFinite(food.caloriesKcalPer100g ?? NaN)
    ? Number(food.caloriesKcalPer100g)
    : null;
  const sourceSlug = food.source?.slug ?? metadata.origin ?? null;
  const expectedSourceVersion = sourceSlug ? approvedSourceVersions[sourceSlug] : undefined;

  const reasons = compactUnique<ClassificationReviewReason>([
    food.ownerUserId == null && !metadata.reviewedAt ? "new_global_food" : null,
    metadata.foodGroup ? null : "missing_food_group",
    metadata.foodQuality ? null : "missing_food_quality",
    metadata.processingLevel ? null : "missing_processing_level",
    hasClassificationFlags(metadata.flags) ? null : "missing_classification_flags",
    metadata.isEstimated ? "estimated_classification" : null,
    confidence !== null && confidence < policy.minimumConfidence ? "low_confidence_classification" : null,
    metadata.origin ? null : "missing_classification_origin",
    expectedSourceVersion && compareVersion(metadata.sourceVersion ?? food.source?.version, expectedSourceVersion) < 0 ? "obsolete_source" : null,
    food.status === "deprecated" || food.status === "merged" || food.source?.status === "deprecated" || food.source?.status === "merged"
      ? "inactive_or_merged_source"
      : null,
    policyInput.activeRuleVersion && metadata.ruleVersion && metadata.ruleVersion !== policyInput.activeRuleVersion
      ? "new_rule_available"
      : null,
    usageCount >= policy.highUsageThreshold ? "high_usage_food" : null,
    (caloriesKcalPer100g ?? 0) >= policy.highCalorieThreshold ? "high_calorie_food" : null,
  ]);

  const state = classifyState(metadata, reasons);
  if (state === "classified" && metadata.status === "reviewed") {
    return null;
  }

  if (state === "classified" && reasons.length === 0) {
    return null;
  }

  const problematicFields = compactUnique([
    reasons.includes("missing_food_group") ? "foodGroup" : null,
    reasons.includes("missing_food_quality") ? "foodQuality" : null,
    reasons.includes("missing_processing_level") ? "processingLevel" : null,
    reasons.includes("missing_classification_flags") ? "flags" : null,
    reasons.includes("low_confidence_classification") ? "confidence" : null,
    reasons.includes("missing_classification_origin") ? "origin" : null,
    reasons.includes("obsolete_source") ? "sourceVersion" : null,
    reasons.includes("new_rule_available") ? "ruleVersion" : null,
  ]);

  const priority = calculatePriority({ reasons, usageCount, caloriesKcalPer100g, policy });

  return {
    foodId: food.id,
    foodName: food.name,
    brandName: food.brandName ?? null,
    state,
    reviewStatus: metadata.status ?? "pending",
    reasons,
    problematicFields,
    currentConfidence: confidence,
    origin: metadata.origin ?? sourceSlug,
    source: food.source ?? null,
    priority: priority.priority,
    priorityScore: priority.score,
    usageCount,
    caloriesKcalPer100g,
    reprocess: reasons.includes("new_rule_available") || reasons.includes("obsolete_source"),
    reportBucket: state,
    detail: detailForState(state),
    reviewVersion: FOOD_CLASSIFICATION_REVIEW_VERSION,
  };
}

export function buildFoodClassificationReviewQueue(
  foods: FoodClassificationReviewFood[],
  policy: FoodClassificationReviewPolicy = {},
) {
  return foods
    .map(food => evaluateFoodClassificationForReview(food, policy))
    .filter((item): item is FoodClassificationReviewPendingItem => Boolean(item))
    .sort((left, right) => {
      if (right.priorityScore !== left.priorityScore) return right.priorityScore - left.priorityScore;
      if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
      return left.foodName.localeCompare(right.foodName, "pt-BR");
    });
}

export function summarizeFoodClassificationForReports(foods: FoodClassificationReviewFood[]) {
  const summary: Record<ClassificationState, number> = {
    classified: 0,
    estimated: 0,
    pending: 0,
    low_confidence: 0,
    unclassified: 0,
  };

  for (const food of foods) {
    const pending = evaluateFoodClassificationForReview(food);
    if (pending) {
      summary[pending.reportBucket] += 1;
    } else {
      summary.classified += 1;
    }
  }

  return {
    ...summary,
    total: foods.length,
  };
}

export function buildFoodClassificationReviewDecision(input: {
  foodId: number;
  status: ClassificationReviewStatus;
  reviewerId?: number;
  replacementFoodId?: number;
  reason?: string;
  ruleVersion?: string;
  reviewedAt?: string;
}): FoodClassificationReviewDecision {
  if (input.status === "substituted" && !input.replacementFoodId) {
    throw new Error("Informe o alimento substituto ao marcar a classificacao como substituida.");
  }

  return {
    foodId: input.foodId,
    status: input.status,
    reviewedAt: input.reviewedAt ?? new Date().toISOString(),
    reviewerId: input.reviewerId,
    replacementFoodId: input.replacementFoodId,
    reason: input.reason,
    ruleVersion: input.ruleVersion,
  };
}