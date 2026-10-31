import { describe, expect, it } from "vitest";
import { projectHistoricalHouseholdItemsForShadow } from "./householdMeasureMealUpdate";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(foodCatalogId: number | null, name: string): MealDraftItem {
  return {
    foodCatalogId, foodName: name, canonicalName: name, portionText: "1 un",
    quantity: 1, unit: "un", servings: 1, estimatedGrams: 10,
    calories: 20, protein: 1, carbs: 3, fat: 1,
    confidence: 0.9, source: "catalog",
  };
}

describe("#1307 — read-only household shadow projection", () => {
  it("uses saved IDs and does not map identical names into another item", () => {
    const values = projectHistoricalHouseholdItemsForShadow([
      item(10, "Leite"), item(null, "Leite"), item(20, "Leite"),
    ]);
    expect(values.map(i => i.historicalRef)).toEqual(["catalog:10", null, "catalog:20"]);
    expect(values.map(i => i.calories)).toEqual([20, 20, 20]);
    expect(values.map(i => i.foodCatalogId)).toEqual([10, null, 20]);
  });

  it("does not mutate the confirmed V1 item while creating historical views", () => {
    const original = item(10, "Arroz");
    const view = projectHistoricalHouseholdItemsForShadow([original]);
    expect(Object.isFrozen(view[0])).toBe(true);
    expect(view[0].calories).toBe(20);
    original.calories = 99;
    original.foodCatalogId = 77;
    expect(view[0].calories).toBe(20);
    expect(view[0].historicalRef).toBe("catalog:10");
  });
});
