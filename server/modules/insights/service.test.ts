import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodProcessingLevel } from "../../../shared/reportsGoalAnalytics";

const dbMocks = vi.hoisted(() => ({
<<<<<<< HEAD
  getDb: vi.fn(),
  getFoodsByIds: vi.fn(),
=======
>>>>>>> origin/main
  getHabitSnapshots: vi.fn(),
  getUserGamification: vi.fn(),
  getUserWaterGoal: vi.fn(),
  getWeeklyProgress: vi.fn(),
<<<<<<< HEAD
  listUserExercises: vi.fn(),
  listUserExercisesByDate: vi.fn(),
  listUserMeals: vi.fn(),
  listUserMealsByDate: vi.fn(),
  listUserWaterLogs: vi.fn(),
=======
  listUserExercisesByDate: vi.fn(),
  listUserMeals: vi.fn(),
  listUserMealsByDate: vi.fn(),
>>>>>>> origin/main
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

<<<<<<< HEAD
import { getPeriodReportBundle, getWeeklyReport, getWeeklyReportBundle } from "./service";
=======
import { getPeriodReportBundle } from "./service";
>>>>>>> origin/main

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

<<<<<<< HEAD
function meal(items: ReturnType<typeof mealItem>[], occurredAt = new Date("2026-06-01T12:00:00.000Z").getTime()) {
=======
function meal(items: ReturnType<typeof mealItem>[]) {
>>>>>>> origin/main
  return {
    id: 1,
    userId: 77,
    source: "web",
    mealLabel: "lanche",
    status: "confirmed",
<<<<<<< HEAD
    occurredAt,
=======
    occurredAt: new Date("2026-06-01T12:00:00.000Z").getTime(),
>>>>>>> origin/main
    sourceText: "",
    confidence: 0.9,
    items,
    media: [],
    createdAt: Date.now(),
<<<<<<< HEAD
    totals: items.reduce((totals, item) => ({
      calories: totals.calories + item.calories,
      protein: totals.protein + item.protein,
      carbs: totals.carbs + item.carbs,
      fat: totals.fat + item.fat,
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 }),
=======
>>>>>>> origin/main
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
<<<<<<< HEAD
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
=======
  dbMocks.getUserWaterGoal.mockResolvedValue({ dailyTargetMl: 2000 });
  dbMocks.getWeeklyProgress.mockResolvedValue({ weight: { entries: [] } });
  dbMocks.listUserExercisesByDate.mockResolvedValue([]);
  dbMocks.listUserWaterLogsByDate.mockResolvedValue([]);
>>>>>>> origin/main
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
<<<<<<< HEAD
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
=======
    dbMocks.listUserMealsByDate.mockImplementation(async (_userId: number, date: string) => {
      if (date !== "2026-06-01") return [];
      return [
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
      ];
    });
>>>>>>> origin/main
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

<<<<<<< HEAD
    expect(dbMocks.listUserMealsByDate).not.toHaveBeenCalled();
=======
>>>>>>> origin/main
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
<<<<<<< HEAD
    const ultraProcessedDistribution = report.quality.foodQuality.distribution.find(item => item.key === "ultraProcessed");
    expect(ultraProcessedDistribution?.items).toEqual([
      expect.objectContaining({
        key: "alimento fora dos primeiros resultados",
        foodName: "texto sem alias",
        canonicalName: "Alimento fora dos primeiros resultados",
        totalCalories: 120,
        occurrences: 1,
      }),
    ]);
  });

  it("não executa busca de alimentos quando o período não possui refeições", async () => {
    dbMocks.listUserMeals.mockResolvedValue([]);
=======
  });

  it("não executa busca de alimentos quando o período não possui refeições", async () => {
    dbMocks.listUserMealsByDate.mockResolvedValue([]);
>>>>>>> origin/main
    dbMocks.searchFoods.mockResolvedValue([]);

    const report = await getPeriodReportBundle(77, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    expect(dbMocks.searchFoods).not.toHaveBeenCalled();
    expect(report.quality.foodQuality.hasData).toBe(false);
    expect(report.quality.foodQuality.unclassifiedItems).toEqual([]);
  });
<<<<<<< HEAD

  it("executa lookup detalhado de alimentos e retorna qualidade agregada no resumo semanal", async () => {
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

    const { weekly, quality } = await getWeeklyReport(77);
    const dayWithMeal = weekly.find(day => day.calories > 0);

    expect(dbMocks.searchFoods).toHaveBeenCalled();
    expect(weekly).toHaveLength(7);
    expect(dayWithMeal?.quality).toMatchObject({
      proteinGrams: 5,
      fruitServings: 0,
      vegetableServings: 0,
      mealCount: 1,
    });
    expect(dayWithMeal?.quality.foodQualityItems.length).toBeGreaterThan(0);
    expect(quality.foodQuality.hasData).toBe(true);
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
=======
>>>>>>> origin/main
});
