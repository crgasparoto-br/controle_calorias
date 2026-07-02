import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getHabitSnapshots: vi.fn(),
  getUserGamification: vi.fn(),
  getUserWaterGoal: vi.fn(),
  getWeeklyProgress: vi.fn(),
  listUserExercises: vi.fn(),
  listUserExercisesByDate: vi.fn(),
  listUserMeals: vi.fn(),
  listUserMealsByDate: vi.fn(),
  listUserWaterLogs: vi.fn(),
  listUserWaterLogsByDate: vi.fn(),
  searchFoods: vi.fn(),
}));

const goalMocks = vi.hoisted(() => ({
  getNutritionGoalForDate: vi.fn(),
}));

vi.mock("../../db", () => dbMocks);
vi.mock("../goals/service", () => goalMocks);
vi.mock("./weeklyInsightService", () => ({
  weeklyInsightService: {
    generate: vi.fn(() => []),
  },
}));

import { getWeeklyReport, getWeeklyReportBundle } from "./service";

function mealItem(overrides: Record<string, unknown> = {}) {
  return {
    foodCatalogId: null,
    foodName: "Arroz",
    canonicalName: "Arroz",
    portionText: "1 porção",
    quantity: 1,
    unit: "porção",
    servings: 1,
    estimatedGrams: 100,
    calories: 100,
    protein: 3,
    carbs: 20,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
    ...overrides,
  };
}

function meal() {
  return {
    id: 1,
    userId: 77,
    source: "web" as const,
    mealLabel: "almoço",
    status: "confirmed" as const,
    occurredAt: Date.now(),
    sourceText: "",
    confidence: 0.9,
    items: [mealItem()],
    media: [],
    createdAt: Date.now(),
  };
}

function configureCommonMocks() {
  dbMocks.getDb.mockResolvedValue(null);
  dbMocks.getUserWaterGoal.mockResolvedValue({ dailyTargetMl: 2000 });
  dbMocks.getWeeklyProgress.mockResolvedValue({ weight: { entries: [] } });
  dbMocks.listUserExercises.mockResolvedValue([]);
  dbMocks.listUserExercisesByDate.mockResolvedValue([]);
  dbMocks.listUserMeals.mockResolvedValue([]);
  dbMocks.listUserWaterLogs.mockResolvedValue([]);
  dbMocks.listUserWaterLogsByDate.mockResolvedValue([]);
  dbMocks.searchFoods.mockResolvedValue([]);
  goalMocks.getNutritionGoalForDate.mockResolvedValue({
    today: {
      calories: 2000,
      proteinGrams: 150,
      carbsGrams: 220,
      fatGrams: 65,
      label: "Meta padrão",
      shortLabel: "Meta",
    },
  });
}

describe("weekly report summary contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCommonMocks();
  });

  it("retorna 7 dias zerados quando a semana não possui registros", async () => {
    dbMocks.listUserMeals.mockResolvedValue([]);

    const report = await getWeeklyReport(77, 0);

    expect(report).toHaveLength(7);
    expect(dbMocks.listUserMeals).toHaveBeenCalledTimes(1);
    expect(dbMocks.listUserMealsByDate).not.toHaveBeenCalled();
    expect(report.every(day => day.date && day.calories === 0 && day.protein === 0)).toBe(true);
    expect(report.every(day => day.goalCalories === 2000 && day.adjustedGoalCalories === 2000)).toBe(true);
    expect(report.every(day => day.waterGoalMl === 2000 && day.exerciseCalories === 0)).toBe(true);
  });

  it("mantém equivalência básica de totais entre resumo semanal e bundle", async () => {
    dbMocks.listUserMeals.mockResolvedValue([meal()]);

    const [summary, bundle] = await Promise.all([
      getWeeklyReport(77, 0),
      getWeeklyReportBundle(77, 0),
    ]);

    const summaryCalories = summary.reduce((total, day) => total + day.calories, 0);
    const summaryProtein = summary.reduce((total, day) => total + day.protein, 0);
    const bundleCalories = bundle.weekly.reduce((total, day) => total + day.calories, 0);
    const bundleProtein = bundle.weekly.reduce((total, day) => total + day.protein, 0);

    expect(bundle.weekly).toHaveLength(7);
    expect(dbMocks.listUserMealsByDate).not.toHaveBeenCalled();
    expect(bundle.progress.summary.totalCalories).toBe(summaryCalories);
    expect(bundle.progress.summary.averageProtein).toBe(summaryProtein / 7);
    expect(bundleCalories).toBe(summaryCalories);
    expect(bundleProtein).toBe(summaryProtein);
  });
});
