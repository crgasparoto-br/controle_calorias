import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getUserDayMealTotals: vi.fn(),
  listUserExercisesByDate: vi.fn(),
  logInferenceEvent: vi.fn(),
}));
const getNutritionGoalForDateMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => dbMocks);
vi.mock("../goals/service", () => ({ getNutritionGoalForDate: getNutritionGoalForDateMock }));

import { getWhatsAppEffectiveGoalForDate, getWhatsAppMealGoalProgress } from "./goalProgressService";

describe("goalProgressService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getUserDayMealTotals.mockResolvedValue({
      totals: { calories: 1850, protein: 110, carbs: 130, fat: 55 },
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

  it("isola as calorias de exercício por usuário mesmo na mesma data", async () => {
    const first = await getWhatsAppEffectiveGoalForDate(101, "2026-07-15");
    const second = await getWhatsAppEffectiveGoalForDate(202, "2026-07-15");

    expect(first).toMatchObject({ effectiveGoalCalories: 2300, exerciseCalories: 300 });
    expect(second).toMatchObject({ effectiveGoalCalories: 2080, exerciseCalories: 80 });
    expect(dbMocks.listUserExercisesByDate).toHaveBeenNthCalledWith(1, 101, "2026-07-15");
    expect(dbMocks.listUserExercisesByDate).toHaveBeenNthCalledWith(2, 202, "2026-07-15");
  });

  it("usa a versão histórica da meta aplicável à data da refeição", async () => {
    const result = await getWhatsAppMealGoalProgress(101, new Date("2026-07-14T15:00:00-03:00"));

    expect(getNutritionGoalForDateMock).toHaveBeenCalledWith(101, "2026-07-14");
    expect(result).toMatchObject({
      effectiveGoalCalories: 2200,
      exerciseCalories: 300,
      consumedCalories: 1850,
      consumedProteinGrams: 110,
      targetProteinGrams: 120,
    });
  });
});
