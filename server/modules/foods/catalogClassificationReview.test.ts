import { describe, expect, it } from "vitest";
import type { FoodCatalogRow } from "../../repositories/foodCatalogRepository";
import {
  buildCatalogClassificationReviewQueue,
  toFoodCatalogClassificationReviewFood,
} from "./catalogClassificationReview";

function buildCatalogRow(overrides: Partial<FoodCatalogRow> = {}): FoodCatalogRow {
  return {
    id: 101,
    slug: "user-1-test-food",
    name: "Alimento estimado de teste",
    aliases: "[]",
    brandId: null,
    brandName: null,
    foodType: "generic",
    barcode: null,
    dataSource: "ai_estimated",
    servingLabel: "100 g",
    servingUnit: "g",
    gramsPerServing: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    fiber: 2,
    isFruit: 0,
    isVegetable: 0,
    isUltraProcessed: 0,
    processingLevel: "processed",
    classificationSource: "ai_estimated",
    classificationConfidence: 0.8,
    isUserCreated: 1,
    createdByUserId: 1,
    status: "active",
    createdAt: new Date("2026-07-28T12:00:00.000Z"),
    updatedAt: new Date("2026-07-28T12:00:00.000Z"),
    ...overrides,
  };
}

describe("food catalog classification review integration", () => {
  it("keeps AI-estimated catalog entries distinguishable for curation", () => {
    const queue = buildCatalogClassificationReviewQueue([buildCatalogRow()]);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toEqual(expect.objectContaining({
      foodId: 101,
      state: "estimated",
      reviewStatus: "pending",
      reasons: expect.arrayContaining(["estimated_classification"]),
      origin: "ai_estimated",
    }));
  });

  it("routes low-confidence AI classifications to review", () => {
    const queue = buildCatalogClassificationReviewQueue([
      buildCatalogRow({ classificationConfidence: 0.4 }),
    ]);

    expect(queue[0]).toEqual(expect.objectContaining({
      state: "low_confidence",
      reasons: expect.arrayContaining([
        "estimated_classification",
        "low_confidence_classification",
      ]),
      currentConfidence: 0.4,
    }));
  });

  it("routes missing classification metadata as unclassified", () => {
    const queue = buildCatalogClassificationReviewQueue([
      buildCatalogRow({
        dataSource: "manual",
        classificationSource: null,
        classificationConfidence: null,
        processingLevel: null,
      }),
    ]);

    expect(queue[0]).toEqual(expect.objectContaining({
      state: "unclassified",
      reasons: expect.arrayContaining([
        "missing_food_group",
        "missing_food_quality",
        "missing_processing_level",
        "missing_classification_origin",
      ]),
    }));
  });

  it("normalizes calories to a 100 gram review basis", () => {
    const reviewFood = toFoodCatalogClassificationReviewFood(buildCatalogRow({
      gramsPerServing: 50,
      calories: 120,
    }));

    expect(reviewFood.caloriesKcalPer100g).toBe(240);
  });
});
