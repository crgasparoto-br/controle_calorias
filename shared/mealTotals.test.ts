import { describe, expect, it } from "vitest";
import { addMealTotals, calculateDayTotals, calculateMealTotals, roundNutritionValue } from "./mealTotals";

describe("meal totals", () => {
  it("soma calorias e macros com arredondamento estável", () => {
    const totals = calculateMealTotals([
      { calories: 128.4, protein: 2.55, carbs: 28.1, fat: 0.25 },
      { calories: 165.2, protein: 31.35, carbs: 0, fat: 3.62 },
      { calories: 54.9, protein: 1.8, carbs: 10.65, fat: 0.35 },
    ]);

    expect(totals).toEqual({
      calories: 348.5,
      protein: 35.7,
      carbs: 38.8,
      fat: 4.2,
    });
  });

  it("calcula totais do dia a partir de refeições editadas sem depender do horário real", () => {
    const breakfast = {
      occurredAt: "2026-04-22T10:00:00.000Z",
      items: [{ calories: 210, protein: 12, carbs: 24, fat: 7 }],
    };
    const editedLunch = {
      occurredAt: "2026-04-22T15:00:00.000Z",
      items: [
        { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
        { calories: 247.5, protein: 46.5, carbs: 0, fat: 5.4 },
      ],
    };

    expect(calculateDayTotals([breakfast, editedLunch])).toEqual({
      calories: 587.5,
      protein: 61.2,
      carbs: 52,
      fat: 12.7,
    });
  });

  it("usa totais salvos da refeição quando disponíveis no resumo diário", () => {
    const persistedMeal = {
      occurredAt: "2026-06-02T15:00:00.000Z",
      items: [
        { calories: 500, protein: 40, carbs: 25, fat: 34.2 },
        { calories: 520, protein: 30, carbs: 35, fat: 34.2 },
      ],
      totals: { calories: 1020, protein: 70, carbs: 60, fat: 69 },
    };

    expect(calculateDayTotals([persistedMeal])).toEqual({
      calories: 1020,
      protein: 70,
      carbs: 60,
      fat: 69,
    });
  });

  it("reaproveita a mesma regra para agregar totais semanais", () => {
    expect(addMealTotals([
      { calories: 458, protein: 48.5, carbs: 44.3, fat: 8.6 },
      { calories: 458, protein: 48.5, carbs: 44.3, fat: 8.6 },
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ])).toEqual({
      calories: 916,
      protein: 97,
      carbs: 88.6,
      fat: 17.2,
    });
  });

  it("centraliza arredondamento nutricional em uma casa decimal", () => {
    expect(roundNutritionValue(12.34)).toBe(12.3);
    expect(roundNutritionValue(12.35)).toBe(12.4);
  });
});
