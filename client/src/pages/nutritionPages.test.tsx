import React from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dashboardOverviewMock = vi.fn();
const goalGetMock = vi.fn();
const reportsBundleMock = vi.fn();
const whatsappStatusMock = vi.fn();
const adminOverviewMock = vi.fn();
const adminWhatsappTokenStatusMock = vi.fn();
const mealSchedulesMock = [
  { mealLabel: "café da manhã", startTime: "05:00", endTime: "10:59", enabled: true },
  { mealLabel: "almoço", startTime: "11:00", endTime: "14:59", enabled: true },
  { mealLabel: "lanche", startTime: "15:00", endTime: "17:59", enabled: true },
  { mealLabel: "jantar", startTime: "18:00", endTime: "22:59", enabled: true },
  { mealLabel: "outro", startTime: "23:00", endTime: "04:59", enabled: true },
];
const useUtilsMock = vi.fn(() => ({
  auth: {
    me: {
      setData: vi.fn(),
      invalidate: vi.fn(),
    },
  },
  nutrition: {
    onboarding: { profile: { invalidate: vi.fn() } },
    mealSchedules: { list: { invalidate: vi.fn() } },
    dashboard: { overview: { invalidate: vi.fn() } },
    meals: { list: { invalidate: vi.fn() }, dayTotals: { invalidate: vi.fn() }, favorites: { invalidate: vi.fn() } },
    reports: { weekly: { invalidate: vi.fn() }, bundle: { invalidate: vi.fn() } },
    goals: { get: { invalidate: vi.fn() } },
    gamification: { get: { invalidate: vi.fn() } },
    exercises: { list: { invalidate: vi.fn() } },
    water: { list: { invalidate: vi.fn() }, goal: { invalidate: vi.fn() } },
    whatsapp: { status: { invalidate: vi.fn() } },
    professionals: {
      profile: { invalidate: vi.fn() },
      myAccesses: { invalidate: vi.fn() },
      patientRequests: { invalidate: vi.fn() },
      history: { invalidate: vi.fn() },
      patientDashboard: { invalidate: vi.fn() },
    },
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
    auth: {
      me: {
        useQuery: () => ({ data: null, isLoading: false, error: null, refetch: vi.fn() }),
      },
      logout: {
        useMutation: () => ({ isPending: false, error: null, mutateAsync: vi.fn() }),
      },
    },
    nutrition: {
      assistant: {
        suggest: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      onboarding: {
        profile: {
          useQuery: () => ({ data: null, isLoading: false, error: null }),
        },
        complete: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
      },
      mealSchedules: {
        list: {
          useQuery: () => ({ data: mealSchedulesMock, isLoading: false, error: null }),
        },
        update: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        suggest: {
          useQuery: () => ({ data: { mealLabel: "almoço", matchedSchedule: mealSchedulesMock[1], confidence: 1 } }),
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
      foodPhotoAnalysis: {
        analyze: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        confirm: {
          useMutation: () => ({ isPending: false, mutate: vi.fn() }),
        },
        reject: {
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
        bundle: {
          useQuery: reportsBundleMock,
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
      professionals: {
        profile: { useQuery: () => ({ data: null }) },
        upsertProfile: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        requestAccess: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        myAccesses: { useQuery: () => ({ data: [] }) },
        patientRequests: { useQuery: () => ({ data: [] }) },
        approveAccess: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        revokeAccess: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        patientDashboard: { useQuery: () => ({ data: null }) },
        addComment: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        suggestGoalAdjustment: { useMutation: () => ({ isPending: false, mutate: vi.fn() }) },
        history: { useQuery: () => ({ data: [] }) },
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
        id: 12,
        userId: 1,
        ruleType: "exception",
        weekday: 4,
        durationType: "2_weeks",
        calories: 2600,
        proteinGrams: 180,
        carbsGrams: 290,
        fatGrams: 78,
        effectiveFrom: new Date("2026-04-07T00:00:00.000Z"),
        effectiveUntil: new Date("2026-04-20T23:59:59.999Z"),
        createdAt: new Date("2026-04-07T00:00:00.000Z"),
        updatedAt: new Date("2026-04-07T00:00:00.000Z"),
        label: "Sexta-feira",
        shortLabel: "sex.",
        isActive: false,
      },
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
    { date: "2026-04-14", label: "seg.", calories: 2100, protein: 150, carbs: 220, fat: 60, exerciseCalories: 300, netCalories: 1800, waterConsumedMl: 900, waterGoalMl: 2500, quality: { proteinGrams: 150, fiberGrams: 22, waterMl: 900, fruitServings: 2, vegetableServings: 2, ultraProcessedServings: 0, mealCount: 2, regularityScore: 80 }, goalCalories: 2200, status: "within", calorieDelta: -100, netDelta: -400 },
    { date: "2026-04-15", label: "ter.", calories: 1900, protein: 140, carbs: 205, fat: 58, exerciseCalories: 220, netCalories: 1680, waterConsumedMl: 1300, waterGoalMl: 2500, quality: { proteinGrams: 140, fiberGrams: 18, waterMl: 1300, fruitServings: 1, vegetableServings: 2, ultraProcessedServings: 1, mealCount: 2, regularityScore: 75 }, goalCalories: 2200, status: "below", calorieDelta: -300, netDelta: -520 },
  ],
  meals: [
    {
      id: 1,
      mealLabel: "Almoço",
      occurredAt: Date.now(),
      source: "web",
      items: [{ foodName: "Frango grelhado", canonicalName: "Frango grelhado", portionText: "150 g", servings: 1, estimatedGrams: 150, calories: 420, protein: 38, carbs: 30, fat: 12, confidence: 1, source: "catalog" }],
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
  reportsBundleMock.mockReturnValue({
    data: {
      weekly: overviewData.weekly,
      progress: {
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
      insights: {
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
      mealsByDate: [
        {
          date: "2026-04-14",
          items: overviewData.meals,
        },
      ],
      quality: {
        proteinGrams: 290,
        fiberGrams: 40,
        waterMl: 2200,
        fruitServings: 3,
        vegetableServings: 4,
        ultraProcessedServings: 1,
        mealCount: 4,
        regularityScore: 78,
      },
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

    expect(html).toContain("Esta tela fica focada no presente: saldo do dia, macros, água, exercícios, refeições recentes e atalhos para agir rápido.");
    expect(html).toContain("Calorias consumidas");
    expect(html).toContain("Foco do dia");
    expect(html).toContain("Registrar refeição");
    expect(html).toContain("Água do dia");
    expect(html).toContain("Status do dia");
    expect(html).toContain("Meta 2.500 ml");
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
    expect((html.match(/Dia da exceção/g) ?? [])).toHaveLength(1);
    expect(html).toContain("Segunda-feira");
    expect(html).toContain("Sexta-feira");
    expect(html).toContain("Soma planejada da semana");
    expect(html).toContain("Calorias semanais");
    expect(html).toContain("value=\"2.200\"");
    expect(html).toContain("15.600 kcal");
  });

  it("renderiza as configurações com perfil e refeições habituais", async () => {
    const { default: OnboardingPage } = await import("./OnboardingPage");
    const html = renderToString(React.createElement(OnboardingPage));

    expect(html).toContain("Configurações");
    expect(html).toContain("Ajuste seu perfil sem se perder em blocos longos");
    expect(html).toContain("Nome");
    expect(html).toContain("Data de nascimento");
    expect(html).toContain("Idade calculada");
    expect(html).toContain("Peso atual");
    expect(html).toContain("Perfil");
    expect(html).toContain("Objetivos e rotina");
    expect(html).toContain("Refeições habituais");
    expect(html).toContain("Tudo salvo no mesmo fluxo");
    expect(html).toContain("Salvar configurações");
  });

  it("renderiza a página de registro multimodal", async () => {
    const { default: LogMealPage } = await import("./LogMealPage");
    const html = renderToString(React.createElement(LogMealPage));

    expect(html).not.toContain("Registre refeições, água, exercícios e peso no mesmo lugar");
    expect(html).not.toContain("Use um único ponto para registrar o dia e revisar tudo sem trocar de tela.");
    expect(html).toContain("Texto, foto e áudio no mesmo rascunho.");
    expect(html).toContain("Descrição em texto");
    expect(html).toContain("Record com IA");
    expect(html).toContain("Manual");
    expect(html).not.toContain("Hoje");
    expect(html).toContain("Água do dia");
    expect(html).toContain("Exercícios");
    expect(html).toContain("Peso atual");
  });

  it("renderiza a página de relatórios com resumo semanal, navegação entre semanas e equação energética do dia", async () => {
    const { default: ReportsPage } = await import("./ReportsPage");
    const html = renderToString(React.createElement(ReportsPage));

    expect(html).toContain("Evolução e aderência semanal");
    expect(html).toContain("A semana continua sendo a leitura mais completa de consistência, saldo energético e qualidade alimentar.");
    expect(html).toContain("Semana de referência");
    expect(html).toContain("Média semanal");
    expect(html).toContain("Dias da semana");
    expect(html).toContain("Evolução do peso");
    expect(html).toContain("Qualidade e insights");
    expect(html).toContain("Distribuição de macronutrientes");
    expect(html).toContain("Refeições detalhadas");
    expect(html).toContain("Total da semana");
    expect(html).toContain("Proteína média");
    expect(html).toContain("Calorias líquidas");
  });

  it("renderiza a página de canais com status do WhatsApp fixo e vínculo do contato", async () => {
    const { default: ChannelsPage } = await import("./ChannelsPage");
    const html = renderToString(React.createElement(ChannelsPage));

    expect(html).toContain("WhatsApp Business Cloud API");
    expect(html).toContain("Vínculo do contato");
    expect(html).toContain("Contato vinculado");
    expect(html).toContain("Checklist rápido");
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
