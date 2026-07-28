import { describe, expect, it } from "vitest";
import {
  buildEstimatedNutritionFallbackItem,
  buildItemFromCatalog,
} from "./mealItemBuilders";
import type { CatalogFood, LlmItem } from "./nutritionEngineTypes";

const catalogFood: CatalogFood = {
  slug: "catalog-rice",
  name: "Arroz branco cozido",
  aliases: ["arroz"],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
};

const novaClassification = {
  processingLevel: "natural_or_minimally_processed" as const,
  isFruit: false,
  isVegetable: false,
  fiberGrams: 0.4,
};

function buildLlmItem(overrides: Partial<LlmItem> = {}): LlmItem {
  return {
    foodName: "arroz",
    brand: null,
    quantity: 100,
    unit: "g",
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    estimatedCalories: 130,
    estimatedMacros: { protein: 2.7, carbs: 28, fat: 0.3 },
    confidence: 0.9,
    foodClassification: novaClassification,
    ...overrides,
  };
}

describe("meal item NOVA classification propagation", () => {
  it("preserves the embedded classification when catalog nutrition is selected", () => {
    const item = buildItemFromCatalog(catalogFood, buildLlmItem());

    expect(item.source).toBe("catalog");
    expect(item.classification).toEqual(novaClassification);
  });

  it("preserves the embedded classification when nutrition falls back to a heuristic reference", () => {
    const item = buildEstimatedNutritionFallbackItem(buildLlmItem({
      foodName: "preparação exclusiva de teste",
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    }));

    expect(item.source).toBe("heuristic");
    expect(item.classification).toEqual(novaClassification);
  });

  it("does not invent classification when the AI result omitted it", () => {
    const item = buildEstimatedNutritionFallbackItem(buildLlmItem({
      foodClassification: null,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    }));

    expect(item.classification).toBeNull();
  });
});
