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
      item("Copo de smoothie de pitaya"),
      item("Tigela com bubble tea"),
      item("Bandeja de sushi vegano"),
      item("Travessa com lasanha caseira"),
      item("Copo açaí"),
      item("Pote iogurte"),
      item("Marmita frango arroz"),
    ]);

    expect(cleaned.map(entry => entry.foodName)).toEqual([
      "Bolo de pote",
      "Bolo de pote ninho cremoso",
      "Copo de açaí",
      "Copo de smoothie de pitaya",
      "Tigela com bubble tea",
      "Bandeja de sushi vegano",
      "Travessa com lasanha caseira",
      "Copo açaí",
      "Pote iogurte",
      "Marmita frango arroz",
    ]);
  });

  it.each([
    "Pote",
    "Pote vazio",
    "Copo descartável",
    "Tigela de plástico",
    "Copo com tampa",
    "Pote de vidro",
    "Bandeja de alumínio",
    "Panela de pressão",
    "Prato",
    "Marmita vazia",
    "Decoração",
    "Pote quebrado",
    "Copo azul",
    "Tigela nova",
    "Prato decorativo",
    "Copo de brinquedo",
    "Pote de tinta",
    "Bandeja de isopor",
    "Panela com cabo",
    "Tigela de parafuso",
    "Pote de cimento",
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

  it("rejeita complemento unitário desconhecido após conectores sem enumeração finita", () => {
    const novelConnectorObjects = [
      "Copo de brinquedo",
      "Pote de tinta",
      "Bandeja de isopor",
      "Panela com cabo",
      "Tigela de parafuso",
      "Pote de cimento",
    ];

    expect(novelConnectorObjects.every(foodName => cleanMealItems([item(foodName)]).length === 0)).toBe(true);
  });

  it("preserva sinal alimentar conhecido mesmo sem de/com", () => {
    const implicitServingContent = [
      "Copo açaí",
      "Pote iogurte",
      "Marmita frango arroz",
    ];

    expect(implicitServingContent.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });

  it("não exige que o conteúdo alimentar do recipiente já exista na TACO", () => {
    const uncataloguedPreparations = [
      "Copo de smoothie de pitaya",
      "Tigela com bubble tea",
      "Pote de sobremesa artesanal",
      "Bandeja de sushi vegano",
      "Travessa com lasanha caseira",
    ];

    expect(uncataloguedPreparations.every(foodName => cleanMealItems([item(foodName)]).length === 1)).toBe(true);
  });
});
