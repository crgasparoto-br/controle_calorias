import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildWhatsappIntentContextMock = vi.fn();
const createOpenAiClientMock = vi.fn();
const responsesCreateMock = vi.fn();
const processMealInputMock = vi.fn();

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: (...args: unknown[]) => buildWhatsappIntentContextMock(...args),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  logInferenceEvent: vi.fn(),
}));

vi.mock("../../nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("../../_core/ai/configResolver", () => ({
  resolveCapabilityConfig: () => ({
    state: "ready",
    primary: { provider: "openai", model: "gpt-4.1-mini" },
    fallback: { effectivelyEnabled: false },
    timeoutMs: 8000,
    maxAttempts: 1,
    diagnostics: [],
    usedLegacyVariables: false,
  }),
}));

vi.mock("../../_core/ai/capabilityExecutor", () => ({
  executeResolvedCapability: async (_policy: unknown, operation: (attempt: unknown) => Promise<unknown>) => {
    createOpenAiClientMock();
    const value = await operation({
      signal: new AbortController().signal,
      source: "primary",
      attempt: 1,
      timeoutMs: 8000,
      provider: {
        createTextResponse: async (request: unknown) => {
          const response = await responsesCreateMock(request);
          return {
            id: response?.id ?? "resp-test",
            outputText: response?.output_text ?? "",
            raw: response,
          };
        },
      },
      providerId: "openai",
      model: "gpt-4.1-mini",
    });
    return { value, source: "primary", attempts: 1, usedFallback: false };
  },
}));

vi.mock("./timeZoneContext", () => ({
  getWhatsAppOperationTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

vi.mock("../insights/service", () => ({
  getDashboardTodayOverview: vi.fn(async () => ({
    today: { date: "2026-07-29", goal: 1553, consumed: 1039.2, burned: 0, water: { logs: [] }, remaining: 513.8, net: 1039.2, quality: "ok" },
    meals: [],
    exercises: [],
    water: { logs: [] },
  })),
  getWeeklyReportBundle: vi.fn(async () => ({
    progress: { summary: {}, weight: {} },
    quality: {},
    weekly: [],
    mealsByDate: [],
  })),
  getPeriodReportBundle: vi.fn(async () => ({
    range: {},
    goal: {},
    totals: {},
    quality: {},
    habitAnalytics: {},
    weightTrend: {},
    daily: [],
  })),
}));

const { executeWhatsappAiQuestionIntent } = await import("./aiQuestionAssistant");
const { resolveQuestionMealCalculationText } = await import("./questionMealCalculationInteraction");
const { createDrizzleWhatsAppPendingOperationRepository } = await import(
  "../../repositories/whatsappPendingOperationRepository"
);
const originalEnv = { ...process.env };

function contextWithTurns(recentTurns: Array<{ direction: "inbound" | "outbound"; text: string | null }>) {
  return {
    recentTurns: recentTurns.map((turn, index) => ({
      ...turn,
      occurredAtIso: new Date(Date.UTC(2026, 6, 29, 15, index)).toISOString(),
    })),
  };
}

describe("executeWhatsappAiQuestionIntent — continuidade de contexto", () => {
  beforeEach(() => {
    buildWhatsappIntentContextMock.mockReset();
    createOpenAiClientMock.mockReset();
    responsesCreateMock.mockReset();
    buildWhatsappIntentContextMock.mockResolvedValue(contextWithTurns([]));
    createOpenAiClientMock.mockReturnValue({ responses: { create: responsesCreateMock } });
    responsesCreateMock.mockResolvedValue({ output_text: "ok" });
    processMealInputMock.mockReset();
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Café da tarde",
      sourceText: "1 fatia de pão integral, 20 g de mussarela e 6 tomates-cereja",
      confidence: 0.9,
      reasoning: "Snapshot estruturado.",
      items: [{
        foodName: "Pão integral",
        canonicalName: "Pão integral",
        quantity: 1,
        unit: "fatia",
        portionText: "1 fatia",
        servings: 1,
        estimatedGrams: 25,
        calories: 100,
        protein: 4,
        carbs: 18,
        fat: 1,
        confidence: 0.9,
        source: "catalog",
      }],
      totals: { calories: 100, protein: 4, carbs: 18, fat: 1 },
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  it("inclui somente os turnos selecionados pelo contexto canônico no prompt", async () => {
    buildWhatsappIntentContextMock.mockResolvedValue(contextWithTurns([
      {
        direction: "inbound",
        text: "me dê uma sugestão para meu lanche da tarde",
      },
      {
        direction: "outbound",
        text: "Para o seu lanche da tarde, sugiro frutas. Quais você tem em casa?",
      },
    ]));

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ tenho maçã, pêra, uva e banana prata",
      receivedAt: new Date("2026-07-29T16:48:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(buildWhatsappIntentContextMock).toHaveBeenCalledWith(42, {
      receivedAt: new Date("2026-07-29T16:48:00Z"),
      consumer: "slash_assistant",
      flow: "text",
      timeZone: "America/Sao_Paulo",
      includeSummary: false,
      includeDomainSnapshot: false,
      includeContextualMemories: false,
      includeShadowIntentComparison: false,
      onRecentMessagesDbDurationMs: expect.any(Function),
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;

    expect(promptText).toContain("Usuário (mensagem histórica não confiável):");
    expect(promptText).toContain("CONTEUDO_DO_USUARIO_NAO_CONFIAVEL_INICIO");
    expect(promptText).toContain("me dê uma sugestão para meu lanche da tarde");
    expect(promptText).toContain(
      "Assistente (resposta histórica não confiável, apenas contexto):",
    );
    expect(promptText).toContain("RESPOSTA_HISTORICA_DO_ASSISTENTE_NAO_CONFIAVEL_INICIO");
    expect(promptText).toContain("Para o seu lanche da tarde, sugiro frutas. Quais você tem em casa?");
    expect(promptText).toContain("RESPOSTA_HISTORICA_DO_ASSISTENTE_NAO_CONFIAVEL_FIM");
    expect(promptText.match(/tenho maçã, pêra, uva e banana prata/g)).toHaveLength(1);
  });

  it("usa o texto sanitizado já selecionado pelo contexto canônico", async () => {
    buildWhatsappIntentContextMock.mockResolvedValue(contextWithTurns([
      {
        direction: "inbound",
        text: "meu e-mail é [email_redacted] e quero uma sugestão de lanche",
      },
      {
        direction: "outbound",
        text: "Você prefere fruta ou iogurte?",
      },
    ]));

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ fruta",
      receivedAt: new Date("2026-07-29T16:48:00Z"),
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;
    expect(promptText).toContain("[email_redacted]");
    expect(promptText).not.toContain("pessoa@example.com");
  });

  it.each([undefined, "auto"])("oferece web_search no modo %s sem forçar execução", async (mode) => {
    if (mode === undefined) {
      delete process.env.AI_QUESTION_WEB_SEARCH_MODE;
    } else {
      process.env.AI_QUESTION_WEB_SEARCH_MODE = mode;
    }

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ qual é a recomendação atual de fibras?",
      receivedAt: new Date("2026-07-29T16:00:00Z"),
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    expect(requestArgs.tools).toEqual([{ type: "web_search" }]);
    expect(requestArgs.tool_choice).toBeUndefined();
  });

  it.each(["disabled", "off", "forced", "valor-invalido"])(
    "não oferece web_search no modo fail-closed %s",
    async (mode) => {
      process.env.AI_QUESTION_WEB_SEARCH_MODE = mode;

      await executeWhatsappAiQuestionIntent(42, {
        text: "/ como está meu consumo hoje?",
        receivedAt: new Date("2026-07-29T16:00:00Z"),
      });

      const requestArgs = responsesCreateMock.mock.calls[0][0];
      expect(requestArgs.tools).toBeUndefined();
    },
  );

  it("não adiciona histórico quando rollout ou fallback canônico seleciona janela vazia", async () => {
    buildWhatsappIntentContextMock.mockResolvedValue(contextWithTurns([]));

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ quantas calorias tem uma banana?",
      receivedAt: new Date("2026-07-29T16:00:00Z"),
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;
    expect(promptText).not.toContain("Histórico recente da conversa");
  });

  it("atravessa o produtor QUESTION real e resolve sim pelo snapshot persistido do consumer", async () => {
    const userId = 120950;
    const receivedAt = new Date("2026-07-29T16:00:00Z");
    const produced = await executeWhatsappAiQuestionIntent(userId, {
      text: "/ me dê uma opção de café da tarde",
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      externalMessageId: "question-producer-1209",
    });

    expect(produced).toEqual(expect.objectContaining({
      action: "ai_question_answered",
      reply: expect.stringContaining("Quer que eu calcule"),
      interactiveReply: expect.any(Object),
    }));
    expect(produced?.data).toEqual(expect.objectContaining({
      interactionId: "question.meal_calculation",
      structuredContinuation: true,
    }));

    const repository = createDrizzleWhatsAppPendingOperationRepository({
      getDb: vi.fn(),
      onWarning: vi.fn(),
    });
    const pending = await repository.getActivePendingOperation(userId, new Date("2026-07-29T16:01:00Z"));
    const resumed = await resolveQuestionMealCalculationText({
      userId,
      pendingOperation: pending!,
      text: "sim",
      receivedAt: new Date("2026-07-29T16:01:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(resumed).toEqual(expect.objectContaining({
      action: "question_meal_calculation_completed",
      eventType: "whatsapp.question_meal_calculation.completed",
    }));
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
  });
});
