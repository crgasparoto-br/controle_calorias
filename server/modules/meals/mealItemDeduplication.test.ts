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
      portionText: "660 ml",
      estimatedGrams: 660,
      calories: 300,
      protein: 2,
      carbs: 24,
      fat: 0,
    }));
  });
});
