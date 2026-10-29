import { describe, expect, it } from "vitest";
import { foodCatalogDirectKey } from "./foodCatalogKeys";
import { preserveResolvedCatalogIds } from "./householdMeasureMealUpdate";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(foodCatalogId: number | null, name: string): MealDraftItem {
  return {
    foodCatalogId, foodName: name, canonicalName: name, portionText: "1 un",
    quantity: 1, unit: "un", servings: 1, estimatedGrams: 10,
    calories: 20, protein: 1, carbs: 3, fat: 1,
    confidence: 0.9, source: "catalog",
  };
}

describe("#1307 — update must not remap historical catalog identities by name", () => {
  it("keeps only explicit persisted IDs even when two items share the same name", () => {
    const ids = preserveResolvedCatalogIds([
      item(10, "Leite"), item(null, "Leite"), item(20, "Leite integral"),
    ]);
    expect(ids.get(foodCatalogDirectKey(10))).toBe(10);
    expect(ids.get(foodCatalogDirectKey(20))).toBe(20);
    expect(ids.has("Leite")).toBe(false);
    expect(ids.has("Leite integral")).toBe(false);
    expect(ids.size).toBe(2);
  });

  it("never fabricates a catalog ID for an item without persisted identity", () => {
    expect(preserveResolvedCatalogIds([item(null, "Pão"), item(null, "Pão")]).size).toBe(0);
  });
});
