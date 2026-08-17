import { describe, expect, it } from "vitest";
import { normalizeMealItemForSubmit, recalculateMealItemQuantityUnit } from "./mealFormState";
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
      unit: "fatia",
      portionText: "2 fatia",
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

  it("limita o recalculo aos valores aceitos pelo backend", () => {
    const updated = recalculateMealItemQuantityUnit(buildItem({
      servings: 15,
      calories: 600,
      protein: 80,
      carbs: 80,
      fat: 80,
    }), 9999, "g");

    expect(updated).toEqual(expect.objectContaining({
      quantity: 5000,
      unit: "g",
      portionText: "5000 g",
      servings: 20,
      estimatedGrams: 5000,
      calories: 10000,
      protein: 1000,
      carbs: 1000,
      fat: 1000,
    }));
  });

  it("normaliza valores editados para o intervalo aceito no salvamento", () => {
    const normalized = normalizeMealItemForSubmit(buildItem({
      foodName: " Café ",
      canonicalName: "",
      quantity: 6000,
      servings: 30,
      estimatedGrams: 6000,
      calories: 12000,
      protein: 1200,
      carbs: 1200,
      fat: 1200,
      confidence: 2,
    }));

    expect(normalized).toEqual(expect.objectContaining({
      foodName: "Café",
      canonicalName: "Café",
      quantity: 5000,
      servings: 20,
      estimatedGrams: 5000,
      calories: 10000,
      protein: 1000,
      carbs: 1000,
      fat: 1000,
      confidence: 1,
    }));
  });
});
