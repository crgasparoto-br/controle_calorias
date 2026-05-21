import { describe, expect, it } from "vitest";
import { buildRegisteredMealGroups, normalizeMealType } from "./mealViewModels";
import type { StoredMeal } from "./types";

function buildMeal(overrides: Partial<StoredMeal>): StoredMeal {
  return {
    id: overrides.id ?? 1,
    mealLabel: overrides.mealLabel ?? "almoço",
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
  it("preserva nomes personalizados de refeição", () => {
    expect(normalizeMealType("pré-treino")).toBe("pré-treino");
    expect(normalizeMealType("ceia")).toBe("ceia");
    expect(normalizeMealType("  pós-treino  ")).toBe("pós-treino");
    expect(normalizeMealType("   ")).toBe("outro");
  });

  it("agrupa registros por nomes livres sem converter para outro", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({ id: 1, mealLabel: "pré-treino", totals: { calories: 80, protein: 1, carbs: 20, fat: 0 } }),
      buildMeal({ id: 2, mealLabel: "ceia", totals: { calories: 120, protein: 12, carbs: 8, fat: 4 } }),
      buildMeal({ id: 3, mealLabel: "pré-treino", totals: { calories: 100, protein: 10, carbs: 12, fat: 2 } }),
    ]);

    expect(groups.map(group => group.mealLabel)).toEqual(["pré-treino", "ceia"]);
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].totals.calories).toBe(180);
    expect(groups[1].items).toHaveLength(1);
  });

  it("usa imagem da refeição nos itens agrupados", () => {
    const groups = buildRegisteredMealGroups([
      buildMeal({
        id: 4,
        mealLabel: "lanche da tarde",
        imageUrl: "https://example.com/refeicao.jpg",
      }),
    ]);

    expect(groups[0].items[0].imageUrl).toBe("https://example.com/refeicao.jpg");
  });
});
