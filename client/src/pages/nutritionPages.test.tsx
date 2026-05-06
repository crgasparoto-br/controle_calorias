import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardOverviewMock = vi.fn();
const goalGetMock = vi.fn();
const weeklyMock = vi.fn();
const weeklyProgressMock = vi.fn();
const weeklyInsightsMock = vi.fn();
const whatsappStatusMock = vi.fn();
const adminOverviewMock = vi.fn();
const adminWhatsappTokenStatusMock = vi.fn();
const useUtilsMock = vi.fn(() => ({
  nutrition: {
    dashboard: { overview: { invalidate: vi.fn() } },
    meals: { list: { invalidate: vi.fn() }, dayTotals: { invalidate: vi.fn() }, favorites: { invalidate: vi.fn() } },
    reports: { weekly: { invalidate: vi.fn() } },
    goals: { get: { invalidate: vi.fn() } },
    gamification: { get: { invalidate: vi.fn() } },
    exercises: { list: { invalidate: vi.fn() } },
    water: { list: { invalidate: vi.fn() }, goal: { invalidate: vi.fn() } },
    whatsapp: { status: { invalidate: vi.fn() } },
    admin: {
      overview: { invalidate: vi.fn() },
      whatsappTokenStatus: { invalidate: vi.fn() },
    },
  },
}));

vi.mock("@/components/DashboardLayout", () => ({
  default: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
}));

vi.mock("wouter", () => ({
  Link: ({ children }: { children: React.ReactNode }) => React.createElement("a", null, children),
  useLocation: () => ["/onboarding", vi.fn()],
}));

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: useUtilsMock,
    nutrition: {
      onboarding: {
        complete: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
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
      gamification: {
        get: {
          useQuery: () => ({ data: overviewData.gamification }),
        },
        updateSettings: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      foods: {
        search: {
          useQuery: () => ({ data: [] }),
        },
      },
      meals: {
        processDraft: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        confirm: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        createManual: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        update: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        remove: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        copy: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        saveFavorite: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        reuseFavorite: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        favorites: {
          useQuery: () => ({ data: [] }),
        },
        dayTotals: {
          useQuery: () => ({ data: { totals: overviewData.today.consumed, meals: overviewData.meals } }),
        },
        list: {
          useQuery: () => ({ data: overviewData.meals }),
        },
      },
      exercises: {
        create: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        update: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        remove: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        list: {
          useQuery: () => ({ data: overviewData.exercises }),
        },
      },
      water: {
        goal: {
          useQuery: () => ({ data: overviewData.water.goal }),
        },
        list: {
          useQuery: () => ({ data: overviewData.water.logs }),
        },
        create: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        updateGoal: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        remove: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      reports: {
        weekly: {
          useQuery: weeklyMock,
        },
        weeklyProgress: {
          useQuery: weeklyProgressMock,
        },
        weeklyInsights: {
          useQuery: weeklyInsightsMock,
        },
      },
      whatsapp: {
        status: {
          useQuery: whatsappStatusMock,
        },
        upsertConnection: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        simulateInbound: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      admin: {
        overview: {
          useQuery: adminOverviewMock,
        },
        whatsappTokenStatus: {
          useQuery: adminWhatsappTokenStatusMock,
        },
        updateWhatsappToken: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
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
    burned: { calories: 320 },
    water: { consumedMl: 1200, goalMl: 2500, remainingMl: 1300 },
    net: { calories: 920, remainingToGoal: 1280 },
    remaining: { calories: 960, protein: 68, carbs: 106, fat: 32 },
    adherence: 56,
  },
  week: {
    planned: { calories: 15700, protein: 1125, carbs: 1720, fat: 489 },
    consumed: { calories: 4000, protein: 290, carbs: 425, fat: 118 },
    burned: { calories: 870 },
    water: { consumedMl: 7600, goalMl: 17500, remainingMl: 9900 },
    net: { calories: 3130, remainingToGoal: 12570 },
    remaining: { calories: 11700, protein: 835, carbs: 1295, fat: 371 },
    adherence: 25,
  },
  weekly: [
    { date: "2026-04-14", label: "seg.", calories: 2100, protein: 150, carbs: 220, fat: 60, exerciseCalories: 300, netCalories: 1800, waterConsumedMl: 900, waterGoalMl: 2500, goalCalories: 2200, status: "within", calorieDelta: -100, netDelta: -400 },
    { date: "2026-04-15", label: "ter.", calories: 1900, protein: 140, carbs: 205, fat: 58, exerciseCalories: 220, netCalories: 1680, waterConsumedMl: 1300, waterGoalMl: 2500, goalCalories: 2200, status: "below", calorieDelta: -300, netDelta: -520 },
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
  water: {
    goal: { id: 7, userId: 1, dailyTargetMl: 2500, createdAt: Date.now(), updatedAt: new Date() },
    logs: [
      { id: 1, userId: 1, amountMl: 500, occurredAt: Date.now(), createdAt: Date.now(), updatedAt: new Date() },
    ],
  },
  exercises: [
    {
      id: 99,
      activityType: "Corrida",
      durationMinutes: 45,
      caloriesBurned: 320,
      occurredAt: Date.now(),
      notes: "Rodagem leve",
    },
  ],
  gamification: {
    enabled: true,
    availableBadges: [],
    newlyEarnedBadges: [],
    earnedBadges: [
      {
        id: 1,
        code: "registered_3_days_week",
        title: "3 dias registrados",
        description: "Registrou refeições em 3 dias da semana.",
        earnedAt: Date.now(),
        weekStart: "2026-04-14",
        metadata: { daysWithMeals: 3 },
      },
    ],
  },
};

beforeEach(() => {
  dashboardOverviewMock.mockReturnValue({ data: overviewData });
  goalGetMock.mockReturnValue({ data: overviewData.goal });
  weeklyMock.mockReturnValue({ data: overviewData.weekly });
  weeklyProgressMock.mockReturnValue({
    data: {
      days: overviewData.weekly,
      summary: {
        averageCalories: 2000,
        totalCalories: 4000,
        totalGoalCalories: 4400,
        calorieDelta: -400,
        daysWithinGoal: 1,
        daysAboveGoal: 0,
        daysBelowGoal: 1,
        daysWithoutRecords: 5,
        averageProtein: 145,
        totalExerciseCalories: 520,
        totalNetCalories: 3480,
        balanceCalories: 920,
        message: "A semana mostra boa consistência em torno das metas planejadas.",
      },
      weight: {
        entries: [{ id: 1, date: "2026-04-14", weightKg: 82, notes: "Peso informado no onboarding." }],
        firstWeightKg: 82,
        lastWeightKg: 82,
        deltaKg: 0,
        hasData: true,
      },
    },
  });
  weeklyInsightsMock.mockReturnValue({
    data: {
      generatedAt: "2026-04-22T15:00:00.000Z",
      weekStart: "2026-04-20",
      weekEnd: "2026-04-26",
      insights: [
        {
          title: "Aderência à meta calórica semanal",
          description: "A semana ficou em 95% da meta calórica planejada.",
          suggestion: "Mantenha registros consistentes para a média semanal continuar ajudando nas decisões.",
          severity: "positive",
          data: { adherencePercent: 95 },
        },
      ],
    },
  });
  whatsappStatusMock.mockReturnValue({ data: { configured: false, webhookPath: "/api/whatsapp/webhook", currentUserId: 1, connection: null } });
  adminOverviewMock.mockReturnValue({
    data: {
      usage: { usersCount: 0, mealsCount: 0, pendingInferences: 0, logsCount: 0 },
      users: [],
      whatsappToken: {
        configured: true,
        source: "database",
        maskedValue: "EAAcmt••••1234",
        updatedAt: Date.now(),
        updatedByUserId: 1,
      },
      recentInferenceLogs: [],
    },
  });
  adminWhatsappTokenStatusMock.mockReturnValue({
    data: {
      configured: true,
      source: "database",
      maskedValue: "EAAcmt••••1234",
      updatedAt: Date.now(),
      updatedByUserId: 1,
    },
  });
});

describe("nutrition pages", () => {
  it("renderiza o dashboard com visão diária", async () => {
    const { default: Home } = await import("./Home");
    const html = renderToString(React.createElement(Home));

    expect(html).toContain("Acompanhe calorias, macronutrientes, exercícios e saldo energético em um só painel");
    expect(html).toContain("Resumo de hoje");
    expect(html).toContain("Equação energética do dia");
    expect(html).toContain("Registrar exercício");
    expect(html).toContain("Água do dia");
    expect(html).toContain("Visão semanal combinada");
    expect(html).toContain("value=\"2.500\"");
    expect(html).toContain("200 ml");
    expect(html).toContain("1.200 ml");
    expect(html).toContain("920 kcal");
  });

  it("renderiza a página de metas com meta geral, exceções por dia e soma semanal", async () => {
    const { default: GoalsPage } = await import("./GoalsPage");
    const html = renderToString(React.createElement(GoalsPage));

    expect(html).toContain("Meta geral da semana");
    expect(html).toContain("Por gramas");
    expect(html).toContain("Por percentual");
    expect(html).toContain("percentual das calorias do dia");
    expect(html).toContain("Metas muito extremas são bloqueadas");
    expect(html).toContain("Exceções por dia da semana");
    expect(html).toContain("Segunda-feira");
    expect(html).toContain("Sexta-feira");
    expect(html).toContain("Soma planejada da semana");
    expect(html).toContain("Calorias semanais");
    expect(html).toContain("value=\"2.200\"");
    expect(html).toContain("15.600 kcal");
  });

  it("renderiza o onboarding com dados de personalização nutricional", async () => {
    const { default: OnboardingPage } = await import("./OnboardingPage");
    const html = renderToString(React.createElement(OnboardingPage));

    expect(html).toContain("Onboarding nutricional");
    expect(html).toContain("Nome");
    expect(html).toContain("Peso atual");
    expect(html).toContain("Objetivo");
    expect(html).toContain("Preferências alimentares");
    expect(html).toContain("Principal dificuldade");
    expect(html).toContain("Concluir onboarding");
  });

  it("renderiza a página de registro multimodal", async () => {
    const { default: LogMealPage } = await import("./LogMealPage");
    const html = renderToString(React.createElement(LogMealPage));

    expect(html).toContain("Registrar refeição com IA multimodal");
    expect(html).toContain("Imagem do prato ou rótulo");
    expect(html).toContain("Fluxo de confirmação");
    expect(html).toContain("Criar ou editar refeição manualmente");
    expect(html).toContain("Refeições registradas");
  });

  it("renderiza a página de relatórios com detalhamento por refeição e itens nutricionais", async () => {
    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Alimentos registrados por refeição");
    expect(html).toContain("Progresso nutricional da semana");
    expect(html).toContain("Média semanal");
    expect(html).toContain("Dias da semana");
    expect(html).toContain("Evolução de peso");
    expect(html).toContain("Insights alimentares da semana");
    expect(html).toContain("Aderência à meta calórica semanal");
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

  it("renderiza a página de canais com status do WhatsApp fixo e vínculo do contato", async () => {
    const { default: ChannelsPage } = await import("./ChannelsPage");
    const html = renderToString(React.createElement(ChannelsPage));

    expect(html).toContain("WhatsApp Business Cloud API");
    expect(html).toContain("Vínculo do contato do usuário");
    expect(html).toContain("Salvar contato");
    expect(html).toContain("Não vinculado");
    expect(html).toContain("Número oficial da solução");
    expect(html).toContain("Phone Number ID oficial");
    expect(html).toContain("/api/whatsapp/webhook");
  });

  it("renderiza a página administrativa com o campo editável do token do WhatsApp", async () => {
    const { default: AdminPage } = await import("./AdminPage");
    const html = renderToString(React.createElement(AdminPage));

    expect(html).toContain("Credenciais do WhatsApp");
    expect(html).toContain("Token de acesso do WhatsApp");
    expect(html).toContain("Salvar token");
    expect(html).toContain("Painel admin");
    expect(html).toContain("EAAcmt••••1234");
  });
});
