import { describe, expect, it } from "vitest";
import { recalculateMealItemQuantityUnit } from "./mealFormState";
import type { MealItemState } from "./types";

function buildItem(overrides: Partial<MealItemState> = {}): MealItemState {
  return {
    foodName: "alimento teste",
    canonicalName: "Alimento teste",
    portionText: "100 g",
    quantity: 100,
    unit: "g",
    servings: 1,
    estimatedGrams: 100,
    calories: 200,
    protein: 10,
    carbs: 20,
    fat: 5,
    confidence: 1,
    source: "catalog",
    ...overrides,
  };
}

describe("meal form quantity recalculation", () => {
  it("recalcula macros proporcionalmente ao alterar quantidade em gramas", () => {
    const updated = recalculateMealItemQuantityUnit(buildItem(), 300, "g");

    expect(updated).toEqual(expect.objectContaining({
      quantity: 300,
      unit: "g",
      portionText: "300 g",
      servings: 3,
      estimatedGrams: 300,
      calories: 600,
      protein: 30,
      carbs: 60,
      fat: 15,
    }));
  });

  it("usa valores atuais como base proporcional apos edicao manual de macros", () => {
    const manuallyEdited = buildItem({
      calories: 250,
      protein: 12,
      carbs: 24,
      fat: 6,
    });

    const updated = recalculateMealItemQuantityUnit(manuallyEdited, 200, "g");

    expect(updated).toEqual(expect.objectContaining({
      quantity: 200,
      estimatedGrams: 200,
      calories: 500,
      protein: 24,
      carbs: 48,
      fat: 12,
    }));
  });

  it("preserva macros quando unidade nao possui conversao conhecida", () => {
    const updated = recalculateMealItemQuantityUnit(buildItem(), 2, "fatias");

    expect(updated).toEqual(expect.objectContaining({
      quantity: 2,
      unit: "fatias",
      portionText: "2 fatias",
      servings: 1,
      estimatedGrams: 100,
      calories: 200,
      protein: 10,
      carbs: 20,
      fat: 5,
    }));
  });

  it("normaliza unidade comum antes de recalcular", () => {
    const updated = recalculateMealItemQuantityUnit(buildItem(), 300, "gramas");

    expect(updated).toEqual(expect.objectContaining({
      quantity: 300,
      unit: "g",
      portionText: "300 g",
      estimatedGrams: 300,
      calories: 600,
    }));
  });
});
