import type { FoodCatalogRow } from "../../repositories/foodCatalogRepository";
import {
  buildFoodClassificationReviewQueue,
  type FoodClassificationReviewFood,
  type FoodClassificationReviewPolicy,
} from "./classificationReview";

export const FOOD_CATALOG_CLASSIFICATION_SOURCE_VERSION = "food-catalog-v1";
const DEFAULT_MINIMUM_CLASSIFICATION_CONFIDENCE = 0.72;

function caloriesPer100Grams(row: FoodCatalogRow) {
  if (!Number.isFinite(row.gramsPerServing) || row.gramsPerServing <= 0) {
    return Number.isFinite(row.calories) ? row.calories : null;
  }
  return (row.calories * 100) / row.gramsPerServing;
}

function isAiEstimated(row: FoodCatalogRow) {
  return row.classificationSource === "ai_estimated" || row.dataSource === "ai_estimated";
}

function readClassificationConfidence(row: FoodCatalogRow) {
  return typeof row.classificationConfidence === "number" && Number.isFinite(row.classificationConfidence)
    ? row.classificationConfidence
    : null;
}

export function catalogRowRequiresClassificationReview(
  row: FoodCatalogRow,
  policy: FoodClassificationReviewPolicy = {},
) {
  const minimumConfidence = policy.minimumConfidence ?? DEFAULT_MINIMUM_CLASSIFICATION_CONFIDENCE;
  const confidence = readClassificationConfidence(row);

  return row.status === "deprecated"
    || !row.processingLevel
    || !row.classificationSource
    || confidence === null
    || confidence < minimumConfidence
    || isAiEstimated(row);
}

export function toFoodCatalogClassificationReviewFood(
  row: FoodCatalogRow,
): FoodClassificationReviewFood {
  const sourceSlug = row.dataSource;
  const estimated = isAiEstimated(row);

  return {
    id: row.id,
    name: row.name,
    ownerUserId: row.createdByUserId,
    brandName: row.brandName,
    status: row.status === "deprecated" ? "deprecated" : "active",
    caloriesKcalPer100g: caloriesPer100Grams(row),
    source: {
      slug: sourceSlug,
      name: sourceSlug,
      version: FOOD_CATALOG_CLASSIFICATION_SOURCE_VERSION,
      status: row.status === "deprecated" ? "deprecated" : "active",
    },
    classification: {
      foodGroup: null,
      foodQuality: null,
      processingLevel: row.processingLevel,
      flags: {
        isFruit: row.isFruit === 1,
        isVegetable: row.isVegetable === 1,
        isUltraProcessed: row.isUltraProcessed === 1,
        isBrandedProduct: row.foodType === "branded",
      },
      confidence: readClassificationConfidence(row),
      origin: row.classificationSource,
      sourceVersion: FOOD_CATALOG_CLASSIFICATION_SOURCE_VERSION,
      status: estimated ? "pending" : null,
      reviewedAt: null,
      ruleVersion: null,
      isEstimated: estimated,
    },
  };
}

export function buildCatalogClassificationReviewQueue(
  rows: FoodCatalogRow[],
  policy: FoodClassificationReviewPolicy = {},
) {
  return buildFoodClassificationReviewQueue(
    rows
      .filter(row => catalogRowRequiresClassificationReview(row, policy))
      .map(toFoodCatalogClassificationReviewFood),
    policy,
  );
}
