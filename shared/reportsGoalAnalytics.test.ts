import { describe, expect, it } from "vitest";
import { calculateCalorieAdherence, calculateMacroAdherence } from "./reportsGoalAnalytics";

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
});
