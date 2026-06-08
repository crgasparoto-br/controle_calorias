import { describe, expect, it } from "vitest";

import { mealItemSchema } from "./schemas";

const baseItem = {
  foodName: "Amendoim japonês",
  canonicalName: "Amendoim japonês Elma Chips",
  portionText: "300 g",
  servings: 3,
  estimatedGrams: 300,
  calories: 450,
  protein: 12,
  carbs: 54,
  fat: 21,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("mealItemSchema quantity/unit", () => {
  it("mantem quantity e unit explicitos sem embutir numero na unidade", () => {
    const item = mealItemSchema.parse({
      ...baseItem,
      quantity: 300,
      unit: "g",
    });

    expect(item).toEqual(expect.objectContaining({
      quantity: 300,
      unit: "g",
      portionText: "300 g",
    }));
    expect(item.unit).not.toMatch(/\d/);
  });

  it("deriva quantity e unit de registros legados com apenas portionText", () => {
    const item = mealItemSchema.parse({
      ...baseItem,
      quantity: undefined,
      unit: undefined,
      portionText: "330 ml",
      servings: 1,
      estimatedGrams: 330,
    });

    expect(item).toEqual(expect.objectContaining({
      quantity: 330,
      unit: "ml",
      portionText: "330 ml",
    }));
    expect(item.unit).not.toMatch(/\d/);
  });
});
