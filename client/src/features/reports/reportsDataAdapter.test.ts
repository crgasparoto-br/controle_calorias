import { describe, expect, it } from "vitest";
import { extractReportDays, isRenderableWeeklySummary } from "./reportsDataAdapter";

const range = { start: "2026-06-01", end: "2026-06-07" };
const dates = ["2026-06-01", "2026-06-02", "2026-06-03", "2026-06-04", "2026-06-05", "2026-06-06", "2026-06-07"];

function weeklyDay(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date,
    label: date.slice(5),
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    goalCalories: 2000,
    adjustedGoalCalories: 2000,
    goalProtein: 150,
    goalCarbs: 220,
    goalFat: 65,
    waterConsumedMl: 0,
    waterGoalMl: 2000,
    exerciseCalories: 0,
    ...overrides,
  };
}

function weeklySummary(overrides: Record<string, unknown> = {}) {
  return dates.map(date => weeklyDay(date, overrides));
}

describe("reportsDataAdapter", () => {
  it("aceita resumo semanal com 7 dias renderizáveis", () => {
    expect(isRenderableWeeklySummary(weeklySummary(), range)).toBe(true);
  });

  it("aceita semana sem registros quando os 7 dias vêm zerados", () => {
    const emptyWeek = weeklySummary({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      waterConsumedMl: 0,
      exerciseCalories: 0,
    });

    expect(isRenderableWeeklySummary({ weekly: emptyWeek }, range)).toBe(true);
  });

  it("rejeita resumo vazio, incompleto ou sem data", () => {
    expect(isRenderableWeeklySummary([], range)).toBe(false);
    expect(isRenderableWeeklySummary(weeklySummary().slice(0, 6), range)).toBe(false);
    expect(isRenderableWeeklySummary(weeklySummary({ date: undefined }), range)).toBe(false);
  });

  it("rejeita campos numéricos obrigatórios ausentes ou incompatíveis", () => {
    expect(isRenderableWeeklySummary(weeklySummary({ adjustedGoalCalories: undefined }), range)).toBe(false);
    expect(isRenderableWeeklySummary(weeklySummary({ waterConsumedMl: "abc" }), range)).toBe(false);
  });

  it("extrai dias semanais e de período dos formatos aceitos", () => {
    const week = weeklySummary();
    const period = [weeklyDay("2026-06-01")];

    expect(extractReportDays(week, "week")).toBe(week);
    expect(extractReportDays({ weekly: week }, "week")).toBe(week);
    expect(extractReportDays({ weeklyReport: week }, "week")).toBe(week);
    expect(extractReportDays({ daily: period }, "period")).toBe(period);
  });
});
