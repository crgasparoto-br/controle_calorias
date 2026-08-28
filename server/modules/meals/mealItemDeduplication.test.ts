import { describe, expect, it } from "vitest";

import type { MealItemInput } from "./schemas";
import { dedupeMealItemsByProductIdentity } from "./mealItemDeduplication";

function beverage(foodName: string, portionText = "330 ml"): MealItemInput {
  return {
    foodName,
    canonicalName: foodName,
    portionText,
    servings: 1,
    estimatedGrams: 330,
    calories: 150,
    protein: 1,
    carbs: 12,
    fat: 0,
    confidence: 0.8,
    source: "heuristic",
  };
}

function catupiry(input: {
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  source: MealItemInput["source"];
}): MealItemInput {
  return {
    foodName: "Requeijão Catupiry Light",
    canonicalName: "Requeijão Catupiry Light",
    brand: "Catupiry",
    quantity: input.grams,
    unit: "g",
    portionText: `${input.grams} g`,
    servings: Math.max(input.grams / 100, 0.1),
    estimatedGrams: input.grams,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    confidence: input.source === "heuristic" ? 0.6 : 0.95,
    source: input.source,
  };
}

describe("dedupeMealItemsByProductIdentity", () => {
  it("nao soma cerveja Budweiser com cerveja Heineken", () => {
    const result = dedupeMealItemsByProductIdentity([
      beverage("cerveja Budweiser"),
      beverage("cerveja Heineken"),
    ]);

    expect(result).toHaveLength(2);
    expect(result).toEqual([
      expect.objectContaining({ foodName: "cerveja Budweiser", portionText: "330 ml" }),
      expect.objectContaining({ foodName: "cerveja Heineken", portionText: "330 ml" }),
    ]);
  });

  it("nao soma cerveja Budweiser com cerveja generica", () => {
    const result = dedupeMealItemsByProductIdentity([
      beverage("cerveja Budweiser"),
      beverage("cerveja"),
    ]);

    expect(result).toHaveLength(2);
    expect(result.map(item => item.foodName)).toEqual(["cerveja Budweiser", "cerveja"]);
  });

  it("soma entradas identicas de cerveja Budweiser", () => {
    const result = dedupeMealItemsByProductIdentity([
      beverage("cerveja Budweiser"),
      beverage("cerveja Budweiser"),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      foodName: "cerveja Budweiser",
      quantity: 660,
      unit: "ml",
      portionText: "660 ml",
      estimatedGrams: 660,
      calories: 300,
      protein: 2,
      carbs: 24,
      fat: 0,
    }));
  });

  it("não perpetua macros de fallback antigo quando a nova adição resolve o mesmo produto por referência canônica", () => {
    const legacyFallback = catupiry({
      grams: 45,
      calories: 67.5,
      protein: 2.7,
      carbs: 6.75,
      fat: 2.25,
      source: "heuristic",
    });
    const canonicalAddition = catupiry({
      grams: 60,
      calories: 72,
      protein: 4.8,
      carbs: 2.4,
      fat: 4.2,
      source: "hybrid",
    });

    const result = dedupeMealItemsByProductIdentity([legacyFallback, canonicalAddition]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      foodName: "Requeijão Catupiry Light",
      brand: "Catupiry",
      quantity: 105,
      unit: "g",
      portionText: "105 g",
      estimatedGrams: 105,
      calories: 126,
      protein: 8.4,
      carbs: 4.2,
      fat: 7.4,
      source: "hybrid",
    }));
    expect(result[0].calories).not.toBe(139.5);
  });
});
