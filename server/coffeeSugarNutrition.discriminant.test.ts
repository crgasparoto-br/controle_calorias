import { describe, expect, it } from "vitest";
import {
  normalizeSweetenedCoffeeDraftItems,
  shouldRequestSugarQuantity,
} from "./coffeeSugarNutrition";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(input: {
  foodName: string;
  canonicalName: string;
  calories: number;
  carbs: number;
}): MealDraftItem {
  return {
    foodName: input.foodName,
    canonicalName: input.canonicalName,
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    calories: input.calories,
    protein: 0,
    carbs: input.carbs,
    fat: 0,
    confidence: 0.9,
    source: "heuristic",
  };
}

describe("normalização discriminante de café adoçado", () => {
  it("não converte o café sem açúcar quando os dois cafés coexistem", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        item({
          foodName: "Café com açúcar",
          canonicalName: "Café com açúcar",
          calories: 34,
          carbs: 8,
        }),
        item({
          foodName: "Café sem açúcar",
          canonicalName: "Café Sem Açúcar",
          calories: 2,
          carbs: 0,
        }),
      ],
      "1 xícara de café com açúcar e 1 xícara de café sem açúcar",
    );

    expect(result[0]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 34,
      carbs: 8,
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      foodName: "Café sem açúcar",
      canonicalName: "Café Sem Açúcar",
      calories: 2,
      carbs: 0,
    }));
  });

  it("restaura o qualificador quando a IA retorna um único café genérico", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        item({
          foodName: "Café",
          canonicalName: "Café",
          calories: 34,
          carbs: 8,
        }),
      ],
      "1 xícara de café com açúcar",
    );

    expect(result[0]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 34,
      carbs: 8,
    }));
  });

  it("preserva o café sem açúcar e adiciona o adoçado quando a IA omite o alvo", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        item({
          foodName: "Café sem açúcar",
          canonicalName: "Café Sem Açúcar",
          calories: 2,
          carbs: 0,
        }),
      ],
      "1 xícara de café com 5 g de açúcar e 1 xícara de café sem açúcar",
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toEqual(expect.objectContaining({
      canonicalName: "Café Sem Açúcar",
      calories: 2,
      carbs: 0,
    }));
    expect(result[1]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
  });

  it("não renomeia café com leite como café adoçado em entrada composta", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        item({
          foodName: "Café com leite",
          canonicalName: "Café com leite",
          calories: 60,
          carbs: 5,
        }),
      ],
      "1 xícara de café com açúcar e 1 xícara de café com leite",
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      foodName: "Café com leite",
      canonicalName: "Café com leite",
      calories: 60,
      carbs: 5,
    }));
  });

  it("não aceita a estimativa de outro café como nutrição do café adoçado", () => {
    const shouldClarify = shouldRequestSugarQuantity(
      "1 xícara de café com açúcar e 1 xícara de café com leite",
      [{
        foodName: "Café com leite",
        brand: null,
        quantity: 1,
        unit: "xícara",
        portionText: "1 xícara",
        servings: 1,
        estimatedGrams: 200,
        estimatedCalories: 60,
        estimatedMacros: {
          protein: 2,
          carbs: 5,
          fat: 2,
        },
        confidence: 0.9,
        foodClassification: {
          processingLevel: "minimally_processed",
          isFruit: false,
          isVegetable: false,
          fiberGrams: 0,
        },
      }],
    );

    expect(shouldClarify).toBe(true);
  });
});
