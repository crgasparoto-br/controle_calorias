import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listUserExercises: vi.fn(),
  listUserMeals: vi.fn(),
  listUserWaterLogs: vi.fn(),
}));

const repositoryMocks = vi.hoisted(() => ({
  meals: {
    findConfirmedByUserId: vi.fn(),
  },
  exercises: {
    findByUserIdAndRange: vi.fn(),
  },
  water: {
    findLogsByUserIdAndRange: vi.fn(),
  },
}));

vi.mock("../../db", () => dbMocks);
vi.mock("../../privacy", () => ({
  safeLogDetail: () => "safe-error",
}));
vi.mock("../../repositories/mealsRepository", () => ({
  createDrizzleMealsRepository: () => repositoryMocks.meals,
}));
vi.mock("../../repositories/exercisesRepository", () => ({
  createDrizzleExercisesRepository: () => repositoryMocks.exercises,
}));
vi.mock("../../repositories/waterRepository", () => ({
  createDrizzleWaterRepository: () => repositoryMocks.water,
}));
vi.mock("./reportMetrics", () => ({
  estimateReportPayloadBytes: () => 0,
  getReportRangeDays: () => 7,
  logReportStageMetric: vi.fn(),
}));

import {
  listReportExercisesByDateRange,
  listReportMealsByDateRange,
  listReportWaterLogsByDateRange,
} from "./rangeData";

describe("report range data empty reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getDb.mockResolvedValue({});
    dbMocks.listUserMeals.mockResolvedValue([]);
    dbMocks.listUserExercises.mockResolvedValue([]);
    dbMocks.listUserWaterLogs.mockResolvedValue([]);
    repositoryMocks.meals.findConfirmedByUserId.mockResolvedValue([]);
    repositoryMocks.exercises.findByUserIdAndRange.mockResolvedValue([]);
    repositoryMocks.water.findLogsByUserIdAndRange.mockResolvedValue([]);
  });

  it("não carrega histórico completo quando o range do banco retorna vazio legitimamente", async () => {
    const range = { startDate: "2026-06-22", endDate: "2026-06-28" };

    await expect(listReportMealsByDateRange(77, range, "UTC")).resolves.toEqual([]);
    await expect(listReportExercisesByDateRange(77, range, "UTC")).resolves.toEqual([]);
    await expect(listReportWaterLogsByDateRange(77, range, "UTC")).resolves.toEqual([]);

    expect(dbMocks.listUserMeals).not.toHaveBeenCalled();
    expect(dbMocks.listUserExercises).not.toHaveBeenCalled();
    expect(dbMocks.listUserWaterLogs).not.toHaveBeenCalled();
  });

  it("mantém fallback histórico quando a leitura otimizada não está disponível", async () => {
    const range = { startDate: "2026-06-22", endDate: "2026-06-28" };
    repositoryMocks.meals.findConfirmedByUserId.mockResolvedValue(null);
    repositoryMocks.exercises.findByUserIdAndRange.mockResolvedValue(null);
    repositoryMocks.water.findLogsByUserIdAndRange.mockResolvedValue(null);

    await listReportMealsByDateRange(77, range, "UTC");
    await listReportExercisesByDateRange(77, range, "UTC");
    await listReportWaterLogsByDateRange(77, range, "UTC");

    expect(dbMocks.listUserMeals).toHaveBeenCalledTimes(1);
    expect(dbMocks.listUserExercises).toHaveBeenCalledTimes(1);
    expect(dbMocks.listUserWaterLogs).toHaveBeenCalledTimes(1);
  });
});
