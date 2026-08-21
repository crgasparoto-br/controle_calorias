import { describe, expect, it, vi } from "vitest";
import { buildEstimatedNutritionFallbackItem } from "../../mealItemBuilders";
import type { FoodCatalogRepository } from "../../repositories/foodCatalogRepository";
import { createFoodsService } from "./catalog";

function createRepository(insert: FoodCatalogRepository["insert"]): FoodCatalogRepository {
  return {
    findAll: vi.fn(async () => []),
    findForResolution: vi.fn(async () => []),
    findFavoriteIdsByUserId: vi.fn(async () => new Set<number>()),
    upsertFavorite: vi.fn(async () => undefined),
    deleteFavorite: vi.fn(async () => undefined),
    insert,
    update: vi.fn(async () => 0),
  };
}

describe("embedded NOVA classification persistence pipeline", () => {
  it("persists classification after nutrition falls back to a heuristic reference", async () => {
    const insert = vi.fn(async () => 501);
    const service = createFoodsService({
      foodCatalogRepository: createRepository(insert),
      findMealItemsWithDates: async () => [],
      getUserMealsMemory: () => [],
      getDb: async () => ({}),
      onWarning: vi.fn(),
    });
    const draftItem = buildEstimatedNutritionFallbackItem({
      foodName: "preparação exclusiva do pipeline",
      brand: null,
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
      confidence: 0.81,
      foodClassification: {
        processingLevel: "processed",
        isFruit: false,
        isVegetable: true,
        fiberGrams: 3.5,
      },
    });

    const resolved = await service.resolveFoodCatalogIds([draftItem], 77);

    expect(resolved.get(draftItem.canonicalName)).toBe(501);
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      dataSource: "ai_estimated",
      classificationSource: "ai_estimated",
      processingLevel: "processed",
      classificationConfidence: draftItem.confidence,
      fiber: 3.5,
      isFruit: 0,
      isVegetable: 1,
      isUltraProcessed: 0,
      createdByUserId: 77,
    }));
  });

  it("does not create an auto-classified catalog entry without classification", async () => {
    const insert = vi.fn(async () => 501);
    const service = createFoodsService({
      foodCatalogRepository: createRepository(insert),
      findMealItemsWithDates: async () => [],
      getUserMealsMemory: () => [],
      getDb: async () => ({}),
      onWarning: vi.fn(),
    });
    const draftItem = buildEstimatedNutritionFallbackItem({
      foodName: "preparação sem classificação",
      brand: null,
      quantity: 100,
      unit: "g",
      portionText: "100 g",
      servings: 1,
      estimatedGrams: 100,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
      confidence: 0.81,
      foodClassification: null,
    });

    const resolved = await service.resolveFoodCatalogIds([draftItem], 77);

    expect(resolved).toEqual(new Map());
    expect(insert).not.toHaveBeenCalled();
  });
});
