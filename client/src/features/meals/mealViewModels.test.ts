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
  it("keeps custom meal names", () => {
    expect(normalizeMealType("pre-treino")).toBe("pre-treino");
    expect(normalizeMealType("ceia")).toBe("ceia");
    expect(normalizeMealType("  pos-treino  ")).toBe("pos-treino");
    expect(normalizeMealType("   ")).toBe("outro");
  });

  it("groups records by free labels without converting them to outro", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({ id: 1, mealLabel: "pre-treino", totals: { calories: 80, protein: 1, carbs: 20, fat: 0 } }),
      buildMeal({ id: 2, mealLabel: "ceia", totals: { calories: 120, protein: 12, carbs: 8, fat: 4 } }),
      buildMeal({ id: 3, mealLabel: "pre-treino", totals: { calories: 100, protein: 10, carbs: 12, fat: 2 } }),
    ]);

    expect(groups.map(group => group.mealLabel)).toEqual(["pre-treino", "ceia"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totals.calories).toBe(180);
    expect(groups[1].items).toHaveLength(1);
  });

  it("uses meal image on grouped items", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({
        id: 4,
        mealLabel: "lanche da tarde",
        imageUrl: "meal-image.jpg",
      }),
    ]);

    expect(groups[0].items[0].imageUrl).toBe("meal-image.jpg");
  });
});
