import { describe, expect, it } from "vitest";
import {
  calculateCalorieAdherence,
  calculateFoodQualitySummary,
  calculateMacroAdherence,
  calculateMacroDaySummary,
  calculateWeightTrendSummary,
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

  it("resume qualidade alimentar sem distorcer percentuais por itens não classificados", () => {
    const summary = calculateFoodQualitySummary(
      [
        {
          date: "2026-06-01",
          items: [
            { calories: 120, isFruit: true, isClassified: true },
            { calories: 180, isVegetable: true, isClassified: true },
            { calories: 300, isUltraProcessed: true, isClassified: true },
          ],
        },
        {
          date: "2026-06-02",
          items: [
            { calories: 400, isClassified: false },
            { calories: 100, isVegetable: true, isClassified: true },
          ],
        },
      ],
      3,
    );

    expect(summary.hasData).toBe(true);
    expect(summary.dayCount).toBe(3);
    expect(summary.daysWithRecords).toBe(2);
    expect(summary.fruitDays).toBe(1);
    expect(summary.vegetableDays).toBe(2);
    expect(summary.totalCalories).toBe(1100);
    expect(summary.naturalOrMinimallyProcessedCalories).toBe(400);
    expect(summary.ultraProcessedCalories).toBe(300);
    expect(summary.unclassifiedCalories).toBe(400);
    expect(summary.naturalOrMinimallyProcessedCaloriesPercent).toBe(36.4);
    expect(summary.ultraProcessedCaloriesPercent).toBe(27.3);
    expect(summary.unclassifiedCaloriesPercent).toBe(36.4);
    expect(summary.qualityIndex).toBe(57.1);
  });

  it("retorna estado vazio para qualidade alimentar sem calorias registradas", () => {
    const summary = calculateFoodQualitySummary([{ date: "2026-06-01", items: [] }], 1);

    expect(summary.hasData).toBe(false);
    expect(summary.totalCalories).toBe(0);
    expect(summary.qualityIndex).toBeNull();
    expect(summary.distribution.every(item => item.percent === 0)).toBe(true);
  });

  it("calcula evolução de peso com variação absoluta, percentual e tendência", () => {
    const summary = calculateWeightTrendSummary([
      { date: "2026-06-03", weightKg: 82.4 },
      { date: "2026-06-01", weightKg: 83.1 },
      { date: "2026-06-07", weightKg: 81.9 },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.entryCount).toBe(3);
    expect(summary.firstWeightKg).toBe(83.1);
    expect(summary.lastWeightKg).toBe(81.9);
    expect(summary.deltaKg).toBe(-1.2);
    expect(summary.deltaPercent).toBe(-1.4);
    expect(summary.trendDirection).toBe("down");
  });

  it("mantém leitura cautelosa quando há apenas um registro de peso", () => {
    const summary = calculateWeightTrendSummary([
      { date: "2026-06-03", weightKg: 82.4 },
    ]);

    expect(summary.hasData).toBe(true);
    expect(summary.entryCount).toBe(1);
    expect(summary.deltaKg).toBe(0);
    expect(summary.deltaPercent).toBe(0);
    expect(summary.trendDirection).toBe("insufficient_data");
    expect(summary.trendMessage).toContain("tendência ainda é insuficiente");
  });

  it("retorna estado vazio para período sem peso", () => {
    const summary = calculateWeightTrendSummary([]);

    expect(summary.hasData).toBe(false);
    expect(summary.entryCount).toBe(0);
    expect(summary.firstWeightKg).toBeNull();
    expect(summary.lastWeightKg).toBeNull();
    expect(summary.trendDirection).toBe("insufficient_data");
  });
});
