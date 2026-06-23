import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const reportWeightEntries = vi.hoisted(() => ({
  current: [] as Array<{ id: number; date: string; label?: string; weightKg: number; notes?: string | null }>,
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("@/components/PageIntro", () => ({
  default: ({ title, description, stats, actions }: { title: string; description?: string; stats?: React.ReactNode; actions?: React.ReactNode }) => React.createElement("header", null, title, description, stats, actions),
}));

vi.mock("@/components/PeriodScopeSelector", () => ({
  PeriodScopeSelector: () => React.createElement("div", null, "Semana de referência"),
}));

vi.mock("@/features/meals/components", () => ({
  RegisteredMealGroups: ({ groups }: { groups: Array<{ mealLabel: string }> }) => React.createElement("div", null, groups.map(group => group.mealLabel).join(", ")),
  SummaryPill: ({ label, value }: { label: string; value: string }) => React.createElement("span", null, label, value),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children: React.ReactNode; href?: string }) => React.createElement("a", { href }, children),
}));

vi.mock("recharts", () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) => React.createElement("div", null, children);
  return {
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    Bar: passthrough,
    CartesianGrid: passthrough,
    Cell: passthrough,
    Legend: passthrough,
    Line: passthrough,
    LineChart: ({ children }: { children?: React.ReactNode }) => React.createElement("div", { "data-chart": "weight-line" }, children),
    Tooltip: passthrough,
    XAxis: passthrough,
    YAxis: passthrough,
  };
});

const weeklyDays = [
  {
    date: "2026-06-15",
    label: "seg.",
    calories: 1800,
    protein: 120,
    carbs: 180,
    fat: 50,
    exerciseCalories: 0,
    waterConsumedMl: 1200,
    waterGoalMl: 2500,
    quality: {},
    goalCalories: 2200,
    adjustedGoalCalories: 2200,
    goalProtein: 150,
    goalCarbs: 220,
    goalFat: 70,
  },
  {
    date: "2026-06-16",
    label: "ter.",
    calories: 2100,
    protein: 140,
    carbs: 200,
    fat: 60,
    exerciseCalories: 300,
    waterConsumedMl: 1800,
    waterGoalMl: 2500,
    quality: {},
    goalCalories: 2200,
    adjustedGoalCalories: 2500,
    goalProtein: 150,
    goalCarbs: 220,
    goalFat: 70,
  },
];

const breakfastMeal = {
  id: 1,
  mealLabel: "Café da manhã",
  occurredAt: new Date("2026-06-15T10:00:00.000Z").getTime(),
  notes: null,
  items: [
    {
      foodName: "Banana",
      portionText: "1 unidade",
      estimatedGrams: 100,
      calories: 90,
      protein: 1,
      carbs: 23,
      fat: 0,
    },
  ],
  totals: { calories: 90, protein: 1, carbs: 23, fat: 0 },
};

function weightSummary() {
  const entries = reportWeightEntries.current;
  const first = entries[0];
  const last = entries[entries.length - 1];

  return {
    entries,
    firstWeightKg: first?.weightKg ?? null,
    lastWeightKg: last?.weightKg ?? null,
    deltaKg: first && last ? last.weightKg - first.weightKg : null,
    hasData: entries.length > 0,
  };
}

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      professionals: {
        patientPeriodBundle: {
          useQuery: () => ({ data: null, isLoading: false, isError: false }),
        },
      },
      reports: {
        bundle: {
          useQuery: () => ({
            data: {
              weekly: weeklyDays,
              progress: {
                days: weeklyDays,
                summary: {
                  averageCalories: 1950,
                  totalCalories: 3900,
                  totalGoalCalories: 4700,
                  calorieDelta: -800,
                  daysWithinGoal: 1,
                  daysAboveGoal: 0,
                  daysBelowGoal: 1,
                  daysWithoutRecords: 5,
                  averageProtein: 130,
                  totalExerciseCalories: 300,
                  totalNetCalories: 3600,
                  balanceCalories: 1100,
                  message: "Resumo semanal.",
                },
                weight: weightSummary(),
              },
              insights: { generatedAt: "2026-06-16T12:00:00Z", weekStart: "2026-06-15", weekEnd: "2026-06-21", insights: [] },
              mealsByDate: [{ date: "2026-06-15", items: [breakfastMeal] }],
              quality: {
                proteinGrams: 260,
                fiberGrams: 0,
                waterMl: 3000,
                fruitServings: 0,
                vegetableServings: 0,
                ultraProcessedServings: 0,
                regularityScore: 0,
                foodQuality: { hasData: false, dayCount: 7, daysWithRecords: 0, fruitDays: 0, vegetableDays: 0, totalCalories: 0, classifiedCalories: 0, unclassifiedCalories: 0, ultraProcessedCalories: 0, naturalOrMinimallyProcessedCalories: 0, ultraProcessedCaloriesPercent: 0, naturalOrMinimallyProcessedCaloriesPercent: 0, unclassifiedCaloriesPercent: 0, qualityIndex: null, distribution: [] },
              },
            },
            isLoading: false,
            isError: false,
          }),
        },
        periodBundle: {
          useQuery: () => ({ data: null, isLoading: false, isError: false }),
        },
      },
    },
  },
}));

describe("ReportsPage weight trend", () => {
  beforeEach(() => {
    reportWeightEntries.current = [];
  });

  it("mantém a seção visível sem registros de peso", async () => {
    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Peso como apoio à leitura");
    expect(html).toContain("Ainda não há registros de peso no período selecionado.");
  });

  it("resume o peso quando existe apenas um registro", async () => {
    reportWeightEntries.current = [{ id: 1, date: "2026-06-15", label: "15 jun.", weightKg: 82, notes: null }];

    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Inicial");
    expect(html).toContain("Atual");
    expect(html).toContain("Variação");
    expect(html).toContain("Aderência calórica");
  });

  it("resume a variação quando há múltiplos registros de peso", async () => {
    reportWeightEntries.current = [
      { id: 1, date: "2026-06-15", label: "15 jun.", weightKg: 82, notes: null },
      { id: 2, date: "2026-06-16", label: "16 jun.", weightKg: 81.5, notes: null },
    ];

    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Inicial");
    expect(html).toContain("Atual");
    expect(html).toContain("Variação");
    expect(html).not.toContain("Ainda não há registros de peso no período selecionado.");
  });

  it("lista refeições no detalhamento de dias", async () => {
    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Detalhamento de dias e refeições");
    expect(html).toMatch(/1(?:<!-- -->)? refeições no dia/);
    expect(html).toMatch(/café da manhã/i);
  });
});
