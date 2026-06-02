import React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

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
        dashboard: { overview: { invalidate: invalidateMock } },
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

const overviewAboveGoal = {
  goal: {
    today: { label: "Terça-feira", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70 },
  },
  today: {
    goal: { label: "Terça-feira", calories: 2200, protein: 160, carbs: 240, fat: 70 },
    consumed: { calories: 2450, protein: 180, carbs: 260, fat: 80 },
    burned: { calories: 0 },
    water: { consumedMl: 1200, goalMl: 2500, remainingMl: 1300 },
    net: { calories: 2450, remainingToGoal: -250 },
    remaining: { calories: -250, protein: -20, carbs: -20, fat: -10 },
    adherence: 100,
  },
  week: {
    planned: { calories: 15400, protein: 1120, carbs: 1680, fat: 490 },
    consumed: { calories: 2450, protein: 180, carbs: 260, fat: 80 },
    burned: { calories: 0 },
    water: { consumedMl: 1200, goalMl: 17500, remainingMl: 16300 },
    net: { calories: 2450, remainingToGoal: 12950 },
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
      totals: { calories: 2450, protein: 180, carbs: 260, fat: 80 },
    },
  ],
  exercises: [],
  water: { goal: { dailyTargetMl: 2500 }, logs: [] },
  gamification: { enabled: false, availableBadges: [], newlyEarnedBadges: [], earnedBadges: [] },
  habits: [],
};

describe("Home goal overflow display", () => {
  it("mostra consumo real, percentual real e excedente quando o dia passa da meta", async () => {
    dashboardOverviewMock.mockReturnValue({ data: overviewAboveGoal, isLoading: false, isError: false });
    const { default: Home } = await import("./Home");

    const html = renderToString(React.createElement(Home));

    expect(html).toContain("2.450 kcal");
    expect(html).toContain("111% da meta de hoje.");
    expect(html).toContain("Meta 2.200 kcal");
    expect(html).toContain("250 kcal acima");
    expect(html).toContain("20 g acima");
  });
});
