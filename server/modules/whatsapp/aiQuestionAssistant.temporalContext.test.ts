import { beforeEach, describe, expect, it, vi } from "vitest";

const logInferenceEventMock = vi.fn();
const buildWhatsappIntentContextMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createDomainTextResponseMock = vi.fn();
const getDashboardTodayOverviewMock = vi.fn();
const getWeeklyReportBundleMock = vi.fn();
const getPeriodReportBundleMock = vi.fn();

vi.mock("../../db", () => ({ logInferenceEvent: logInferenceEventMock }));
vi.mock("./intentContext", () => ({ buildWhatsappIntentContext: buildWhatsappIntentContextMock }));
vi.mock("../../_core/ai/configResolver", () => ({
  resolveCapabilityConfig: () => ({
    state: "ready",
    primary: { provider: "openai", model: "gpt-4.1-mini" },
    fallback: { requested: false, effectivelyEnabled: false, provider: null, model: null },
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
vi.mock("../insights/service", () => ({
  getDashboardTodayOverview: getDashboardTodayOverviewMock,
  getWeeklyReportBundle: getWeeklyReportBundleMock,
  getPeriodReportBundle: getPeriodReportBundleMock,
}));

const { executeWhatsappAiQuestionIntent } = await import("./aiQuestionAssistantCore");

function periodFixture(startDate: string, endDate: string) {
  return {
    range: { startDate, endDate },
    goal: {},
    totals: {},
    quality: {},
    habitAnalytics: {},
    weightTrend: {},
    daily: [],
  };
}

describe("QUESTION temporal context windows", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildWhatsappIntentContextMock.mockResolvedValue({ recentTurns: [] });
    getDashboardTodayOverviewMock.mockResolvedValue({
      today: { date: "2026-08-17", goal: 2_000, consumed: 0, burned: 0, water: {}, remaining: 2_000, net: 0, quality: {} },
      meals: [], exercises: [], water: { logs: [] },
    });
    getWeeklyReportBundleMock.mockResolvedValue({ progress: { summary: {}, weight: {} }, quality: {}, weekly: [], mealsByDate: [] });
    getPeriodReportBundleMock.mockImplementation(async (_userId: number, range: { startDate: string; endDate: string }) => periodFixture(range.startDate, range.endDate));
    createDomainTextResponseMock.mockResolvedValue({ outputText: "ok", webSearch: { executed: false } });
    executeResolvedCapabilityMock.mockImplementation(async (_policy, operation) => ({
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
    }));
  });

  it("loads rolling seven local dates instead of the calendar week", async () => {
    const result = await executeWhatsappAiQuestionIntent(42, {
      text: "/ como foi meu consumo nos ultimos 7 dias?",
      receivedAt: new Date("2026-08-17T01:30:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getWeeklyReportBundleMock).not.toHaveBeenCalled();
    expect(getPeriodReportBundleMock).toHaveBeenCalledWith(
      42,
      { startDate: "2026-08-10", endDate: "2026-08-16" },
      "America/Sao_Paulo",
    );
    expect(result?.data?.contextScope).toBe("last7Days");
    const prompt = createDomainTextResponseMock.mock.calls[0][1].input[0].content[0].text as string;
    expect(prompt).toContain('"kind":"last7Days"');
  });

  it("uses the local calendar month even after UTC crossed into the next month", async () => {
    const result = await executeWhatsappAiQuestionIntent(42, {
      text: "/ como foi meu consumo este mes?",
      receivedAt: new Date("2026-09-01T01:30:00Z"),
      userTimezone: "America/Sao_Paulo",
    });

    expect(getWeeklyReportBundleMock).not.toHaveBeenCalled();
    expect(getPeriodReportBundleMock).toHaveBeenCalledWith(
      42,
      { startDate: "2026-08-01", endDate: "2026-08-31" },
      "America/Sao_Paulo",
    );
    expect(result?.data?.contextScope).toBe("month");
    const prompt = createDomainTextResponseMock.mock.calls[0][1].input[0].content[0].text as string;
    expect(prompt).toContain('"kind":"currentMonth"');
  });
});
