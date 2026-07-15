import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getUserDayMealTotals: vi.fn(),
  getUserNutritionGoal: vi.fn(),
  listUserExercisesByDate: vi.fn(),
  logInferenceEvent: vi.fn(),
}));
const getNutritionGoalForDateMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => dbMocks);
vi.mock("../goals/service", () => ({ getNutritionGoalForDate: getNutritionGoalForDateMock }));

import { getWhatsAppMealGoalProgress } from "./goalProgressService";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("goalProgressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://test";
    dbMocks.getUserDayMealTotals.mockResolvedValue({
      totals: { calories: 1850, protein: 110, carbs: 130, fat: 55 },
    });
    dbMocks.getUserNutritionGoal.mockResolvedValue({
      today: {
        calories: 2000,
        proteinGrams: 120,
        carbsGrams: 150,
        fatGrams: 50,
        includeExerciseCalories: true,
      },
    });
    dbMocks.listUserExercisesByDate.mockImplementation(async (userId: number) => [
      { caloriesBurned: userId === 101 ? 300 : 80 },
    ]);
    getNutritionGoalForDateMock.mockImplementation(async (_userId: number, dateKey: string) => ({
      today: {
        calories: dateKey === "2026-07-14" ? 1900 : 2000,
        proteinGrams: 120,
        carbsGrams: 150,
        fatGrams: 50,
        includeExerciseCalories: true,
      },
    }));
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
    expect(dbMocks.listUserExercisesByDate).toHaveBeenNthCalledWith(1, 101, "2026-07-15");
    expect(dbMocks.listUserExercisesByDate).toHaveBeenNthCalledWith(2, 202, "2026-07-15");
  });

  it("usa a versão histórica da meta aplicável à data da refeição", async () => {
    const result = await getWhatsAppMealGoalProgress(101, new Date("2026-07-14T15:00:00-03:00"));

    expect(getNutritionGoalForDateMock).toHaveBeenCalledWith(101, "2026-07-14");
    expect(result).toMatchObject({
      goalCalories: 2200,
      consumedCalories: 1850,
      consumedProteinGrams: 110,
      targetProteinGrams: 120,
    });
  });
});
