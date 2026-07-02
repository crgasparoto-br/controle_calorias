import { describe, expect, it } from "vitest";
import { hasReportDayActivity, validateWeeklyReportData } from "./reportDataAdapter";

function weeklyDay(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    label: date,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    goalCalories: 2200,
    adjustedGoalCalories: 2200,
    goalProtein: 150,
    goalCarbs: 220,
    goalFat: 70,
    waterConsumedMl: 0,
    waterGoalMl: 2500,
    exerciseCalories: 0,
    quality: {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
      foodQualityItems: [],
    },
    ...overrides,
  };
}

function validWeek(overrides: Record<string, unknown> = {}) {
  return Array.from({ length: 7 }, (_, index) => weeklyDay(`2026-06-${String(22 + index).padStart(2, "0")}`, overrides));
}

describe("weekly report data adapter", () => {
  it("aceita resumo semanal completo com 7 dias renderizáveis", () => {
    const validation = validateWeeklyReportData(validWeek({ calories: 1800, protein: 120 }));

    expect(validation.renderable).toBe(true);
    expect(validation.days).toHaveLength(7);
    expect(validation.days[0]).toMatchObject({ date: "2026-06-22", calories: 1800, protein: 120 });
  });

  it("envia semana totalmente zerada para fallback antes de renderizar", () => {
    const validation = validateWeeklyReportData({ weekly: validWeek() });

    expect(validation).toMatchObject({ renderable: false, reason: "empty_weekly_summary" });
  });

  it("considera água, exercícios e qualidade como atividade renderizável", () => {
    expect(hasReportDayActivity(weeklyDay("2026-06-22", { waterConsumedMl: 500 }))).toBe(true);
    expect(hasReportDayActivity(weeklyDay("2026-06-22", { exerciseCalories: 120 }))).toBe(true);
    expect(hasReportDayActivity(weeklyDay("2026-06-22", { quality: { mealCount: 1 } }))).toBe(true);
  });

  it("rejeita retorno vazio ou semana incompleta", () => {
    expect(validateWeeklyReportData([])).toMatchObject({ renderable: false, reason: "expected_7_days" });
    expect(validateWeeklyReportData(validWeek().slice(0, 6))).toMatchObject({ renderable: false, reason: "expected_7_days" });
  });

  it("rejeita dias sem data ou com campos numéricos incompatíveis", () => {
    expect(validateWeeklyReportData(validWeek({ date: "" }))).toMatchObject({ renderable: false, reason: "invalid_day_date" });
    expect(validateWeeklyReportData(validWeek({ calories: "não numérico" }))).toMatchObject({ renderable: false, reason: "invalid_calories" });
  });
});
