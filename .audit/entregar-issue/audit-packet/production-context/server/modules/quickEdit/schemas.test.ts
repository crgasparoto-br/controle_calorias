import { describe, expect, it } from "vitest";
import { quickEditExerciseUpdateSchema, quickEditMealUpdateSchema } from "./schemas";

const mealItems = [{
  foodName: "Arroz",
  canonicalName: "arroz",
  portionText: "100 g",
  servings: 1,
  estimatedGrams: 100,
  calories: 130,
  protein: 2,
  carbs: 28,
  fat: 0.3,
  confidence: 1,
  source: "heuristic" as const,
}];

describe("quick edit temporal schemas", () => {
  it("rejeita o caminho legado occurredAt para refeição", () => {
    const result = quickEditMealUpdateSchema.safeParse({
      token: "x".repeat(32),
      meal: { mealLabel: "Almoço", occurredAt: "2026-07-16T13:30:00.000Z", items: mealItems },
    });
    expect(result.success).toBe(false);
  });

  it("rejeita o caminho legado occurredAt para exercício", () => {
    const result = quickEditExerciseUpdateSchema.safeParse({
      token: "x".repeat(32),
      exercise: { activityType: "Corrida", durationMinutes: 30, caloriesBurned: 250, occurredAt: "2026-07-16T13:30:00.000Z" },
    });
    expect(result.success).toBe(false);
  });
});
