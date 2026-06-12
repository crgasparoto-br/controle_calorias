import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardOverviewMock = vi.fn();
const invalidateMock = vi.fn();

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => React.createElement("a", null, children),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({
      nutrition: {
        dashboard: { overview: { invalidate: invalidateMock }, today: { invalidate: invalidateMock } },
        meals: { list: { invalidate: invalidateMock }, dayTotals: { invalidate: invalidateMock } },
        reports: { weekly: { invalidate: invalidateMock } },
      },
    }),
    nutrition: {
      assistant: {
        suggest: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      dashboard: {
        today: {
          useQuery: dashboardOverviewMock,
        },
        overview: {
          useQuery: dashboardOverviewMock,
        },
      },
      meals: {
        createManual: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
    },
  },
}));

function buildOverview({
  consumedCalories,
  baseGoalCalories = 2200,
  adjustedGoalCalories,
  exerciseCalories = 0,
}: {
  consumedCalories: number;
  baseGoalCalories?: number;
  adjustedGoalCalories?: number;
  exerciseCalories?: number;
}) {
  const resolvedAdjustedGoalCalories = adjustedGoalCalories ?? baseGoalCalories;
  const remainingCalories = resolvedAdjustedGoalCalories - consumedCalories;

  return {
    goal: {
      today: { label: "Terça-feira", calories: baseGoalCalories, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
    },
    today: {
      goal: { label: "Terça-feira", calories: baseGoalCalories, adjustedCalories: resolvedAdjustedGoalCalories, protein: 160, carbs: 240, fat: 70 },
      consumed: { calories: consumedCalories, protein: 180, carbs: 260, fat: 80 },
      burned: { calories: exerciseCalories },
      water: { consumedMl: 1200, goalMl: 2500, remainingMl: 1300 },
      net: { calories: consumedCalories - exerciseCalories, remainingToGoal: baseGoalCalories - (consumedCalories - exerciseCalories) },
      remaining: { calories: remainingCalories, protein: -20, carbs: -20, fat: -10 },
      adherence: resolvedAdjustedGoalCalories ? Math.min((consumedCalories / resolvedAdjustedGoalCalories) * 100, 100) : 0,
    },
    week: {
      planned: { calories: 15400, protein: 1120, carbs: 1680, fat: 490 },
      consumed: { calories: consumedCalories, protein: 180, carbs: 260, fat: 80 },
      burned: { calories: exerciseCalories },
      water: { consumedMl: 1200, goalMl: 17500, remainingMl: 16300 },
      net: { calories: consumedCalories - exerciseCalories, remainingToGoal: 12950 },
      remaining: { calories: 12950, protein: 940, carbs: 1420, fat: 410 },
      adherence: 16,
    },
    weekly: [],
    meals: [
      {
        id: 1,
        mealLabel: "Almoço",
        occurredAt: Date.now(),
        source: "web",
        items: [],
        totals: { calories: consumedCalories, protein: 180, carbs: 260, fat: 80 },
      },
    ],
    exercises: [],
    water: { goal: { dailyTargetMl: 2500 }, logs: [] },
    gamification: { enabled: false, availableBadges: [], newlyEarnedBadges: [], earnedBadges: [] },
    habits: [],
  };
}

describe("Home adjusted calorie goal display", () => {
  beforeEach(() => {
    dashboardOverviewMock.mockReset();
  });

  it("mostra meta ajustada e saldo disponível quando há exercício e consumo abaixo da meta ajustada", async () => {
    dashboardOverviewMock.mockReturnValue({
      data: buildOverview({ consumedCalories: 2100, baseGoalCalories: 2200, adjustedGoalCalories: 2500, exerciseCalories: 300 }),
      isLoading: false,
      isError: false,
    });
    const { default: Home } = await import("./Home");

    const html = renderToString(React.createElement(Home));

    expect(html).toContain("Meta ajustada do dia");
    expect(html).toContain("Meta base 2.200 kcal + 300 kcal de exercícios");
    expect(html).toContain("Consumido");
    expect(html).toContain("Exercícios");
    expect(html).toContain("Disponível para consumir");
    expect(html).toContain("400 kcal");
    expect(html).toContain("84% da meta ajustada.");
    expect(html).not.toContain("Saldo líquido");
  });

  it("mostra excesso do dia quando o consumo passa da meta ajustada", async () => {
    dashboardOverviewMock.mockReturnValue({
      data: buildOverview({ consumedCalories: 2700, baseGoalCalories: 2200, adjustedGoalCalories: 2500, exerciseCalories: 300 }),
      isLoading: false,
      isError: false,
    });
    const { default: Home } = await import("./Home");

    const html = renderToString(React.createElement(Home));

    expect(html).toContain("Excesso do dia");
    expect(html).toContain("200 kcal");
    expect(html).toContain("Acima da meta ajustada do dia");
    expect(html).toContain("108% da meta ajustada.");
    expect(html).toContain("Meta 2.500 kcal · 200 kcal acima");
    expect(html).toContain("text-destructive");
    expect(html).not.toContain("-200 kcal");
  });

  it("usa a meta base como meta ajustada quando não há exercício registrado", async () => {
    dashboardOverviewMock.mockReturnValue({
      data: buildOverview({ consumedCalories: 1800, baseGoalCalories: 2200, exerciseCalories: 0 }),
      isLoading: false,
      isError: false,
    });
    const { default: Home } = await import("./Home");

    const html = renderToString(React.createElement(Home));

    expect(html).toContain("Meta ajustada do dia");
    expect(html).toContain("Meta do dia sem exercícios registrados");
    expect(html).toContain("Disponível para consumir");
    expect(html).toContain("400 kcal");
    expect(html).toContain("82% da meta ajustada.");
  });
});
