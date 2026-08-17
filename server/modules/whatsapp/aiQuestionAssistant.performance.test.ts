import { beforeEach, describe, expect, it, vi } from "vitest";

const logInferenceEventMock = vi.fn();
const buildWhatsappIntentContextMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createDomainTextResponseMock = vi.fn();
const getDashboardTodayOverviewMock = vi.fn();
const getWeeklyReportBundleMock = vi.fn();
const getPeriodReportBundleMock = vi.fn();

vi.mock("../../db", () => ({
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: buildWhatsappIntentContextMock,
}));

vi.mock("../../_core/ai/configResolver", () => ({
  resolveCapabilityConfig: () => ({
    state: "ready",
    primary: { provider: "openai", model: "gpt-4.1-mini" },
    fallback: {
      requested: false,
      effectivelyEnabled: false,
      provider: null,
      model: null,
    },
    timeoutMs: 8_000,
    maxAttempts: 1,
    diagnostics: [],
    usedLegacyVariables: false,
  }),
}));

vi.mock("../../_core/ai/capabilityExecutor", () => ({
  observeUnavailableResolvedCapability: vi.fn(),
  executeResolvedCapability: executeResolvedCapabilityMock,
}));

vi.mock("../../_core/ai/domainTextResponse", () => ({
  createDomainTextResponse: createDomainTextResponseMock,
}));

vi.mock("./timeZoneContext", () => ({
  getWhatsAppOperationTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

vi.mock("../insights/service", () => ({
  getDashboardTodayOverview: getDashboardTodayOverviewMock,
  getWeeklyReportBundle: getWeeklyReportBundleMock,
  getPeriodReportBundle: getPeriodReportBundleMock,
}));

const { executeWhatsappAiQuestionIntent } = await import("./aiQuestionAssistant");

function todayFixture() {
  return {
    today: {
      date: "2026-08-17",
      goal: 2_000,
      consumed: 1_200,
      burned: 0,
      water: { logs: [] },
      remaining: 800,
      net: 1_200,
      quality: "ok",
    },
    meals: [],
    exercises: [],
    water: { logs: [] },
  };
}

function weekFixture() {
  return {
    progress: { summary: {}, weight: {} },
    quality: {},
    weekly: [],
    mealsByDate: [],
  };
}

function periodFixture() {
  return {
    range: { startDate: "2026-07-19", endDate: "2026-08-17" },
    goal: {},
    totals: {},
    quality: {},
    habitAnalytics: {},
    weightTrend: {},
    daily: [],
  };
}

function latencyEvent() {
  const call = logInferenceEventMock.mock.calls.find(([event]) => event.eventType === "whatsapp.ai_question.latency");
  expect(call).toBeDefined();
  return JSON.parse(call![0].detail as string) as Record<string, unknown>;
}

describe("executeWhatsappAiQuestionIntent — caminho crítico de QUESTION", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildWhatsappIntentContextMock.mockResolvedValue({ recentTurns: [] });
    getDashboardTodayOverviewMock.mockResolvedValue(todayFixture());
    getWeeklyReportBundleMock.mockResolvedValue(weekFixture());
    getPeriodReportBundleMock.mockResolvedValue(periodFixture());
    createDomainTextResponseMock.mockResolvedValue({
      outputText: "Resposta segura",
      webSearch: { executed: false },
    });
    executeResolvedCapabilityMock.mockImplementation(async (_policy, operation, options) => ({
      value: await operation({
        signal: new AbortController().signal,
        source: "primary",
        attempt: 1,
        timeoutMs: 8_000,
        provider: {},
        providerId: "openai",
        model: "gpt-4.1-mini",
      }),
      source: "primary",
      attempts: 1,
      usedFallback: false,
      options,
    }));
  });

  it("não carrega relatórios pessoais para pergunta genérica e preserva web_search", async () => {
    const rawQuestion = "qual é a recomendação atual de fibras?";
    const result = await executeWhatsappAiQuestionIntent(42, {
      text: `/ ${rawQuestion}`,
      receivedAt: new Date("2026-08-17T18:00:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getDashboardTodayOverviewMock).not.toHaveBeenCalled();
    expect(getWeeklyReportBundleMock).not.toHaveBeenCalled();
    expect(getPeriodReportBundleMock).not.toHaveBeenCalled();
    expect(result?.data).toEqual(expect.objectContaining({
      contextScope: "none",
      usedUserKnowledgeBase: false,
    }));

    const request = createDomainTextResponseMock.mock.calls[0][1];
    expect(request.tools).toEqual([{ type: "web_search" }]);
    expect(request.input[0].content[0].text).not.toContain("Base de conhecimento do usuário");

    const telemetry = latencyEvent();
    expect(telemetry).toEqual(expect.objectContaining({
      capability: "QUESTION",
      context_scope: "none",
      persist_ms: null,
      time_to_first_token_ms: null,
      attempts: 1,
      fallback_occurred: false,
      web_search_available: true,
    }));
    expect(JSON.stringify(telemetry)).not.toContain(rawQuestion);
    expect(JSON.stringify(result?.data)).not.toContain(rawQuestion);

    const executorOptions = executeResolvedCapabilityMock.mock.calls[0][2];
    expect(executorOptions.observability.correlation).toEqual(expect.objectContaining({
      requestId: expect.any(String),
      contextScope: "none",
    }));
    expect(telemetry.requestId).toBe(executorOptions.observability.correlation.requestId);
  });

  it("carrega apenas o agregado diário quando a pergunta pessoal é explicitamente sobre hoje", async () => {
    await executeWhatsappAiQuestionIntent(42, {
      text: "/ como está meu consumo hoje?",
      receivedAt: new Date("2026-08-17T18:00:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getDashboardTodayOverviewMock).toHaveBeenCalledTimes(1);
    expect(getWeeklyReportBundleMock).not.toHaveBeenCalled();
    expect(getPeriodReportBundleMock).not.toHaveBeenCalled();
    const prompt = createDomainTextResponseMock.mock.calls[0][1].input[0].content[0].text as string;
    expect(prompt).toContain('"today"');
    expect(prompt).not.toContain('"currentWeek"');
    expect(prompt).not.toContain('"last30Days"');
    expect(latencyEvent()).toEqual(expect.objectContaining({ context_scope: "today" }));
  });

  it("carrega apenas a semana quando o período pessoal é semanal", async () => {
    await executeWhatsappAiQuestionIntent(42, {
      text: "/ como foi meu consumo esta semana?",
      receivedAt: new Date("2026-08-17T18:00:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getDashboardTodayOverviewMock).not.toHaveBeenCalled();
    expect(getWeeklyReportBundleMock).toHaveBeenCalledTimes(1);
    expect(getPeriodReportBundleMock).not.toHaveBeenCalled();
    expect(latencyEvent()).toEqual(expect.objectContaining({ context_scope: "week" }));
  });

  it("carrega apenas 30 dias quando a pergunta pessoal explicita período longo", async () => {
    await executeWhatsappAiQuestionIntent(42, {
      text: "/ como está minha evolução nos últimos 30 dias?",
      receivedAt: new Date("2026-08-17T18:00:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getDashboardTodayOverviewMock).not.toHaveBeenCalled();
    expect(getWeeklyReportBundleMock).not.toHaveBeenCalled();
    expect(getPeriodReportBundleMock).toHaveBeenCalledTimes(1);
    expect(latencyEvent()).toEqual(expect.objectContaining({ context_scope: "period" }));
  });

  it("mantém os três agregados para follow-up ambíguo", async () => {
    await executeWhatsappAiQuestionIntent(42, {
      text: "/ e proteína?",
      receivedAt: new Date("2026-08-17T18:00:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getDashboardTodayOverviewMock).toHaveBeenCalledTimes(1);
    expect(getWeeklyReportBundleMock).toHaveBeenCalledTimes(1);
    expect(getPeriodReportBundleMock).toHaveBeenCalledTimes(1);
    expect(latencyEvent()).toEqual(expect.objectContaining({ context_scope: "full" }));
  });
});
