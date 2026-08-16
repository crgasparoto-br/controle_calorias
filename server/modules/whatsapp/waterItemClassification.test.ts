import { describe, expect, it } from "vitest";

import { isPureWaterItem, splitMealItemsForWaterHydration } from "./waterItemClassification";
import type { MealDraftItem } from "../../nutritionEngineTypes";

function waterItem(overrides: Partial<MealDraftItem> = {}): MealDraftItem {
  return {
    foodName: "Água Mineral",
    canonicalName: "Água Mineral",
    quantity: 500,
    unit: "ml",
    portionText: "500 ml",
    servings: 1,
    estimatedGrams: 500,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.9,
    source: "catalog",
    ...overrides,
  };
}

describe("waterItemClassification", () => {
  it("reconhece marca e volume embutidos no nome sem exigir brand estruturada", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral com Gás Crystal 500ml",
      canonicalName: "Água Mineral com Gás Crystal 500 ml",
    })).toBe(true);

    expect(isPureWaterItem({
      foodName: "Água Mineral Serra Clara 500 ml",
      canonicalName: "Água Mineral Serra Clara",
    })).toBe(true);
  });

  it("mantém bebidas não puras fora da hidratação mesmo quando outro nome parece água mineral", () => {
    expect(isPureWaterItem({
      foodName: "Água Mineral Marca X",
      canonicalName: "Água Tônica Marca X",
    })).toBe(false);
    expect(isPureWaterItem({ foodName: "Água de Coco", canonicalName: "Água de Coco" })).toBe(false);
    expect(isPureWaterItem({ foodName: "Água Sabor Limão", canonicalName: "Água Saborizada" })).toBe(false);
  });

  it("não aceita qualificadores arbitrários sem um marcador de água potável", () => {
    expect(isPureWaterItem({ foodName: "água produto desconhecido", canonicalName: "água produto desconhecido" })).toBe(false);
  });

  it("prioriza água pura sobre macros nutricionais já preenchidos", () => {
    const split = splitMealItemsForWaterHydration([
      waterItem({
        foodName: "Água Mineral com Gás Serra Clara 500 ml",
        canonicalName: "Água Mineral com Gás Serra Clara",
        calories: 750,
        protein: 30,
        carbs: 75,
        fat: 25,
      }),
    ]);

    expect(split.waterVolumeMl).toBe(500);
    expect(split.remainingItems).toEqual([]);
    expect(split.hasWaterWithoutVolume).toBe(false);
  });
});
