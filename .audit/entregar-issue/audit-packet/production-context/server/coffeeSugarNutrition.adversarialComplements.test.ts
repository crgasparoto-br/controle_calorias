import { describe, expect, it } from "vitest";
import {
  appendSugarQuantityToCoffeeText,
  buildCoffeeWithExplicitSugarItem,
  normalizeSweetenedCoffeeDraftItems,
} from "./coffeeSugarNutrition";
import type { MealDraftItem } from "./nutritionEngineTypes";

function draftCoffee(input: {
  foodName: string;
  canonicalName?: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}): MealDraftItem {
  return {
    foodName: input.foodName,
    canonicalName: input.canonicalName ?? input.foodName,
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 200,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    confidence: 0.9,
    source: "hybrid",
  };
}

describe("passagem adversarial de cafés adoçados compostos", () => {
  it("associa açúcar explícito ao segmento correto mesmo com inferências em ordem inversa", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        draftCoffee({
          foodName: "Café adoçado com leite com 8 g de açúcar",
          calories: 90,
          protein: 3,
          carbs: 15,
          fat: 2,
        }),
        draftCoffee({
          foodName: "Café com açúcar",
          calories: 30,
          protein: 0,
          carbs: 7,
          fat: 0,
        }),
      ],
      "1 xícara de café com 5 g de açúcar e 1 xícara de café adoçado com leite com 8 g de açúcar",
    );

    const withMilk = result.find(item => /leite/i.test(`${item.foodName} ${item.canonicalName}`));
    const sugarOnly = result.find(item => !/leite/i.test(`${item.foodName} ${item.canonicalName}`));

    expect(withMilk).toEqual(expect.objectContaining({
      calories: 90,
      protein: 3,
      carbs: 15,
      fat: 2,
    }));
    expect(sugarOnly).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });

  it("não reutiliza uma única inferência específica para dois complementos diferentes", () => {
    const result = normalizeSweetenedCoffeeDraftItems(
      [
        draftCoffee({
          foodName: "Café adoçado com leite",
          calories: 82,
          protein: 3,
          carbs: 13,
          fat: 2,
        }),
        draftCoffee({
          foodName: "Café com açúcar",
          calories: 30,
          protein: 0,
          carbs: 7,
          fat: 0,
        }),
      ],
      "1 xícara de café adoçado com leite e 1 xícara de café adoçado com creme",
    );

    const withMilk = result.find(item => /leite/i.test(`${item.foodName} ${item.canonicalName}`));
    const withCream = result.find(item => /creme/i.test(`${item.foodName} ${item.canonicalName}`));

    expect(withMilk).toEqual(expect.objectContaining({
      calories: 82,
      protein: 3,
      carbs: 13,
      fat: 2,
    }));
    expect(withCream).toBeDefined();
    expect(withCream).not.toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 30,
      protein: 0,
      carbs: 7,
      fat: 0,
    }));
  });

  it("preserva leite após a retomada da clarificação mesmo quando o canônico intermediário é genérico", () => {
    const resolvedText = appendSugarQuantityToCoffeeText(
      "1 xícara de café adoçado com leite",
      5,
      "g",
    );
    const result = normalizeSweetenedCoffeeDraftItems(
      [draftCoffee({
        foodName: "Café adoçado com leite 5 g de açúcar",
        canonicalName: "Café com açúcar",
        calories: 22,
        protein: 0,
        carbs: 5,
        fat: 0,
      })],
      resolvedText,
    );

    expect(`${result[0].foodName} ${result[0].canonicalName}`).toMatch(/leite/i);
    expect(result[0]).not.toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });

  it("mantém o controle negativo de café com apenas açúcar em 22 kcal", () => {
    const result = buildCoffeeWithExplicitSugarItem(
      "1 xícara de café com 5 g de açúcar",
    );

    expect(result).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });
});
