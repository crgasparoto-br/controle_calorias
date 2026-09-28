import { describe, expect, it } from "vitest";
import type { MealItemInput } from "../../meals/schemas";
import { findTacoFood } from "../../../tacoLookup";
import { buildFoodAdditionItem, replaceMealItemFood } from "./mealItemHelpers";

const baseItem = {
  foodName: "maionese",
  canonicalName: "maionese",
  quantity: 185,
  unit: "g",
  portionText: "185 g",
  servings: 1,
  estimatedGrams: 185,
  calories: 1200,
  protein: 2,
  carbs: 1,
  fat: 130,
  confidence: 0.8,
  source: "catalog",
} as MealItemInput;

function placeholderFor(grams: number) {
  return [150, 6, 15, 5].map(value => Math.round(value * grams / 10) / 10);
}

describe("issue #1194 — substituição no WhatsApp reutiliza a referência local canônica", () => {
  it.each([
    ["melão dino", "melão"],
    ["abacaxi pérola", "abacaxi"],
    ["mussarela", "mussarela"],
  ])("%s usa a referência TACO escalada, não o placeholder 150/6/15/5", (target, baseName) => {
    const reference = findTacoFood(baseName)!;
    const replaced = replaceMealItemFood(baseItem, target);

    expect(replaced).toEqual(expect.objectContaining({
      foodName: target,
      estimatedGrams: 185,
      source: "catalog",
    }));
    expect([replaced.calories, replaced.protein, replaced.carbs, replaced.fat]).not.toEqual(placeholderFor(185));
    expect(replaced.calories).toBeCloseTo((reference.calories * 185) / reference.gramsPerServing, 1);
  });

  it("adição legada também preserva quantidade e referência", () => {
    const reference = findTacoFood("melão")!;
    const added = buildFoodAdditionItem("melão dino", 185, "g");

    expect(added).toEqual(expect.objectContaining({ quantity: 185, unit: "g", estimatedGrams: 185, source: "catalog" }));
    expect(added.calories).toBeCloseTo((reference.calories * 185) / reference.gramsPerServing, 1);
  });

  it("não usa base vegetal de token secundário como referência nutricional", () => {
    const replaced = replaceMealItemFood(baseItem, "manteiga de alho");

    expect(replaced.canonicalName).not.toMatch(/couve/i);
  });

  it("alimento realmente desconhecido mantém o fallback heurístico explícito", () => {
    const replaced = replaceMealItemFood(baseItem, "alimento desconhecido xyz");

    expect(replaced.source).toBe("heuristic");
    expect([replaced.calories, replaced.protein, replaced.carbs, replaced.fat]).toEqual(placeholderFor(185));
  });
});
