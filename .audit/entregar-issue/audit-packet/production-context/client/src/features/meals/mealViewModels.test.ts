import { describe, expect, it } from "vitest";
import { buildRegisteredMealGroups, normalizeMealType } from "./mealViewModels";
import type { StoredMeal } from "./types";

function buildMeal(overrides: Partial<StoredMeal>): StoredMeal {
  return {
    id: overrides.id ?? 1,
    mealLabel: overrides.mealLabel ?? "almoco",
    occurredAt: overrides.occurredAt ?? new Date("2026-05-21T15:00:00.000Z").getTime(),
    notes: overrides.notes,
    source: overrides.source ?? "web",
    items: overrides.items ?? [
      {
        foodName: "Banana",
        canonicalName: "Banana",
        portionText: "1 unidade",
        servings: 1,
        estimatedGrams: 90,
        calories: 80,
        protein: 1,
        carbs: 20,
        fat: 0,
        confidence: 0.9,
        source: "catalog",
      },
    ],
    totals: overrides.totals ?? { calories: 80, protein: 1, carbs: 20, fat: 0 },
    media: overrides.media,
    imageUrl: overrides.imageUrl,
    supportingImageUrl: overrides.supportingImageUrl,
    photoUrl: overrides.photoUrl,
  };
}

describe("meal view models", () => {
  it("normalizes known meal names and keeps custom labels", () => {
    expect(normalizeMealType("pre-treino")).toBe("pré-treino");
    expect(normalizeMealType("Pré-Treino")).toBe("pré-treino");
    expect(normalizeMealType("ceia")).toBe("ceia");
    expect(normalizeMealType("  pos-treino  ")).toBe("pós-treino");
    expect(normalizeMealType("refeição personalizada")).toBe("refeição personalizada");
    expect(normalizeMealType("   ")).toBe("outro");
  });

  it("groups records by normalized labels without converting them to outro", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({ id: 1, mealLabel: "pre-treino", totals: { calories: 80, protein: 1, carbs: 20, fat: 0 } }),
      buildMeal({ id: 2, mealLabel: "ceia", totals: { calories: 120, protein: 12, carbs: 8, fat: 4 } }),
      buildMeal({ id: 3, mealLabel: "Pré-Treino", totals: { calories: 100, protein: 10, carbs: 12, fat: 2 } }),
    ]);

    expect(groups.map(group => group.mealLabel)).toEqual(["pré-treino", "ceia"]);
    expect(groups[0].records).toHaveLength(2);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totals.calories).toBe(180);
    expect(groups[1].records).toHaveLength(1);
  });

  it("keeps distinct meal records inside the same meal label group", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({
        id: 10,
        mealLabel: "almoço",
        occurredAt: new Date("2026-05-21T12:00:00.000Z").getTime(),
        items: [
          {
            foodName: "Arroz",
            canonicalName: "Arroz",
            portionText: "120 g",
            servings: 1,
            estimatedGrams: 120,
            calories: 156,
            protein: 3,
            carbs: 34,
            fat: 0,
            confidence: 1,
            source: "catalog",
          },
          {
            foodName: "Feijão",
            canonicalName: "Feijão",
            portionText: "90 g",
            servings: 1,
            estimatedGrams: 90,
            calories: 77,
            protein: 5,
            carbs: 14,
            fat: 1,
            confidence: 1,
            source: "catalog",
          },
        ],
        totals: { calories: 233, protein: 8, carbs: 48, fat: 1 },
      }),
      buildMeal({
        id: 11,
        mealLabel: "almoço",
        occurredAt: new Date("2026-05-21T14:00:00.000Z").getTime(),
        items: [
          {
            foodName: "Iogurte",
            canonicalName: "Iogurte",
            portionText: "1 pote",
            servings: 1,
            estimatedGrams: 170,
            calories: 110,
            protein: 6,
            carbs: 12,
            fat: 3,
            confidence: 1,
            source: "catalog",
          },
        ],
        totals: { calories: 110, protein: 6, carbs: 12, fat: 3 },
      }),
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].records).toHaveLength(2);
    expect(groups[0].records[0].meal.id).toBe(10);
    expect(groups[0].records[0].items).toHaveLength(2);
    expect(groups[0].records[1].meal.id).toBe(11);
    expect(groups[0].records[1].items).toHaveLength(1);
  });

  it("uses meal image on grouped records and items", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({
        id: 4,
        mealLabel: "lanche da tarde",
        imageUrl: "meal-image.jpg",
      }),
    ]);

    expect(groups[0].records[0].imageUrl).toBe("meal-image.jpg");
    expect(groups[0].items[0].imageUrl).toBe("meal-image.jpg");
  });
});
