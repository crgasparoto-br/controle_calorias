import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const createWaterLogMock = vi.hoisted(() => vi.fn());
const getPeriodReportBundleMock = vi.hoisted(() => vi.fn());

vi.mock("../../meals/service", () => ({ listMeals: listMealsMock }));
vi.mock("../../water/service", () => ({ createWaterLog: createWaterLogMock }));
vi.mock("../../insights/service", () => ({ getPeriodReportBundle: getPeriodReportBundleMock }));

import { handlePeriodReportIntent } from "./waterAndReportHandlers";

const originalDatabaseUrl = process.env.DATABASE_URL;

describe("waterAndReportHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "mysql://test";
    listMealsMock.mockResolvedValue([]);
    getPeriodReportBundleMock.mockResolvedValue({
      mealsByDate: [
        { date: "2026-07-14", items: [{ id: 1 }] },
        { date: "2026-07-15", items: [{ id: 2 }] },
      ],
      daily: [
        {
          adjustedGoalCalories: 2300,
          exerciseCalories: 300,
          goalProtein: 120,
          goalCarbs: 150,
          goalFat: 50,
        },
        {
          adjustedGoalCalories: 2100,
          exerciseCalories: 100,
          goalProtein: 120,
          goalCarbs: 150,
          goalFat: 50,
        },
      ],
      totals: {
        calories: 4200,
        protein: 230,
        carbs: 300,
        fat: 90,
      },
    });
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  });

  it("consolida metas históricas, exercícios e macros do próprio período", async () => {
    const result = await handlePeriodReportIntent(42, {
      label: "14/07/2026 a 15/07/2026",
      start: new Date("2026-07-14T03:00:00.000Z"),
      end: new Date("2026-07-16T02:59:59.999Z"),
    }, "America/Sao_Paulo");

    expect(getPeriodReportBundleMock).toHaveBeenCalledWith(42, {
      startDate: "2026-07-14",
      endDate: "2026-07-15",
    }, "America/Sao_Paulo");
    expect(result.reply).toContain("*Resumo de 14/07/2026 a 15/07/2026*");
    expect(result.reply).toContain("Refeições registradas: 2");
    expect(result.reply).toContain("*Meta:* 4.400 kcal");
    expect(result.reply).toContain("*Exercícios:* 400 kcal");
    expect(result.reply).toContain("*Consumo:* 4.200 kcal");
    expect(result.reply).toContain("*Déficit:* 200 kcal (-5%)");
    expect(result.reply).toContain("• P 230 g (-10 g/-4%)");
    expect(result.reply).toContain("• C 300 g (0 g/0%)");
    expect(result.reply).toContain("• G 90 g (-10 g/-10%)");
  });
});
