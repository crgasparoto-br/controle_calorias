import { beforeEach, describe, expect, it, vi } from "vitest";

const buildWhatsappIntentContextMock = vi.fn();
const executeResolvedCapabilityMock = vi.fn();
const createDomainTextResponseMock = vi.fn();

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: buildWhatsappIntentContextMock,
}));

vi.mock("../../db", () => ({
  logInferenceEvent: vi.fn(),
}));

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

vi.mock("./timeZoneContext", () => ({
  getWhatsAppOperationTimeZone: vi.fn(async () => "America/Sao_Paulo"),
}));

vi.mock("../insights/service", () => ({
  getDashboardTodayOverview: vi.fn(),
  getWeeklyReportBundle: vi.fn(),
  getPeriodReportBundle: vi.fn(),
}));

const { executeWhatsappAiQuestionIntent } = await import("./aiQuestionAssistantCore");

describe("QUESTION generic context-source bypass", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    buildWhatsappIntentContextMock.mockResolvedValue({
      recentTurns: [{
        direction: "inbound",
        text: "legacy-or-persistent-marker",
        occurredAtIso: "2026-08-17T17:00:00.000Z",
      }],
    });
    createDomainTextResponseMock.mockResolvedValue({ outputText: "ok", webSearch: { executed: false } });
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

  it.each(["write_only", "shadow", "persistent"])(
    "does not invoke the canonical history builder for scope=none in %s mode",
    async (rolloutMode) => {
      process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = rolloutMode;
      process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT = "100";

      const result = await executeWhatsappAiQuestionIntent(42, {
        text: "/ qual é a recomendação atual de fibras?",
        receivedAt: new Date("2026-08-17T18:00:00Z"),
        userTimezone: "America/Sao_Paulo",
      });

      expect(result?.data).toEqual(expect.objectContaining({ contextScope: "none" }));
      expect(buildWhatsappIntentContextMock).not.toHaveBeenCalled();
      const request = createDomainTextResponseMock.mock.calls[0][1];
      expect(JSON.stringify(request)).not.toContain("legacy-or-persistent-marker");
    },
  );
});
