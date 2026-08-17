import { describe, expect, it } from "vitest";
import { WeeklyInsightService } from "./weeklyInsightService";

const service = new WeeklyInsightService();

describe("WeeklyInsightService", () => {
  it("gera insights mínimos com sugestão prática, severidade e dados usados", () => {
    const insights = service.generate({
      days: [
        { date: "2026-04-20", label: "seg.", calories: 1950, protein: 130, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-21", label: "ter.", calories: 2300, protein: 160, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-22", label: "qua.", calories: 0, protein: 0, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-23", label: "qui.", calories: 1700, protein: 80, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-24", label: "sex.", calories: 2000, protein: 135, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-25", label: "sáb.", calories: 2600, protein: 120, goalCalories: 2000, goalProtein: 140 },
        { date: "2026-04-26", label: "dom.", calories: 2100, protein: 150, goalCalories: 2000, goalProtein: 140 },
      ],
      meals: [
        {
          id: 10,
          mealLabel: "almoço",
          occurredAt: new Date("2026-04-25T15:00:00.000Z").getTime(),
          items: [
            { calories: 800, protein: 45, carbs: 90, fat: 25 },
            { calories: 350, protein: 8, carbs: 45, fat: 12 },
          ],
        },
        {
          id: 11,
          mealLabel: "lanche",
          occurredAt: new Date("2026-04-21T19:00:00.000Z").getTime(),
          items: [
            { calories: 420, protein: 12, carbs: 55, fat: 14 },
          ],
        },
      ],
    });

    expect(insights).toHaveLength(6);
    expect(insights.map(insight => insight.title)).toEqual([
      "Aderência à meta calórica semanal",
      "Dias com proteína dentro da meta",
      "Refeição com maior concentração calórica",
      "Diferença entre semana e fim de semana",
      "Frequência de registro",
      "Melhor oportunidade para a próxima semana",
    ]);

    for (const insight of insights) {
      expect(insight.description.length).toBeGreaterThan(10);
      expect(insight.suggestion.length).toBeGreaterThan(10);
      expect(["info", "positive", "warning"]).toContain(insight.severity);
      expect(Object.keys(insight.data).length).toBeGreaterThan(0);
    }

    const biggestMeal = insights.find(insight => insight.title === "Refeição com maior concentração calórica");
    expect(biggestMeal?.data.mealId).toBe(10);
    expect(biggestMeal?.data.calories).toBe(1150);
  });

  it("trata semana sem refeições com linguagem prática e neutra", () => {
    const insights = service.generate({
      days: Array.from({ length: 7 }).map((_, index) => ({
        date: `2026-04-2${index}`,
        label: "dia",
        calories: 0,
        protein: 0,
        goalCalories: 2000,
        goalProtein: 140,
      })),
      meals: [],
    });

    expect(insights[0].description).toContain("0%");
    expect(insights[2].description).toContain("Ainda não há refeições");
    expect(insights[4].data.daysWithRecords).toBe(0);
  });
});
