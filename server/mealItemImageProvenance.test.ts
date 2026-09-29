import { describe, expect, it } from "vitest";
import type { MealDraftItem } from "./nutritionEngine";
import { associateMealItemsWithSourceMedia, clearMealItemSourceMedia, clearMealItemsSourceMedia } from "./mealItemImageProvenance";

function item(name: string): MealDraftItem {
  return { foodName: name, canonicalName: name, quantity: 1, unit: "unidade", portionText: "1 unidade", servings: 1, estimatedGrams: 100, calories: 100, protein: 1, carbs: 10, fat: 1, confidence: 1, source: "catalog" };
}

describe("meal item image provenance", () => {
  it("associates multiple photo-derived items with the same persisted media key", () => {
    const original = [item("Arroz"), item("Feijão")];
    const associated = associateMealItemsWithSourceMedia(original, "42/meal-images/original.jpg");
    expect(associated.map(current => current.sourceMediaStorageKey)).toEqual(["42/meal-images/original.jpg", "42/meal-images/original.jpg"]);
    expect(original.every(current => current.sourceMediaStorageKey === undefined)).toBe(true);
  });

  it("clears provenance for copied, favorited or moved items without mutating the source", () => {
    const original = { ...item("Arroz"), sourceMediaStorageKey: "42/meal-images/original.jpg" };
    expect(clearMealItemSourceMedia(original).sourceMediaStorageKey).toBeUndefined();
    expect(clearMealItemsSourceMedia([original])[0].sourceMediaStorageKey).toBeUndefined();
    expect(original.sourceMediaStorageKey).toBe("42/meal-images/original.jpg");
  });
});
