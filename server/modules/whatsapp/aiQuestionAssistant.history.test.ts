import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const buildWhatsappIntentContextMock = vi.fn();
const createOpenAiClientMock = vi.fn();
const responsesCreateMock = vi.fn();

vi.mock("./intentContext", () => ({
  buildWhatsappIntentContext: (...args: unknown[]) => buildWhatsappIntentContextMock(...args),
}));

vi.mock("../../db", () => ({
  logInferenceEvent: vi.fn(),
}));

vi.mock("../../_core/openaiClient", () => ({
  OpenAiConfigurationError: class OpenAiConfigurationError extends Error {},
  isOpenAiConfigured: () => true,
  createOpenAiClient: (...args: unknown[]) => createOpenAiClientMock(...args),
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
  });

  afterEach(() => {
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
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;

    expect(promptText).toContain("Usuário: me dê uma sugestão para meu lanche da tarde");
    expect(promptText).toContain("Assistente: Para o seu lanche da tarde, sugiro frutas. Quais você tem em casa?");
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
});
