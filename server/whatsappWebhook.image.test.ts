import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const createUserWaterLogMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const getWhatsAppAccessTokenMock = vi.fn();
const storagePutMock = vi.fn();
const generateImageMock = vi.fn();

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  createUserWaterLog: createUserWaterLogMock,
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

vi.mock("./_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: vi.fn(),
}));

const { __resetWhatsAppWebhookDeduplicationForTests, handleWhatsAppWebhook } = await import("./whatsappWebhook");

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

function createMetaImagePayload(messageId = "wamid.image-1", caption?: string) {
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
                  id: messageId,
                  timestamp: "1713708840",
                  type: "image",
                  image: {
                    id: "image-media-id",
                    mime_type: "image/jpeg",
                    ...(caption ? { caption } : {}),
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
      body: expect.stringContaining("Recebi sua imagem e estou processando"),
    }),
  );
}

function findFetchCallByBody(expectedBodyPart: string) {
  return vi.mocked(global.fetch).mock.calls.find(([, init]) => {
    const body = init && "body" in init ? init.body : undefined;
    return typeof body === "string" && body.includes(expectedBodyPart);
  });
}

describe("whatsappWebhook image inbound", () => {
  beforeEach(() => {
    __resetWhatsAppWebhookDeduplicationForTests();
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    createUserWaterLogMock.mockResolvedValue({ id: 789, userId: 123, amountMl: 250 });
    createPendingMealInferenceMock.mockReset();
    confirmPendingMealMock.mockReset();
    logInferenceEventMock.mockReset();
    processMealInputMock.mockReset();
    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({ skippedReason: "disabled" });
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
    const req = { body: createMetaImagePayload("wamid.image-inline") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedDataUrl = `data:image/jpeg;base64,${Buffer.from("image-test").toString("base64")}`;
    const expectedStorageUrl = "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg";

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expectMessageMarkedAsRead("wamid.image-inline");
    expectProcessingAcknowledgement();
    expect(createUserWaterLogMock).not.toHaveBeenCalled();
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

  it("usa legenda da imagem como texto para preservar quantidade exata enviada", async () => {
    const req = { body: createMetaImagePayload("wamid.image-caption-grams", "47g") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedDataUrl = `data:image/jpeg;base64,${Buffer.from("image-test").toString("base64")}`;

    expect(res.statusCode).toBe(200);
    expect(processMealInputMock).toHaveBeenCalledWith({
      text: "47g",
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
    });
  });

  it("envia imagem anotada quando a geração visual retorna URL", async () => {
    generateImageMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(createWhatsAppOkResponse() as never);

    const req = { body: createMetaImagePayload("wamid.image-annotated") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedB64 = Buffer.from("image-test").toString("base64");

    expect(res.statusCode).toBe(200);
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      originalImages: [
        expect.objectContaining({
          mimeType: "image/jpeg",
          b64Json: expectedB64,
        }),
      ],
      prompt: expect.stringContaining("frango"),
    }));

    const imageSendCall = findFetchCallByBody('"type":"image"');
    expect(imageSendCall).toBeTruthy();
    expect(imageSendCall?.[0]).toEqual(expect.stringContaining("/phone-number-test/messages"));
    expect(imageSendCall?.[1]).toEqual(expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("https://storage.test/generated/meal-support/annotated.png"),
    }));
    expect(imageSendCall?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining("Imagem anotada com os alimentos identificados."),
    }));
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({ imageUrl: "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg" }),
      [
        expect.objectContaining({
          mediaType: "image",
          storageUrl: "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg",
        }),
        expect.objectContaining({
          mediaType: "image",
          storageKey: "generated/meal-support/annotated.png",
          storageUrl: "https://storage.test/generated/meal-support/annotated.png",
          mimeType: "image/png",
          originalFileName: "whatsapp-annotated-meal.png",
        }),
      ],
    );
    expect(processMealInputMock).toHaveBeenCalled();
  });

  it("envia imagem com cards quando a edição da foto original não retorna URL", async () => {
    generateImageMock
      .mockResolvedValueOnce({ skippedReason: "provider_failed" })
      .mockResolvedValueOnce({
        url: "https://storage.test/generated/meal-support/cards.png",
        mimeType: "image/png",
      });
    vi.mocked(global.fetch).mockResolvedValueOnce(createWhatsAppOkResponse() as never);

    const req = { body: createMetaImagePayload("wamid.image-cards-fallback") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(generateImageMock).toHaveBeenCalledTimes(2);
    expect(generateImageMock).toHaveBeenNthCalledWith(1, expect.objectContaining({
      originalImages: expect.any(Array),
      prompt: expect.stringContaining("Edite a foto original"),
    }));
    expect(generateImageMock).toHaveBeenNthCalledWith(2, expect.objectContaining({
      prompt: expect.stringContaining("cards nutricionais"),
    }));

    const imageSendCall = findFetchCallByBody('"type":"image"');
    expect(imageSendCall).toBeTruthy();
    expect(imageSendCall?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining("https://storage.test/generated/meal-support/cards.png"),
    }));
  });

  it("analisa e registra imagem mesmo quando o storage da mídia falha", async () => {
    storagePutMock.mockRejectedValue(new Error("storage unavailable"));
    const req = { body: createMetaImagePayload("wamid.image-storage-fallback") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedDataUrl = `data:image/jpeg;base64,${Buffer.from("image-test").toString("base64")}`;

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expectMessageMarkedAsRead("wamid.image-storage-fallback");
    expectProcessingAcknowledgement();
    expect(createUserWaterLogMock).not.toHaveBeenCalled();
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

  it("ignora reentrega do mesmo wamid sem reenviar respostas nem criar refeição duplicada", async () => {
    const req = { body: createMetaImagePayload("wamid.image-duplicate") };
    const firstRes = createResponse();
    const duplicateRes = createResponse();

    await handleWhatsAppWebhook(req as never, firstRes as never);
    await handleWhatsAppWebhook(req as never, duplicateRes as never);

    expect(firstRes.body).toEqual({ ok: true, processed: 1 });
    expect(duplicateRes.body).toEqual({ ok: true, processed: 1 });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
    expect(findFetchCallByBody("Recebi sua imagem e estou processando")).toBeTruthy();
    const acknowledgementCalls = vi.mocked(global.fetch).mock.calls.filter(([, init]) => {
      const body = init && "body" in init ? init.body : undefined;
      return typeof body === "string" && body.includes("Recebi sua imagem e estou processando");
    });
    expect(acknowledgementCalls).toHaveLength(1);
  });
});
