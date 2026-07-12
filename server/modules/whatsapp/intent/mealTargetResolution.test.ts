import { describe, expect, it } from "vitest";
import { resolveTargetMealItemInMeals } from "./mealTargetResolution";

function item(foodName: string, estimatedGrams = 100) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${estimatedGrams} g`,
    estimatedGrams,
    servings: 1,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 2,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

describe("resolveTargetMealItemInMeals", () => {
  it("preserva a refeição real de cada candidato em ambiguidade entre refeições", () => {
    const meals = [
      {
        id: 1,
        mealLabel: "Jantar",
        occurredAt: "2026-07-12T22:00:00.000Z",
        items: [item("Arroz integral")],
      },
      {
        id: 2,
        mealLabel: "Almoço",
        occurredAt: "2026-07-12T16:00:00.000Z",
        items: [item("Queijo minas")],
      },
      {
        id: 3,
        mealLabel: "Café da manhã",
        occurredAt: "2026-07-12T11:00:00.000Z",
        items: [item("Queijo mussarela")],
      },
    ];

    const result = resolveTargetMealItemInMeals(meals, "queijo");

    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("resultado inesperado");
    expect(result.candidates).toEqual([
      expect.objectContaining({ meal: expect.objectContaining({ id: 2 }), mealIndex: 1, item: expect.objectContaining({ foodName: "Queijo minas" }) }),
      expect.objectContaining({ meal: expect.objectContaining({ id: 3 }), mealIndex: 2, item: expect.objectContaining({ foodName: "Queijo mussarela" }) }),
    ]);
  });

  it("mantém dois itens compatíveis da mesma refeição como candidatos distintos", () => {
    const meals = [
      {
        id: 10,
        mealLabel: "Lanche",
        occurredAt: "2026-07-12T18:00:00.000Z",
        items: [item("Queijo minas", 80), item("Queijo minas", 40)],
      },
    ];

    const result = resolveTargetMealItemInMeals(meals, "queijo minas");

    expect(result.kind).toBe("ambiguous");
    if (result.kind !== "ambiguous") throw new Error("resultado inesperado");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.map(candidate => candidate.index)).toEqual([0, 1]);
    expect(result.candidates.every(candidate => candidate.meal.id === 10)).toBe(true);
  });
});
