import { describe, expect, it, vi } from "vitest";
import type { NutritionGoal } from "../../../drizzle/schema";
import type { NutritionGoalsRepository } from "../../repositories/nutritionGoalsRepository";
import { createGoalsService } from "./store";

function createRepository(rows: NutritionGoal[] | null = null): NutritionGoalsRepository {
  return {
    findByUserId: async userId => rows?.filter(row => row.userId === userId) ?? null,
    replaceForUser: async (_userId, goals) => {
      rows = goals;
    },
    createVersionForUser: async (_userId, goals) => {
      rows = [...(rows ?? []), ...goals];
    },
  };
}

describe("createGoalsService", () => {
  it("retorna meta padrao em fallback de memoria quando usuario nao possui meta", async () => {
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(null),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent: vi.fn(),
    });

    const goal = await service.getUserNutritionGoal(1);

    expect(goal.defaultGoal).toMatchObject({ userId: 1, calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 });
    expect(goal.days).toHaveLength(7);
    expect(goal.today.source).toBe("default");
  });

  it("preserva excecoes e totais semanais ao atualizar meta", async () => {
    const onEvent = vi.fn();
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(null),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent,
    });

    const goal = await service.upsertNutritionGoal(2, {
      defaultGoal: { calories: 2000, proteinGrams: 150, carbsGrams: 220, fatGrams: 60 },
      exceptions: [
        { weekday: 2, durationType: "always", calories: 2300, proteinGrams: 170, carbsGrams: 260, fatGrams: 70 },
      ],
    });

    expect(goal.defaultGoal).toMatchObject({ userId: 2, calories: 2000 });
    expect(goal.days.find(day => day.weekday === 2)).toMatchObject({ source: "exception", calories: 2300 });
    expect(goal.weeklyTotals.calories).toBe(14300);
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({ eventType: "goal.updated", userId: 2 }));
  });

  it("isola metas persistidas por usuario", async () => {
    const persisted: NutritionGoal[] = [
      {
        id: 10,
        userId: 3,
        ruleType: "default",
        weekday: -1,
        durationType: "always",
        calories: 1800,
        proteinGrams: 120,
        carbsGrams: 200,
        fatGrams: 55,
        effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
        effectiveUntil: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    ];
    const service = createGoalsService({
      nutritionGoalsRepository: createRepository(persisted),
      now: () => new Date("2026-01-07T12:00:00.000Z"),
      onEvent: vi.fn(),
    });

    await expect(service.getUserNutritionGoal(3)).resolves.toMatchObject({ defaultGoal: { calories: 1800 } });
    await expect(service.getUserNutritionGoal(4)).resolves.toMatchObject({ defaultGoal: { calories: 2200 } });
  });
});
