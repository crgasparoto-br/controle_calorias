import React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const reportQueryState = vi.hoisted(() => ({
  forcedScope: "week" as "week" | "range",
  weekly: { data: null as unknown, isLoading: false, isError: false },
  bundle: { data: null as unknown, isLoading: false, isError: false },
  periodBundle: { data: null as unknown, isLoading: false, isError: false },
  bundleCalls: [] as Array<{ input: unknown; options: { enabled?: boolean } }>,
  periodBundleCalls: [] as Array<{ input: unknown; options: { enabled?: boolean } }>,
}));

vi.mock("@/components/PageIntro", () => ({
  default: ({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) =>
    React.createElement("header", null, title, description, actions),
}));

vi.mock("@/components/PeriodScopeSelector", () => ({
  PeriodScopeSelector: ({ onScopeChange, onRangeStartChange, onRangeEndChange }: {
    onScopeChange: (scope: "range") => void;
    onRangeStartChange: (value: string) => void;
    onRangeEndChange: (value: string) => void;
  }) => {
    React.useEffect(() => {
      if (reportQueryState.forcedScope !== "range") return;
      onScopeChange("range");
      onRangeStartChange("2026-01-01");
      onRangeEndChange("2026-04-01");
    }, [onRangeEndChange, onRangeStartChange, onScopeChange]);

    return React.createElement("div", null, "Semana de referência");
  },
}));

vi.mock("@/features/meals/components", () => ({
  RegisteredMealGroups: ({ groups }: { groups: Array<{ mealLabel?: string }> }) =>
    React.createElement("div", null, groups.map(group => group.mealLabel).filter(Boolean).join(", ")),
}));

vi.mock("@/features/reports/ReportsMacroDistributionChart", () => ({
  default: () => React.createElement("div", null, "Distribuição de macros"),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    nutrition: {
      professionals: {
        patientPeriodBundle: {
          useQuery: () => ({ data: null, isLoading: false, isError: false }),
        },
      },
      reports: {
        weekly: {
          useQuery: () => reportQueryState.weekly,
        },
        bundle: {
          useQuery: (input: unknown, options: { enabled?: boolean }) => {
            reportQueryState.bundleCalls.push({ input, options });
            return reportQueryState.bundle;
          },
        },
        periodBundle: {
          useQuery: (input: unknown, options: { enabled?: boolean }) => {
            reportQueryState.periodBundleCalls.push({ input, options });
            return reportQueryState.periodBundle;
          },
        },
      },
    },
  },
}));

function weeklyDay(date: string, calories = 0) {
  return {
    date,
    label: date,
    calories,
    protein: calories > 0 ? 120 : 0,
    carbs: calories > 0 ? 180 : 0,
    fat: calories > 0 ? 50 : 0,
    goalCalories: 2200,
    adjustedGoalCalories: 2200,
    goalProtein: 150,
    goalCarbs: 220,
    goalFat: 70,
    waterConsumedMl: calories > 0 ? 1500 : 0,
    waterGoalMl: 2500,
    exerciseCalories: 0,
    quality: {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: calories > 0 ? 2 : 0,
      regularityScore: 0,
      foodQualityItems: [],
    },
  };
}

function week(calories = 0) {
  return Array.from({ length: 7 }, (_, index) => weeklyDay(`2026-06-${String(22 + index).padStart(2, "0")}`, calories));
}

function bundleData(days = week(1900)) {
  return {
    weekly: days,
    progress: {
      days,
      summary: {
        averageCalories: 1900,
        totalCalories: days.reduce((total, day) => total + day.calories, 0),
        totalGoalCalories: 15400,
        calorieDelta: 0,
        daysWithinGoal: 0,
        daysAboveGoal: 0,
        daysBelowGoal: 0,
        daysWithoutRecords: 0,
        averageProtein: 0,
        totalExerciseCalories: 0,
        totalNetCalories: 0,
        balanceCalories: 0,
        message: "Resumo semanal.",
      },
      weight: { entries: [], hasData: false, firstWeightKg: null, lastWeightKg: null, deltaKg: null },
    },
    insights: { generatedAt: "2026-06-22T12:00:00Z", weekStart: "2026-06-22", weekEnd: "2026-06-28", insights: [] },
    mealsByDate: [],
    quality: {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: 0,
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
      foodQuality: { hasData: false, dayCount: 7, daysWithRecords: 0, fruitDays: 0, vegetableDays: 0, totalCalories: 0, classifiedCalories: 0, unclassifiedCalories: 0, ultraProcessedCalories: 0, naturalOrMinimallyProcessedCalories: 0, ultraProcessedCaloriesPercent: 0, naturalOrMinimallyProcessedCaloriesPercent: 0, unclassifiedCaloriesPercent: 0, qualityIndex: null, distribution: [] },
    },
  };
}

function mockReportsRangeState(rangeStart: string, rangeEnd: string) {
  const setState = vi.fn();
  let stateIndex = 0;
  return vi.spyOn(React, "useState").mockImplementation(((initialState: unknown) => {
    const currentIndex = stateIndex;
    stateIndex += 1;
    const value = typeof initialState === "function" ? (initialState as () => unknown)() : initialState;
    if (currentIndex === 0) return ["range", setState];
    if (currentIndex === 3) return [rangeStart, setState];
    if (currentIndex === 4) return [rangeEnd, setState];
    return [value, setState];
  }) as typeof React.useState);
}

describe("ReportsExperience weekly summary fallback", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-22T12:00:00.000Z"));
    reportQueryState.forcedScope = "week";
    reportQueryState.weekly = { data: week(1800), isLoading: false, isError: false };
    reportQueryState.bundle = { data: bundleData(), isLoading: false, isError: false };
    reportQueryState.periodBundle = { data: null, isLoading: false, isError: false };
    reportQueryState.bundleCalls = [];
    reportQueryState.periodBundleCalls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("usa weekly válido sem carregar bundle completo na primeira renderização", async () => {
    const { default: ReportsExperience } = await import("./ReportsExperience");

    const html = renderToString(React.createElement(ReportsExperience));

    expect(reportQueryState.bundleCalls[0]?.options.enabled).toBe(false);
    expect(html).toContain("Carregar detalhamento");
  });

  it("trata semana zerada como estado vazio legítimo sem fallback", async () => {
    reportQueryState.weekly = { data: week(0), isLoading: false, isError: false };
    const { default: ReportsExperience } = await import("./ReportsExperience");

    renderToString(React.createElement(ReportsExperience));

    expect(reportQueryState.bundleCalls[0]?.options.enabled).toBe(false);
  });

  it("aciona bundle quando weekly não cumpre o contrato", async () => {
    reportQueryState.weekly = { data: { weekly: week(1800).slice(0, 6) }, isLoading: false, isError: false };
    const { default: ReportsExperience } = await import("./ReportsExperience");

    const html = renderToString(React.createElement(ReportsExperience));

    expect(reportQueryState.bundleCalls[0]?.options.enabled).toBe(true);
    expect(reportQueryState.bundleCalls[0]?.input).toMatchObject({ fallback: true });
    expect(html).toContain("Detalhamento de dias e refeições");
  });

  it("mostra erro controlado quando weekly e fallback falham", async () => {
    reportQueryState.weekly = { data: null, isLoading: false, isError: true };
    reportQueryState.bundle = { data: null, isLoading: false, isError: true };
    const { default: ReportsExperience } = await import("./ReportsExperience");

    const html = renderToString(React.createElement(ReportsExperience));

    expect(reportQueryState.bundleCalls[0]?.options.enabled).toBe(true);
    expect(html).toContain("Não foi possível carregar os relatórios agora. Tente novamente em instantes.");
  });

  it("exibe mensagem controlada e evita periodBundle para range acima de 90 dias", async () => {
    mockReportsRangeState("2026-01-01", "2026-04-01");
    const { default: ReportsExperience } = await import("./ReportsExperience");

    const html = renderToString(React.createElement(ReportsExperience));

    expect(html).toContain("Escolha um período de até 90 dias para carregar os relatórios.");
    expect(reportQueryState.periodBundleCalls.at(-1)?.options.enabled).toBe(false);
  });
});
