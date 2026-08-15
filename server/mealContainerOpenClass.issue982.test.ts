import { describe, expect, it } from "vitest";
import { cleanMealItems } from "./mealItemCleanup";
import type { MealDraftItem } from "./nutritionEngineTypes";

function item(foodName: string): MealDraftItem {
  return {
    foodName,
    canonicalName: foodName,
    brand: null,
    quantity: 1,
    unit: "porção",
    portionText: "1 porção",
    servings: 1,
    estimatedGrams: 100,
    calories: 150,
    protein: 6,
    carbs: 15,
    fat: 5,
    confidence: 0.8,
    source: "heuristic",
  };
}

describe("open container-content classes issue #982", () => {
  it("rejeita negativos withheld sem copiar os substantivos para o discriminador", () => {
    const withheldNegatives = [
      "Pote de caderno escolar",
      "Copo de sapato esportivo",
      "Tigela com livro didático",
      "Travessa de violão elétrico",
      "Marmita de revista acadêmica",
      "Panela com controle remoto",
    ];

    expect(withheldNegatives.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva positivos culinários withheld fora do catálogo e da lista de produção", () => {
    const withheldPositives = [
      "Copo de kvass",
      "Prato de injera",
      "Pote de mochi",
      "Tigela de okonomiyaki caseiro",
      "Bandeja de arepa venezuelana",
      "Pote de kimchi industrializado",
      "Copo de bubble tea",
    ];

    expect(withheldPositives.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });
});
