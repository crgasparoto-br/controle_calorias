import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardOverviewMock = vi.fn();
const goalGetMock = vi.fn();
const weeklyMock = vi.fn();
const whatsappStatusMock = vi.fn();
const useUtilsMock = vi.fn(() => ({
  nutrition: {
    dashboard: { overview: { invalidate: vi.fn() } },
    meals: { list: { invalidate: vi.fn() } },
    reports: { weekly: { invalidate: vi.fn() } },
    goals: { get: { invalidate: vi.fn() } },
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => React.createElement("a", null, children),
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    nutrition: {
      dashboard: {
        overview: {
          useQuery: dashboardOverviewMock,
        },
      },
      goals: {
        get: {
          useQuery: goalGetMock,
        },
        update: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      meals: {
        processDraft: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        confirm: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        list: {
          useQuery: () => ({ data: overviewData.meals }),
        },
      },
      reports: {
        weekly: {
          useQuery: weeklyMock,
        },
      },
      whatsapp: {
        status: {
          useQuery: whatsappStatusMock,
        },
        simulateInbound: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      admin: {
        overview: {
          useQuery: () => ({ data: { usage: { usersCount: 0, mealsCount: 0, pendingInferences: 0, logsCount: 0 }, users: [], recentInferenceLogs: [] } }),
        },
      },
    },
  },
}));

const overviewData = {
  goal: {
    defaultGoal: {
      id: 10,
      userId: 1,
      ruleType: "default",
      weekday: -1,
      durationType: "always",
      calories: 2200,
      proteinGrams: 160,
      carbsGrams: 240,
      fatGrams: 70,
      effectiveFrom: new Date("2026-04-14T00:00:00.000Z"),
      effectiveUntil: null,
      createdAt: new Date("2026-04-14T00:00:00.000Z"),
      updatedAt: new Date("2026-04-14T00:00:00.000Z"),
    },
    exceptions: [
      {
        id: 11,
        userId: 1,
        ruleType: "exception",
        weekday: 4,
        durationType: "always",
        calories: 2400,
        proteinGrams: 170,
        carbsGrams: 270,
        fatGrams: 74,
        effectiveFrom: new Date("2026-04-14T00:00:00.000Z"),
        effectiveUntil: null,
        createdAt: new Date("2026-04-14T00:00:00.000Z"),
        updatedAt: new Date("2026-04-14T00:00:00.000Z"),
        label: "Sexta-feira",
        shortLabel: "sex.",
        isActive: true,
      },
    ],
    days: [
      { weekday: 0, label: "Segunda-feira", shortLabel: "seg.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
      { weekday: 1, label: "Terça-feira", shortLabel: "ter.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
      { weekday: 2, label: "Quarta-feira", shortLabel: "qua.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
      { weekday: 3, label: "Quinta-feira", shortLabel: "qui.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
      { weekday: 4, label: "Sexta-feira", shortLabel: "sex.", calories: 2400, proteinGrams: 170, carbsGrams: 270, fatGrams: 74, source: "exception", exceptionId: 11 },
      { weekday: 5, label: "Sábado", shortLabel: "sáb.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
      { weekday: 6, label: "Domingo", shortLabel: "dom.", calories: 2200, proteinGrams: 160, carbsGrams: 240, fatGrams: 70, source: "default" },
    ],
    today: { weekday: 4, label: "Sexta-feira", shortLabel: "sex.", calories: 2400, proteinGrams: 170, carbsGrams: 270, fatGrams: 74, source: "exception", exceptionId: 11 },
    weeklyTotals: { calories: 15600, proteinGrams: 1130, carbsGrams: 1710, fatGrams: 494 },
  },
  today: {
    goal: { label: "Segunda-feira", calories: 2200, protein: 160, carbs: 240, fat: 70 },
    consumed: { calories: 1240, protein: 92, carbs: 134, fat: 38 },
    remaining: { calories: 960, protein: 68, carbs: 106, fat: 32 },
    adherence: 56,
  },
  week: {
    planned: { calories: 15700, protein: 1125, carbs: 1720, fat: 489 },
    consumed: { calories: 4000, protein: 290, carbs: 425, fat: 118 },
    remaining: { calories: 11700, protein: 835, carbs: 1295, fat: 371 },
    adherence: 25,
  },
  weekly: [
    { date: "2026-04-14", label: "seg.", calories: 2100, protein: 150, carbs: 220, fat: 60, goalCalories: 2200 },
    { date: "2026-04-15", label: "ter.", calories: 1900, protein: 140, carbs: 205, fat: 58, goalCalories: 2200 },
  ],
  meals: [
    {
      id: 1,
      mealLabel: "Almoço",
      occurredAt: Date.now(),
      source: "web",
      items: [{ foodName: "Frango grelhado", portionText: "150 g", calories: 420, protein: 38, carbs: 30, fat: 12 }],
      totals: { calories: 420, protein: 38, carbs: 30, fat: 12 },
    },
  ],
  habits: [{ foodName: "Café com leite", typicalTimeLabel: "Café da manhã", notes: "Sem açúcar", occurrenceCount: 4 }],
};

beforeEach(() => {
  dashboardOverviewMock.mockReturnValue({ data: overviewData });
  goalGetMock.mockReturnValue({ data: overviewData.goal });
  weeklyMock.mockReturnValue({ data: overviewData.weekly });
  whatsappStatusMock.mockReturnValue({ data: { configured: false, webhookPath: "/api/whatsapp/webhook" } });
});

describe("nutrition pages", () => {
  it("renderiza o dashboard com visão diária", async () => {
    const { default: Home } = await import("./Home");
    const html = renderToString(React.createElement(Home));

    expect(html).toContain("Acompanhe calorias, macronutrientes e hábitos alimentares em um só painel");
    expect(html).toContain("Resumo de hoje");
    expect(html).toContain("1240");
  });

  it("renderiza a página de metas com meta geral, exceções por dia e soma semanal", async () => {
    const { default: GoalsPage } = await import("./GoalsPage");
    const html = renderToString(React.createElement(GoalsPage));

    expect(html).toContain("Meta geral da semana");
    expect(html).toContain("Exceções por dia da semana");
    expect(html).toContain("Segunda-feira");
    expect(html).toContain("Sexta-feira");
    expect(html).toContain("Soma planejada da semana");
    expect(html).toContain("Calorias semanais");
    expect(html).toContain("15600 kcal");
  });

  it("renderiza a página de registro multimodal", async () => {
    const { default: LogMealPage } = await import("./LogMealPage");
    const html = renderToString(React.createElement(LogMealPage));

    expect(html).toContain("Registrar refeição com IA multimodal");
    expect(html).toContain("Imagem do prato ou rótulo");
    expect(html).toContain("Fluxo de confirmação");
  });

  it("renderiza a página de relatórios com detalhamento por refeição e itens nutricionais", async () => {
    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Alimentos registrados por refeição");
    expect(html).toContain("Almoço");
    expect(html).toContain("Frango grelhado");
    expect(html).toContain("Porção:");
    expect(html).toContain("150 g");
    expect(html).toContain("Proteínas");
    expect(html).toContain("Carboidratos");
    expect(html).toContain("Gorduras");
    expect(html).toContain("Calorias");
    expect(html).toContain("Registro às");
  });

  it("renderiza a página de canais com status do WhatsApp", async () => {
    const { default: ChannelsPage } = await import("./ChannelsPage");
    const html = renderToString(React.createElement(ChannelsPage));

    expect(html).toContain("WhatsApp Business Cloud API");
    expect(html).toContain("Simulação de mensagem inbound");
    expect(html).toContain("/api/whatsapp/webhook");
  });
});
