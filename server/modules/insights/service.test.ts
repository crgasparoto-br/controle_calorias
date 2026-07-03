import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodProcessingLevel } from "../../../shared/reportsGoalAnalytics";

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getFoodsByIds: vi.fn(),
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

import { getPeriodReportBundle, getWeeklyReport, getWeeklyReportBundle } from "./service";

type MealItemOverrides = Partial<{
  foodCatalogId: number | null;
  foodName: string;
  canonicalName: string;
  portionText: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  estimatedGrams: number;
  servings: number;
}>;

type FoodSearchOverrides = Partial<{
  id: number;
  name: string;
  processingLevel: FoodProcessingLevel;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
}>;

function mealItem(overrides: MealItemOverrides = {}) {
  return {
    foodCatalogId: null,
    foodName: "Item do período",
    canonicalName: "Item do período",
    portionText: "1 porção",
    quantity: 1,
    unit: "porção",
    servings: 1,
    estimatedGrams: 30,
    calories: 100,
    protein: 2,
    carbs: 12,
    fat: 4,
    confidence: 0.9,
    source: "catalog" as const,
    ...overrides,
  };
}

function meal(items: ReturnType<typeof mealItem>[], occurredAt = new Date("2026-06-01T12:00:00.000Z").getTime()) {
  return {
    id: 1,
    userId: 77,
    source: "web",
    mealLabel: "lanche",
    status: "confirmed",
    occurredAt,
    sourceText: "",
    confidence: 0.9,
    items,
    media: [],
    createdAt: Date.now(),
    totals: items.reduce((totals, item) => ({
      calories: totals.calories + item.calories,
      protein: totals.protein + item.protein,
      carbs: totals.carbs + item.carbs,
      fat: totals.fat + item.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }),
  };
}

function foodSearchItem(overrides: FoodSearchOverrides = {}) {
  return {
    id: 501,
    name: "Produto catalogado",
    brandName: null,
    servingSize: 30,
    servingUnit: "g",
    calories: 120,
    protein: 3,
    carbs: 14,
    fat: 5,
    fiber: 1,
    processingLevel: "ultra_processed" as FoodProcessingLevel,
    isFruit: false,
    isVegetable: false,
    isUltraProcessed: false,
    source: "test",
    foodType: "generic" as const,
    isUserCreated: false,
    createdByUserId: null,
    isFavorite: false,
    lastUsedAt: null,
    ...overrides,
  };
}

function configureCommonMocks() {
  dbMocks.getDb.mockResolvedValue(null);
  dbMocks.getUserWaterGoal.mockResolvedValue({ dailyTargetMl: 2000 });
  dbMocks.getWeeklyProgress.mockResolvedValue({ weight: { entries: [] } });
  dbMocks.getHabitSnapshots.mockResolvedValue([]);
  dbMocks.getUserGamification.mockResolvedValue({});
  dbMocks.listUserExercises.mockResolvedValue([]);
  dbMocks.listUserExercisesByDate.mockResolvedValue([]);
  dbMocks.listUserMeals.mockResolvedValue([]);
  dbMocks.listUserMealsByDate.mockResolvedValue([]);
  dbMocks.listUserWaterLogs.mockResolvedValue([]);
  dbMocks.listUserWaterLogsByDate.mockResolvedValue([]);
  dbMocks.getFoodsByIds.mockResolvedValue([]);
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

describe("insights food quality report integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureCommonMocks();
  });

  it("usa lookup direcionado do período para classificar por foodCatalogId e manter diagnóstico", async () => {
    dbMocks.listUserMeals.mockResolvedValue([
      meal([
        mealItem({
          foodCatalogId: 501,
          foodName: "texto sem alias",
          canonicalName: "Alimento fora dos primeiros resultados",
          portionText: "porção divergente",
          calories: 120,
        }),
        mealItem({
          foodName: "Item externo sem cadastro",
          canonicalName: "Preparacao xpto isolada",
          portionText: "1 pacote indefinido",
          calories: 100,
        }),
      ]),
    ]);
    dbMocks.searchFoods.mockImplementation(async (_userId: number, query: string) => {
      if (query === "Alimento fora dos primeiros resultados") {
        return [foodSearchItem()];
      }
      return [];
    });

    const report = await getPeriodReportBundle(77, {
      startDate: "2026-06-01",
      endDate: "2026-06-02",
    });

    expect(dbMocks.listUserMealsByDate).not.toHaveBeenCalled();
    expect(dbMocks.searchFoods).toHaveBeenCalledWith(77, "Alimento fora dos primeiros resultados", expect.any(Number));
    expect(dbMocks.searchFoods).toHaveBeenCalledWith(77, "texto sem alias", expect.any(Number));
    expect(dbMocks.searchFoods).not.toHaveBeenCalledWith(77, "", expect.any(Number));
    expect(report.quality.foodQuality).toMatchObject({
      totalCalories: 220,
      classifiedCalories: 120,
      ultraProcessedCalories: 120,
      unclassifiedCalories: 100,
    });
    expect(report.quality.foodQuality.unclassifiedItems).toEqual([
      expect.objectContaining({
        key: "preparacao xpto isolada",
        totalCalories: 100,
        occurrences: 1,
        reason: "missing_catalog_id",
      }),
    ]);
  });

  it("não executa busca de alimentos quando o período não possui refeições", async () => {
    dbMocks.listUserMeals.mockResolvedValue([]);
    dbMocks.searchFoods.mockResolvedValue([]);

    const report = await getPeriodReportBundle(77, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    expect(dbMocks.searchFoods).not.toHaveBeenCalled();
    expect(report.quality.foodQuality.hasData).toBe(false);
    expect(report.quality.foodQuality.unclassifiedItems).toEqual([]);
  });

  it("não executa lookup detalhado de alimentos no resumo semanal leve", async () => {
    dbMocks.listUserMeals.mockResolvedValue([
      meal([
        mealItem({
          foodCatalogId: 501,
          foodName: "Produto catalogado",
          canonicalName: "Produto catalogado",
          calories: 120,
          protein: 5,
        }),
      ], Date.now()),
    ]);
    dbMocks.searchFoods.mockResolvedValue([foodSearchItem()]);

    const { weekly } = await getWeeklyReport(77);
    const dayWithMeal = weekly.find(day => day.calories > 0);

    expect(dbMocks.searchFoods).not.toHaveBeenCalled();
    expect(weekly).toHaveLength(7);
    expect(dayWithMeal?.quality).toMatchObject({
      proteinGrams: 5,
      fiberGrams: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 1,
    });
    expect(dayWithMeal?.quality.foodQualityItems).toEqual([]);
  });

  it("mantém lookup detalhado de alimentos no bundle semanal completo", async () => {
    dbMocks.listUserMeals.mockResolvedValue([
      meal([
        mealItem({
          foodCatalogId: 501,
          foodName: "Produto catalogado",
          canonicalName: "Produto catalogado",
          calories: 120,
          protein: 5,
        }),
      ], Date.now()),
    ]);
    dbMocks.searchFoods.mockImplementation(async (_userId: number, query: string) => {
      if (query === "Produto catalogado") {
        return [foodSearchItem({ name: "Produto catalogado" })];
      }
      return [];
    });

    const bundle = await getWeeklyReportBundle(77);

    expect(dbMocks.searchFoods).toHaveBeenCalledWith(77, "Produto catalogado", expect.any(Number));
    expect(bundle.quality.foodQuality).toMatchObject({
      classifiedCalories: 120,
      ultraProcessedCalories: 120,
      unclassifiedCalories: 0,
    });
  });
});
