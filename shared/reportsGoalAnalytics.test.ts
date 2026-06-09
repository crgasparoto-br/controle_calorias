import { describe, expect, it } from "vitest";
import {
  calculateCalorieAdherence,
  calculateMacroAdherence,
  calculateMacroDaySummary,
} from "./reportsGoalAnalytics";

describe("reportsGoalAnalytics", () => {
  it("calcula aderência calórica e classifica dias por faixa", () => {
    const summary = calculateCalorieAdherence(
      [
        { calories: 1900, goalCalories: 2000 },
        { calories: 2300, goalCalories: 2000 },
        { calories: 1500, goalCalories: 2000 },
      ],
      4,
    );

    expect(summary.totalCalories).toBe(5700);
    expect(summary.totalGoalCalories).toBe(6000);
    expect(summary.averageCalories).toBe(1425);
    expect(summary.averageGoalCalories).toBe(1500);
    expect(summary.averageDeltaCalories).toBe(-75);
    expect(summary.adherencePercent).toBe(95);
    expect(summary.daysWithinRange).toBe(1);
    expect(summary.daysAboveRange).toBe(1);
    expect(summary.daysBelowRange).toBe(1);
    expect(summary.daysWithoutRecords).toBe(1);
  });

  it("usa metas ajustadas como alvo da aderência calórica", () => {
    const summary = calculateCalorieAdherence(
      [
        { calories: 2100, goalCalories: 2200 },
        { calories: 1800, goalCalories: 2000 },
      ],
      2,
    );

    expect(summary.totalCalories).toBe(3900);
    expect(summary.totalGoalCalories).toBe(4200);
    expect(summary.averageDeltaCalories).toBe(-150);
    expect(summary.adherencePercent).toBe(93);
    expect(summary.daysWithinRange).toBe(2);
    expect(summary.daysAboveRange).toBe(0);
    expect(summary.daysBelowRange).toBe(0);
  });

  it("compara macros planejados e realizados por gramas e distribuição calórica", () => {
    const analysis = calculateMacroAdherence(
      { protein: 120, carbs: 180, fat: 90 },
      { protein: 150, carbs: 250, fat: 67 },
    );

    expect(analysis.items).toHaveLength(3);
    expect(analysis.mostDistantMacro?.key).toBe("fat");
    expect(analysis.items.find(item => item.key === "protein")?.gramDelta).toBe(-30);
    expect(analysis.items.find(item => item.key === "fat")?.consumedPercent).toBeGreaterThan(
      analysis.items.find(item => item.key === "fat")?.plannedPercent ?? 0,
    );
    expect(analysis.distributionAdherencePercent).toBeGreaterThan(70);
    expect(analysis.distributionAdherencePercent).toBeLessThan(100);
  });

  it("resume dias com proteína na faixa e gordura acima da meta", () => {
    const summary = calculateMacroDaySummary([
      { protein: 145, carbs: 210, fat: 68, goalProtein: 150, goalCarbs: 220, goalFat: 65 },
      { protein: 100, carbs: 260, fat: 82, goalProtein: 150, goalCarbs: 220, goalFat: 65 },
      { protein: 0, carbs: 0, fat: 0, goalProtein: 150, goalCarbs: 220, goalFat: 65 },
    ]);

    expect(summary.daysWithMacroRecords).toBe(2);
    expect(summary.proteinDaysWithinGoal).toBe(1);
    expect(summary.fatDaysAboveGoal).toBe(1);
  });
});
