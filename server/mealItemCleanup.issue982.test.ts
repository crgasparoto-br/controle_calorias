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

describe("cleanMealItems issue #982", () => {
  it("preserva preparações válidas que contêm nome de recipiente", () => {
    const cleaned = cleanMealItems([
      item("Bolo de pote"),
      item("Bolo de pote ninho cremoso"),
      item("Copo de açaí"),
    ]);

    expect(cleaned.map(entry => entry.foodName)).toEqual([
      "Bolo de pote",
      "Bolo de pote ninho cremoso",
      "Copo de açaí",
    ]);
  });

  it.each([
    "Pote",
    "Pote vazio",
    "Copo descartável",
    "Tigela de plástico",
    "Prato",
    "Marmita vazia",
    "Decoração",
    "Pote quebrado",
    "Copo azul",
    "Tigela nova",
    "Prato decorativo",
  ])("continua descartando objeto ou ruído não alimentar: %s", foodName => {
    expect(cleanMealItems([item(foodName)])).toEqual([]);
  });

  it("não depende de cadastrar previamente cada adjetivo de objeto", () => {
    const arbitraryObjectModifiers = [
      "Pote translúcido",
      "Copo rachado",
      "Tigela brilhante",
    ];

    expect(arbitraryObjectModifiers.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });
});
