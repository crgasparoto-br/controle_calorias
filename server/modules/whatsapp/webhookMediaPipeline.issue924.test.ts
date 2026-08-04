import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const getWhatsAppAccessTokenMock = vi.fn();
const transcribeAudioMock = vi.fn();
const storagePutMock = vi.fn();
const {
  beginInboundMessageMock,
  recordDomainLinkMock,
  markMessageProcessedMock,
} = vi.hoisted(() => ({
  beginInboundMessageMock: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  recordDomainLinkMock: vi.fn(async () => undefined),
  markMessageProcessedMock: vi.fn(async () => undefined),
}));

vi.mock("./messageLifecycle", () => ({
  beginInboundMessage: beginInboundMessageMock,
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: recordDomainLinkMock,
  markMessageProcessed: markMessageProcessedMock,
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("../../db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  buildSavedMedia: vi.fn((input) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  createUserWaterLog: vi.fn(),
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getWhatsAppAccessToken: getWhatsAppAccessTokenMock,
  listUserMeals: vi.fn(async () => []),
  logInferenceEvent: logInferenceEventMock,
  relabelUserMeals: vi.fn(async () => []),
  updateUserCurrentWeight: vi.fn(),
}));

vi.mock("./weightIdempotency", () => ({
  ensureWhatsAppWeightEntry: vi.fn(),
}));

vi.mock("./userMeasurementReplyContext", () => ({
  getWhatsAppWeightVariation: vi.fn(),
  getWhatsAppUserTimeZone: vi.fn(async () => "America/Sao_Paulo"),
  getWhatsAppWaterProgress: vi.fn(async () => ({
    totalMl: 0,
    goalMl: null,
    timeZone: "America/Sao_Paulo",
    dateKey: "2026-08-04",
  })),
}));

vi.mock("../../nutritionEngine", () => ({
  MealInferenceError: class MealInferenceError extends Error {},
  processMealInput: processMealInputMock,
}));

vi.mock("../../storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("../../_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

const {
  __resetWhatsAppWebhookDeduplicationForTests,
  handleWhatsAppWebhook,
} = await import("../../whatsappWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

function createResponse(): MockResponse {
  return {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function createMetaAudioPayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "business-account-id",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511000000000",
                phone_number_id: "phone-number-test",
              },
              contacts: [
                {
                  profile: { name: "Usuário Teste" },
                  wa_id: "5511999999999",
                },
              ],
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid.issue-924-audio-duplicate",
                  timestamp: "1785832200",
                  type: "audio",
                  audio: {
                    id: "audio-media-id",
                    mime_type: "audio/ogg",
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function createWhatsAppOkResponse() {
  return {
    ok: true,
    json: async () => ({}),
  };
}

describe("issue #924 WhatsApp transcription continuity", () => {
  beforeEach(() => {
    __resetWhatsAppWebhookDeduplicationForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-04T08:30:00-03:00"));

    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    storagePutMock.mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.test/${key}`,
    }));
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-issue-924" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "arroz e feijão",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Teste hermético sem chamada externa.",
      items: [
        {
          foodName: "arroz",
          canonicalName: "Arroz branco cozido",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 130,
          protein: 2.7,
          carbs: 28,
          fat: 0.3,
          confidence: 0.92,
          source: "catalog" as const,
        },
      ],
      totals: { calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
    });
    beginInboundMessageMock.mockClear();
    recordDomainLinkMock.mockClear();
    markMessageProcessedMock.mockClear();
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      text: "arroz e feijão",
      provider: "openai",
      model: "gpt-4o-mini-transcribe",
      execution: { source: "primary", attempts: 1, usedFallback: false },
    });

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createWhatsAppOkResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://media.test/audio-download",
          mime_type: "audio/ogg",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("audio-test").buffer,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "audio/ogg" : null,
        },
      })
      .mockResolvedValueOnce(createWhatsAppOkResponse()) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("does not download, transcribe or mutate again for a duplicate callback", async () => {
    const request = { body: createMetaAudioPayload() };
    const firstResponse = createResponse();
    const duplicateResponse = createResponse();

    await handleWhatsAppWebhook(request as never, firstResponse as never);
    await handleWhatsAppWebhook(request as never, duplicateResponse as never);

    expect(firstResponse.body).toEqual({ ok: true, processed: 1 });
    expect(duplicateResponse.body).toEqual({ ok: true, processed: 1 });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    expect(storagePutMock).toHaveBeenCalledTimes(1);
    expect(transcribeAudioMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
    expect(beginInboundMessageMock).toHaveBeenCalledTimes(1);
    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ transcript: "arroz e feijão" }),
    );
  });
});
