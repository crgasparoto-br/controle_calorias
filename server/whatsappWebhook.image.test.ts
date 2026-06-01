import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const getWhatsAppAccessTokenMock = vi.fn();
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
  transcribeAudio: vi.fn(),
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

function createMetaImagePayload() {
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
                  profile: { name: "Usuário Imagem" },
                  wa_id: "5511999999999",
                },
              ],
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid.image-1",
                  timestamp: "1713708840",
                  type: "image",
                  image: {
                    id: "image-media-id",
                    mime_type: "image/jpeg",
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

function expectMessageMarkedAsRead(messageId: string) {
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/phone-number-test/messages"),
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining(`"message_id":"${messageId}"`),
    }),
  );
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/phone-number-test/messages"),
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining('"status":"read"'),
    }),
  );
}

function expectProcessingAcknowledgement() {
  expect(global.fetch).toHaveBeenCalledWith(
    expect.stringContaining("/phone-number-test/messages"),
    expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Recebi sua mensagem de imagem e estou processando"),
    }),
  );
}

describe("whatsappWebhook image inbound", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => ({ key, url: `https://storage.test/${key}` }));
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-image" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
    processMealInputMock.mockImplementation(async (input) => ({
      detectedMealLabel: "Almoço",
      sourceText: "",
      imageUrl: input.imageUrl,
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Imagem analisada no teste.",
      items: [
        {
          foodName: "frango",
          canonicalName: "Frango grelhado",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 165,
          protein: 31,
          carbs: 0,
          fat: 3.6,
          confidence: 0.92,
          source: "catalog" as const,
        },
      ],
      totals: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    }));

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createWhatsAppOkResponse())
      .mockResolvedValueOnce(createWhatsAppOkResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://media.test/image-download",
          mime_type: "image/jpeg",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new TextEncoder().encode("image-test").buffer,
        headers: {
          get: (name: string) =>
            name.toLowerCase() === "content-type" ? "image/jpeg" : null,
        },
      })
      .mockResolvedValueOnce(createWhatsAppOkResponse()) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envia a imagem inline para a IA e persiste apenas a URL do storage", async () => {
    const req = { body: createMetaImagePayload() };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedDataUrl = `data:image/jpeg;base64,${Buffer.from("image-test").toString("base64")}`;
    const expectedStorageUrl = "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg";

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expectMessageMarkedAsRead("wamid.image-1");
    expectProcessingAcknowledgement();
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: undefined,
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
    });
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({ imageUrl: expectedStorageUrl }),
      [expect.objectContaining({ storageUrl: expectedStorageUrl, mediaType: "image" })],
    );
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-image",
      userId: 123,
      mealLabel: "Almoço",
    }));
  });

  it("analisa e registra imagem mesmo quando o storage da mídia falha", async () => {
    storagePutMock.mockRejectedValue(new Error("storage unavailable"));
    const req = { body: createMetaImagePayload() };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedDataUrl = `data:image/jpeg;base64,${Buffer.from("image-test").toString("base64")}`;

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expectMessageMarkedAsRead("wamid.image-1");
    expectProcessingAcknowledgement();
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: undefined,
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
    });
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({ imageUrl: undefined }),
      [],
    );
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.media_storage_warning",
      status: "warning",
    }));
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-image",
      userId: 123,
      mealLabel: "Almoço",
    }));
  });
});