import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getUserDayMealTotals: vi.fn(),
  logInferenceEvent: vi.fn(),
}));
const getEffectiveNutritionGoalForDateMock = vi.hoisted(() => vi.fn());
const getWhatsAppOperationTimeZoneMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => dbMocks);
vi.mock("../goals/service", () => ({
  getEffectiveNutritionGoalForDate: getEffectiveNutritionGoalForDateMock,
}));
vi.mock("./timeZoneContext", () => ({
  getWhatsAppOperationTimeZone: getWhatsAppOperationTimeZoneMock,
}));

import { getWhatsAppMealGoalProgress } from "./goalProgressService";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("goalProgressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://test";
    getWhatsAppOperationTimeZoneMock.mockResolvedValue("America/Sao_Paulo");
    dbMocks.getUserDayMealTotals.mockResolvedValue({
      totals: { calories: 1850, protein: 110, carbs: 130, fat: 55 },
    });
    getEffectiveNutritionGoalForDateMock.mockImplementation(async (userId: number, dateKey: string) => {
      const baseGoal = dateKey === "2026-07-14" ? 1900 : 2000;
      const exerciseCalories = userId === 101 ? 300 : 80;
      return {
        effectiveGoalCalories: baseGoal + exerciseCalories,
        exerciseCalories,
        includeExerciseCalories: true,
        appliedGoal: {
          calories: baseGoal,
          proteinGrams: 120,
          carbsGrams: 150,
          fatGrams: 50,
        },
      };
    });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("isola as calorias de exercício por usuário mesmo na mesma data", async () => {
    const first = await getWhatsAppMealGoalProgress(101, new Date("2026-07-15T15:00:00-03:00"));
    const second = await getWhatsAppMealGoalProgress(202, new Date("2026-07-15T15:00:00-03:00"));

    expect(first).toMatchObject({ goalCalories: 2300, exerciseCalories: 300 });
    expect(second).toMatchObject({ goalCalories: 2080, exerciseCalories: 80 });
    expect(getEffectiveNutritionGoalForDateMock).toHaveBeenNthCalledWith(1, 101, "2026-07-15", "America/Sao_Paulo");
    expect(getEffectiveNutritionGoalForDateMock).toHaveBeenNthCalledWith(2, 202, "2026-07-15", "America/Sao_Paulo");
  });

  it("usa a versão histórica da meta aplicável à data da refeição", async () => {
    const result = await getWhatsAppMealGoalProgress(101, new Date("2026-07-14T15:00:00-03:00"));

    expect(getEffectiveNutritionGoalForDateMock).toHaveBeenCalledWith(101, "2026-07-14", expect.any(String));
    expect(result).toMatchObject({
      goalCalories: 2200,
      consumedCalories: 1850,
      exerciseCalories: 300,
    });
  });

  it("mapeia consumo diário e metas de macros sem ajustá-las por exercício", async () => {
    const result = await getWhatsAppMealGoalProgress(101, new Date("2026-07-15T15:00:00-03:00"));

    expect(result).toMatchObject({
      consumedProteinGrams: 110,
      targetProteinGrams: 120,
      consumedCarbsGrams: 130,
      targetCarbsGrams: 150,
      consumedFatGrams: 55,
      targetFatGrams: 50,
    });
  });

  it("resolve a data lógica no timezone do usuário", async () => {
    getWhatsAppOperationTimeZoneMock.mockResolvedValue("America/Los_Angeles");

    await getWhatsAppMealGoalProgress(101, new Date("2026-07-15T02:00:00.000Z"));

    expect(getEffectiveNutritionGoalForDateMock).toHaveBeenCalledWith(101, "2026-07-14", expect.any(String));
    expect(dbMocks.getUserDayMealTotals).toHaveBeenCalledWith(101, "2026-07-14", "America/Los_Angeles");
  });

  it("omite o bloco de meta quando a resolução histórica falha", async () => {
    getEffectiveNutritionGoalForDateMock.mockRejectedValue(new Error("history unavailable"));

    const result = await getWhatsAppMealGoalProgress(101, new Date("2026-07-15T15:00:00-03:00"));

    expect(result).toBeNull();
    expect(dbMocks.logInferenceEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.goal_history_unavailable",
    }));
  });
});
