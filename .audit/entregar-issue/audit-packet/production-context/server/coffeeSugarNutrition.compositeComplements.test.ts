import { describe, expect, it } from "vitest";
import {
  buildCoffeeWithExplicitSugarItem,
  hasUsableSweetenedCoffeeInference,
  normalizeSweetenedCoffeeDraftItems,
} from "./coffeeSugarNutrition";
import type { LlmItem, MealDraftItem } from "./nutritionEngineTypes";

function inferredCoffee(
  foodName: string,
  input: { calories?: number; carbs?: number; protein?: number; fat?: number } = {},
): LlmItem {
  return {
    foodName,
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    estimatedCalories: input.calories ?? 82,
    estimatedMacros: {
      protein: input.protein ?? 3,
      carbs: input.carbs ?? 13,
      fat: input.fat ?? 2,
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

function draftCoffee(
  foodName: string,
  canonicalName = foodName,
  input: { calories?: number; carbs?: number; protein?: number; fat?: number } = {},
): MealDraftItem {
  return {
    foodName,
    canonicalName,
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    calories: input.calories ?? 82,
    protein: input.protein ?? 3,
    carbs: input.carbs ?? 13,
    fat: input.fat ?? 2,
    confidence: 0.9,
    source: "hybrid",
  };
}

const COMPOSITE_PREPARATIONS = [
  "Café adoçado com leite",
  "Café adoçado com mel",
  "Café adoçado com creme",
  "Café adoçado com leite condensado",
];

describe("café adoçado com complementos adicionais", () => {
  it.each(COMPOSITE_PREPARATIONS)(
    "não reduz %s para a heurística de café-base com açúcar",
    preparation => {
      expect(buildCoffeeWithExplicitSugarItem(
        `1 xícara de ${preparation.toLocaleLowerCase("pt-BR")} com 5 g de açúcar`,
      )).toBeNull();
    },
  );

  it.each(COMPOSITE_PREPARATIONS)(
    "preserva nome e composição completos de %s",
    preparation => {
      const result = normalizeSweetenedCoffeeDraftItems(
        [draftCoffee(preparation)],
        `1 xícara de ${preparation.toLocaleLowerCase("pt-BR")}`,
      );

      expect(result[0]).toEqual(expect.objectContaining({
        foodName: preparation,
        canonicalName: preparation,
        calories: 82,
        protein: 3,
        carbs: 13,
        fat: 2,
      }));
    },
  );

  it("rejeita inferência genérica que omite leite e aceita a preparação completa", () => {
    const sourceText = "1 xícara de café adoçado com leite";

    expect(hasUsableSweetenedCoffeeInference(
      [inferredCoffee("Café", { calories: 82, carbs: 13 })],
      sourceText,
    )).toBe(false);
    expect(hasUsableSweetenedCoffeeInference(
      [inferredCoffee("Café adoçado com leite")],
      sourceText,
    )).toBe(true);
  });

  it("substitui uma composição incompatível por fallback do segmento completo", () => {
    const sourceText = "1 xícara de café adoçado com leite com 5 g de açúcar";
    const result = normalizeSweetenedCoffeeDraftItems(
      [draftCoffee("Café adoçado com leite com 5 g de açúcar", "Café com açúcar", {
        calories: 22,
        carbs: 5,
        protein: 0,
        fat: 0,
      })],
      sourceText,
    );

    expect(`${result[0].foodName} ${result[0].canonicalName}`).toMatch(/leite/i);
    expect(result[0]).not.toEqual(expect.objectContaining({
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });

  it("rejeita estimativa completa que não cobre a quantidade explícita de açúcar", () => {
    const sourceText = "1 xícara de café adoçado com leite com 5 g de açúcar";

    expect(hasUsableSweetenedCoffeeInference(
      [inferredCoffee("Café adoçado com leite", { calories: 18, carbs: 3 })],
      sourceText,
    )).toBe(false);
    expect(hasUsableSweetenedCoffeeInference(
      [inferredCoffee("Café adoçado com leite", { calories: 82, carbs: 13 })],
      sourceText,
    )).toBe(true);
  });
});
