import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const findRecentMessagesMock = vi.fn();
const createOpenAiClientMock = vi.fn();
const responsesCreateMock = vi.fn();

vi.mock("../../repositories/whatsappConversationRepository", () => ({
  createDrizzleWhatsAppConversationRepository: () => ({
    findRecentMessages: findRecentMessagesMock,
  }),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
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

describe("executeWhatsappAiQuestionIntent — continuidade de contexto", () => {
  beforeEach(() => {
    findRecentMessagesMock.mockReset();
    createOpenAiClientMock.mockReset();
    responsesCreateMock.mockReset();
    createOpenAiClientMock.mockReturnValue({ responses: { create: responsesCreateMock } });
    responsesCreateMock.mockResolvedValue({ output_text: "ok" });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("inclui a pergunta e a resposta anteriores no prompt enviado à IA na segunda mensagem", async () => {
    findRecentMessagesMock.mockResolvedValue([
      {
        id: 10,
        direction: "inbound",
        text: "me dê uma sugestão para meu lanche da tarde",
        transcript: null,
        captionText: null,
      },
      {
        id: 11,
        direction: "outbound",
        text: "Para o seu lanche da tarde, sugiro: iogurte, banana ou mix de frutas. Você tem frutas da sua preferência em casa?",
        transcript: null,
        captionText: null,
      },
      {
        id: 12,
        direction: "inbound",
        text: "tenho, maçã, pêra, uva, banana prata, caqui fuio",
        transcript: null,
        captionText: null,
      },
    ]);

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ tenho, maçã, pêra, uva, banana prata, caqui fuio",
      receivedAt: new Date("2026-07-29T16:48:00Z"),
      conversationId: 7,
      messageId: 12,
    });

    expect(findRecentMessagesMock).toHaveBeenCalledWith(7, expect.any(Number));

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;

    expect(promptText).toContain("lanche da tarde");
    expect(promptText).toContain("Você tem frutas da sua preferência em casa?");
    expect(promptText).not.toContain("tenho, maçã, pêra, uva, banana prata, caqui fuio\nUsuário");
  });

  it("não referencia a mensagem atual dentro do bloco de histórico", async () => {
    findRecentMessagesMock.mockResolvedValue([
      {
        id: 20,
        direction: "inbound",
        text: "quantas calorias tem uma maçã?",
        transcript: null,
        captionText: null,
      },
    ]);

    await executeWhatsappAiQuestionIntent(42, {
      text: "/ quantas calorias tem uma maçã?",
      receivedAt: new Date("2026-07-29T16:00:00Z"),
      conversationId: 7,
      messageId: 20,
    });

    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;

    expect(promptText).not.toContain("Histórico recente da conversa");
  });

  it("não consulta histórico quando não há conversationId (sem regressão em fluxos sem persistência)", async () => {
    await executeWhatsappAiQuestionIntent(42, {
      text: "/ quantas calorias tem uma banana?",
      receivedAt: new Date("2026-07-29T16:00:00Z"),
    });

    expect(findRecentMessagesMock).not.toHaveBeenCalled();
    const requestArgs = responsesCreateMock.mock.calls[0][0];
    const promptText = requestArgs.input[0].content[0].text as string;
    expect(promptText).not.toContain("Histórico recente da conversa");
  });
});
