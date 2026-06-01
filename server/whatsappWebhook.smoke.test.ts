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

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getWhatsAppAccessToken: getWhatsAppAccessTokenMock,
  listUserMeals: vi.fn(async () => []),
  logInferenceEvent: logInferenceEventMock,
  relabelUserMeals: vi.fn(async () => []),
}));

vi.mock("./nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

const { handleWhatsAppWebhook } = await import("./whatsappWebhook");

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

function createMetaTextPayload(text: string) {
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
                  profile: { name: "Usuário Smoke" },
                  wa_id: "5511999999999",
                },
              ],
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid.smoke-text-1",
                  timestamp: "1713708840",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
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
                  profile: { name: "Usuário Smoke" },
                  wa_id: "5511999999999",
                },
              ],
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid.smoke-audio-1",
                  timestamp: "1713708840",
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

describe("whatsappWebhook smoke", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-20T08:52:00-03:00"));

    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => ({ key, url: `https://storage.test/${key}` }));
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-smoke-text" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "arroz e frango",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Smoke test sem chamada externa real.",
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
    transcribeAudioMock.mockReset();
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 0,
      text: "",
      segments: [],
    });

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("processa um payload inbound realista de texto sem depender da Meta, de banco externo ou de token real", async () => {
    const req = { body: createMetaTextPayload("arroz e frango") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(getUserIdByWhatsappPhoneMock).toHaveBeenCalledWith("5511999999999");
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: "arroz e frango",
      transcript: undefined,
      imageUrl: undefined,
      audioUrl: undefined,
      habits: [],
    });
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-smoke-text",
      userId: 123,
      mealLabel: "Almoço",
    }));
    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/phone-number-test/messages"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("processa áudio inbound com transcrição mockada e sem chamada externa real ao provider", async () => {
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2.1,
      text: "arroz e feijão",
      segments: [],
    });

    global.fetch = vi
      .fn()
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      }) as typeof fetch;

    const req = { body: createMetaAudioPayload() };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedAudioBase64 = `data:audio/ogg;base64,${Buffer.from("audio-test").toString("base64")}`;

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      audioBase64: expectedAudioBase64,
      mimeType: "audio/ogg",
      language: "pt",
      prompt: "Transcreva a refeição descrita pelo usuário em português do Brasil.",
    });
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: undefined,
      transcript: "arroz e feijão",
      imageUrl: undefined,
      audioUrl: expect.stringContaining("/whatsapp/audio/5511999999999-audio-media-id.ogg"),
      habits: [],
    });
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-smoke-text",
      userId: 123,
      mealLabel: "Almoço",
      notes: "arroz e feijão",
    }));
  });

  it("transcreve e registra áudio mesmo quando o storage da mídia falha", async () => {
    storagePutMock.mockRejectedValue(new Error("storage unavailable"));
    transcribeAudioMock.mockResolvedValue({
      task: "transcribe",
      language: "pt",
      duration: 2.1,
      text: "arroz e feijão",
      segments: [],
    });

    global.fetch = vi
      .fn()
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({}),
      }) as typeof fetch;

    const req = { body: createMetaAudioPayload() };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedAudioBase64 = `data:audio/ogg;base64,${Buffer.from("audio-test").toString("base64")}`;

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(transcribeAudioMock).toHaveBeenCalledWith({
      audioBase64: expectedAudioBase64,
      mimeType: "audio/ogg",
      language: "pt",
      prompt: "Transcreva a refeição descrita pelo usuário em português do Brasil.",
    });
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: undefined,
      transcript: "arroz e feijão",
      imageUrl: undefined,
      audioUrl: undefined,
      habits: [],
    });
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({ audioUrl: undefined }),
      [],
    );
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.media_storage_warning",
      status: "warning",
    }));
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-smoke-text",
      userId: 123,
      mealLabel: "Almoço",
      notes: "arroz e feijão",
    }));
  });

  it("retorna sucesso sem processar quando o payload da Meta contém apenas status e nenhuma mensagem", async () => {
    const req = {
      body: {
        object: "whatsapp_business_account",
        entry: [
          {
            changes: [
              {
                field: "messages",
                value: {
                  messaging_product: "whatsapp",
                  statuses: [{ id: "wamid.status-1", status: "sent" }],
                },
              },
            ],
          },
        ],
      },
    };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 0 });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("retorna sucesso sem processar quando o payload inbound vem malformado", async () => {
    const req = {
      body: {
        entry: [
          {
            changes: [
              {
                value: {
                  messages: "not-an-array",
                },
              },
            ],
          },
        ],
      },
    };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 0 });
    expect(getUserIdByWhatsappPhoneMock).not.toHaveBeenCalled();
    expect(processMealInputMock).not.toHaveBeenCalled();
  });
});