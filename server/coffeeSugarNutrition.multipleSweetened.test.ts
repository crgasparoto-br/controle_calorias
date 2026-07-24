import { describe, expect, it } from "vitest";
import {
  appendSugarQuantityToCoffeeText,
  hasUsableSweetenedCoffeeInference,
  normalizeSweetenedCoffeeDraftItems,
} from "./coffeeSugarNutrition";
import type { LlmItem } from "./nutritionEngineTypes";

function inferredSweetenedCoffee(calories: number, carbs: number): LlmItem {
  return {
    foodName: "Café com açúcar",
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    estimatedCalories: calories,
    estimatedMacros: {
      protein: 0,
      carbs,
      fat: 0,
    },
    confidence: 0.9,
    foodClassification: {
      processingLevel: "natural_or_minimally_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
    },
  };
}

describe("múltiplos cafés adoçados", () => {
  it("exige cardinalidade exata entre inferências e segmentos adoçados", () => {
    const sourceText =
      "1 xícara de café com açúcar e 2 xícaras de café adoçado";

    expect(hasUsableSweetenedCoffeeInference(
      [inferredSweetenedCoffee(34, 8)],
      sourceText,
    )).toBe(false);

    expect(hasUsableSweetenedCoffeeInference(
      [inferredSweetenedCoffee(34, 8), inferredSweetenedCoffee(52, 12)],
      sourceText,
    )).toBe(true);

    expect(hasUsableSweetenedCoffeeInference(
      [
        inferredSweetenedCoffee(34, 8),
        inferredSweetenedCoffee(52, 12),
        inferredSweetenedCoffee(62, 15),
      ],
      sourceText,
    )).toBe(false);
  });

  it("anexa as respostas em segmentos diferentes sem perder o progresso", () => {
    const original =
      "1 xícara de café com açúcar e 2 xícaras de café adoçado";
    const first = appendSugarQuantityToCoffeeText(original, 5, "g");
    const second = appendSugarQuantityToCoffeeText(first, 8, "g");

    expect(first).toContain("café com açúcar (5 g de açúcar)");
    expect(first).not.toContain("café adoçado (8 g de açúcar)");
    expect(second).toContain("café com açúcar (5 g de açúcar)");
    expect(second).toContain("café adoçado (8 g de açúcar)");
  });

  it("produz um item heurístico para cada segmento com açúcar explícito", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [],
      "1 xícara de café com 5 g de açúcar e 1 xícara de café adoçado com 8 g de açúcar",
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 34,
      carbs: 8,
    }));
  });
});
