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
const createLocalMealPhotoOverlayMock = vi.fn();

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
  updateUserMeal: vi.fn(),
  removeUserMeal: vi.fn(),
}));

vi.mock("./nutritionEngine", () => ({
  processMealInput: processMealInputMock,
  MealInferenceError: class MealInferenceError extends Error {},
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("./modules/whatsapp/localMealPhotoOverlay", () => ({
  createLocalMealPhotoOverlay: createLocalMealPhotoOverlayMock,
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

function createMetaImagePayload(messageId = "wamid.water-1") {
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

function findFetchCallByBody(expectedBodyPart: string) {
  return vi.mocked(global.fetch).mock.calls.find(([, init]) => {
    const body = init && "body" in init ? init.body : undefined;
    return typeof body === "string" && body.includes(expectedBodyPart);
  });
}

function waterItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    foodName: "água",
    canonicalName: "Água Mineral",
    portionText: "500 ml",
    quantity: 500,
    unit: "ml",
    servings: 1,
    estimatedGrams: 500,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.9,
    source: "catalog" as const,
    ...overrides,
  };
}

function foodItem(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    ...overrides,
  };
}

function setupFetchForImageFlow(extraOkResponses = 1) {
  const calls = [
    createWhatsAppOkResponse(),
    createWhatsAppOkResponse(),
    {
      ok: true,
      json: async () => ({
        url: "https://media.test/image-download",
        mime_type: "image/jpeg",
      }),
    },
    {
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("image-test").buffer,
      headers: {
        get: (name: string) => (name.toLowerCase() === "content-type" ? "image/jpeg" : null),
      },
    },
  ];
  for (let i = 0; i < extraOkResponses; i++) {
    calls.push(createWhatsAppOkResponse());
  }
  global.fetch = vi.fn().mockImplementation(() => Promise.resolve(calls.shift() ?? createWhatsAppOkResponse())) as typeof fetch;
}

describe("whatsappWebhook image inbound - água como hidratação", () => {
  beforeEach(() => {
    __resetWhatsAppWebhookDeduplicationForTests();
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    createUserWaterLogMock.mockReset();
    createUserWaterLogMock.mockResolvedValue({ id: 789, userId: 123, amountMl: 500 });
    createPendingMealInferenceMock.mockReset();
    confirmPendingMealMock.mockReset();
    logInferenceEventMock.mockReset();
    processMealInputMock.mockReset();
    generateImageMock.mockReset();
    generateImageMock.mockResolvedValue({ skippedReason: "disabled" });
    createLocalMealPhotoOverlayMock.mockReset();
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      skippedReason: "provider_failed",
      detail: "Overlay local desabilitado neste teste.",
    });
    storagePutMock.mockReset();
    storagePutMock.mockImplementation(async (key: string) => ({ key, url: `https://storage.test/${key}` }));
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-image" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("registra hidratação e não cria refeição quando a imagem tem apenas água com volume válido", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem()],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-only") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 500 }));
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(findFetchCallByBody("Água registrada")).toBeTruthy();
  });

  it("converte litros para mililitros", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem({ foodName: "agua", canonicalName: "Água", portionText: "1 L", quantity: 1, unit: "l" })],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-liter") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 1000 }));
  });

  it("registra água com gás como água pura", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem({ canonicalName: "Água Mineral com Gás" })],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-gas") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 500 }));
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
  });

  it("registra água com marca no nome como água pura", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem({ foodName: "água crystal", canonicalName: "Água Mineral Crystal", brand: "Crystal" })],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-brand") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 500 }));
  });

  it("registra hidratação e refeição separadas quando há água e alimento na imagem", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem(), foodItem()],
      totals: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    });
    setupFetchForImageFlow(2);

    const req = { body: createMetaImagePayload("wamid.water-and-food") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 500 }));
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    const [, , processed] = createPendingMealInferenceMock.mock.calls[0];
    expect(processed.items).toHaveLength(1);
    expect(processed.items[0].foodName).toBe("frango");
    expect(processed.totals).toEqual({ calories: 165, protein: 31, carbs: 0, fat: 3.6 });
    expect(findFetchCallByBody("Água registrada")).toBeTruthy();
  });

  it("não cria hidratação nem refeição quando a água aparece sem volume válido", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem({ portionText: "", quantity: undefined, unit: undefined })],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-no-volume") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(findFetchCallByBody("Preciso do volume da água")).toBeTruthy();
  });

  it("soma volumes de mais de um recipiente de água em um único registro", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [
        waterItem({ portionText: "300 ml", quantity: 300, unit: "ml" }),
        waterItem({ portionText: "200 ml", quantity: 200, unit: "ml" }),
      ],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-multiple") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).toHaveBeenCalledTimes(1);
    expect(createUserWaterLogMock).toHaveBeenCalledWith(123, expect.objectContaining({ amountMl: 500 }));
  });

  it("não trata água de coco como hidratação de água pura", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem({ foodName: "água de coco", canonicalName: "Água de Coco", calories: 45, carbs: 10 })],
      totals: { calories: 45, protein: 0, carbs: 10, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-coconut") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    const [, , processed] = createPendingMealInferenceMock.mock.calls[0];
    expect(processed.items).toHaveLength(1);
    expect(processed.items[0].canonicalName).toBe("Água de Coco");
  });

  it("não trata água tônica nem água saborizada como hidratação de água pura", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [
        waterItem({ foodName: "água tônica", canonicalName: "Água Tônica", calories: 34 }),
        waterItem({ foodName: "água saborizada", canonicalName: "Água Saborizada", calories: 20 }),
      ],
      totals: { calories: 54, protein: 0, carbs: 12, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-flavored") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    const [, , processed] = createPendingMealInferenceMock.mock.calls[0];
    expect(processed.items).toHaveLength(2);
  });

  it("não confirma hidratação quando o registro de água falha", async () => {
    createUserWaterLogMock.mockRejectedValueOnce(new Error("db offline"));
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem()],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-failure") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(findFetchCallByBody("Água registrada")).toBeFalsy();
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.processing_error",
      status: "error",
    }));
  });

  it("é idempotente para o mesmo message.id", async () => {
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "",
      confidence: 0.9,
      needsConfirmation: true,
      reasoning: "teste",
      items: [waterItem()],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0 },
    });
    setupFetchForImageFlow(1);

    const req = { body: createMetaImagePayload("wamid.water-duplicate") };
    const firstRes = createResponse();
    const duplicateRes = createResponse();

    await handleWhatsAppWebhook(req as never, firstRes as never);
    await handleWhatsAppWebhook(req as never, duplicateRes as never);

    expect(createUserWaterLogMock).toHaveBeenCalledTimes(1);
    expect(firstRes.body).toEqual({ ok: true, processed: 1 });
    expect(duplicateRes.body).toEqual({ ok: true, processed: 1 });
  });
});
