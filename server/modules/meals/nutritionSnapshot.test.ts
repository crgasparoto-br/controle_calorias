import { describe, expect, it, vi } from "vitest";

import { getGlobalFoodCatalogItem, recordGlobalFoodUsage } from "../foods/service";
import { enrichMealItemsWithNutritionSnapshots } from "./nutritionSnapshot";
import { NUTRITION_SOURCE_SELECTION_VERSION } from "./nutritionSourceSelection";

vi.mock("../foods/service", () => ({
  getGlobalFoodCatalogItem: vi.fn(),
  recordGlobalFoodUsage: vi.fn(),
}));

const baseItem = {
  foodId: 10,
  foodName: "Arroz",
  canonicalName: "Arroz",
  portionText: "80 g",
  servings: 1,
  estimatedGrams: 80,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
  confidence: 0.9,
  source: "catalog" as const,
};

function catalogFood(overrides: Partial<Awaited<ReturnType<typeof getGlobalFoodCatalogItem>>> = {}) {
  return {
    id: 10,
    scope: "global" as const,
    ownerUserId: null,
    source: {
      id: 1,
      slug: "curadoria-br-inicial",
      name: "Curadoria interna",
      version: "2026-06-06",
      foodCode: "BR-COMMON-001",
    },
    name: "Arroz branco cozido",
    normalizedName: "arroz branco cozido",
    brandName: null,
    category: "Cereais",
    description: null,
    status: "active" as const,
    mergedIntoFoodId: null,
    nutrientsPer100g: {
      caloriesKcal: 128,
      proteinGrams: 2.5,
      carbsGrams: 28.1,
      fatGrams: 0.2,
      fiberGrams: 1.6,
      sugarGrams: null,
      sodiumMg: 1,
      extra: null,
    },
    portions: [],
    ...overrides,
  };
}

describe("meal item nutrition snapshots", () => {
  it("calcula macros no backend a partir do alimento do catalogo e da gramagem", async () => {
    vi.mocked(getGlobalFoodCatalogItem).mockResolvedValueOnce(catalogFood());

    const [item] = await enrichMealItemsWithNutritionSnapshots(7, [baseItem]);

    expect(item).toMatchObject({
      foodId: 10,
      canonicalName: "Arroz branco cozido",
      grams: 80,
      calories: 102.4,
      protein: 2,
      carbs: 22.48,
      fat: 0.16,
      fiberG: 1.28,
      sodiumMg: 0.8,
      nutritionSource: expect.objectContaining({
        type: "curated_catalog",
        origin: "curadoria-br-inicial",
        sourceName: "Curadoria interna",
        sourceVersion: "2026-06-06",
        foodCode: "BR-COMMON-001",
        confidence: 0.9,
        isEstimated: false,
        selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
      }),
    });
    expect(recordGlobalFoodUsage).toHaveBeenCalledWith(7, 10);
  });

  it("mantem a fonte nutricional selecionada dentro do snapshot persistivel", async () => {
    vi.mocked(getGlobalFoodCatalogItem).mockResolvedValueOnce(catalogFood());

    const [item] = await enrichMealItemsWithNutritionSnapshots(7, [baseItem]);
    const snapshot = JSON.parse(item.foodSnapshotJson ?? "{}");

    expect(snapshot.nutritionSource).toMatchObject({
      type: "curated_catalog",
      origin: "curadoria-br-inicial",
      sourceName: "Curadoria interna",
      sourceVersion: "2026-06-06",
      foodCode: "BR-COMMON-001",
      isEstimated: false,
      selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    });
  });

  it("marca item sem foodId como estimativa documentada para auditoria", async () => {
    const [item] = await enrichMealItemsWithNutritionSnapshots(7, [{
      ...baseItem,
      foodId: undefined,
      source: "heuristic" as const,
      confidence: 0.42,
    }]);

    expect(item.foodSnapshotJson).toBeUndefined();
    expect(item.nutritionSource).toEqual(expect.objectContaining({
      type: "documented_estimate",
      origin: "documented_estimate_rule",
      confidence: 0.42,
      isEstimated: true,
      matchedBy: "heuristic_fallback",
      selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    }));
  });

  it("mantem o snapshot antigo mesmo que o catalogo retorne valores novos depois", async () => {
    vi.mocked(getGlobalFoodCatalogItem)
      .mockResolvedValueOnce(catalogFood())
      .mockResolvedValueOnce(catalogFood({ nutrientsPer100g: { ...catalogFood().nutrientsPer100g, caloriesKcal: 150 } }));

    const [first] = await enrichMealItemsWithNutritionSnapshots(7, [baseItem]);
    const [second] = await enrichMealItemsWithNutritionSnapshots(7, [baseItem]);

    const firstSnapshot = JSON.parse(first.foodSnapshotJson ?? "{}");
    const secondSnapshot = JSON.parse(second.foodSnapshotJson ?? "{}");

    expect(firstSnapshot.calculated.caloriesKcal).toBe(102.4);
    expect(secondSnapshot.calculated.caloriesKcal).toBe(120);
    expect(first.foodSnapshotJson).not.toEqual(second.foodSnapshotJson);
  });
});
