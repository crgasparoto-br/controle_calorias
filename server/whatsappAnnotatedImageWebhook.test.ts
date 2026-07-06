import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const handleWhatsAppWebhookMock = vi.fn();
const getUserIdByWhatsappPhoneMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserDayMealTotalsMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const storagePutMock = vi.fn();
const generateImageMock = vi.fn();
const createLocalMealPhotoOverlayMock = vi.fn();
const getWhatsAppAccessTokenMock = vi.fn();
const listUserMealsMock = vi.fn(async () => []);
const updateUserMealMock = vi.fn();
const removeUserMealMock = vi.fn();

vi.mock("./whatsappWebhook", () => ({
  handleWhatsAppWebhook: handleWhatsAppWebhookMock,
}));

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserDayMealTotals: getUserDayMealTotalsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  getWhatsAppAccessToken: getWhatsAppAccessTokenMock,
  listUserMeals: listUserMealsMock,
  logInferenceEvent: logInferenceEventMock,
  relabelUserMeals: vi.fn(async () => []),
  updateUserMeal: updateUserMealMock,
  removeUserMeal: removeUserMealMock,
}));

vi.mock("./nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./_core/imageGeneration", () => ({
  generateAnnotatedMealImage: generateImageMock,
}));

vi.mock("./modules/mealPhotoOverlay/service", () => ({
  createLocalMealPhotoOverlay: createLocalMealPhotoOverlayMock,
}));

const { handleWhatsAppWebhookWithTextIntent } = await import("./whatsappWebhookWithTextIntent");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  send: (payload: unknown) => MockResponse;
};

const sentTextMessages: string[] = [];
const sentImageMessages: Array<{ link?: string; id?: string; caption?: string }> = [];
const uploadedMediaRequests: string[] = [];

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

function createImagePayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511000000000",
                phone_number_id: "phone-number-test",
              },
              messages: [
                {
                  from: "5511999999999",
                  id: "wamid.annotated-image-1",
                  timestamp: "1713729600",
                  type: "image",
                  image: {
                    id: "image-media-id",
                    mime_type: "image/jpeg",
                    caption: "meu almoço",
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

describe("handleWhatsAppWebhookWithTextIntent annotated image flow", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    sentTextMessages.length = 0;
    sentImageMessages.length = 0;
    uploadedMediaRequests.length = 0;

    handleWhatsAppWebhookMock.mockResolvedValue(undefined);
    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getUserDayMealTotalsMock.mockResolvedValue({ totals: { calories: 1620 } });
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-1" });
    confirmPendingMealMock.mockResolvedValue({ id: 321, mealLabel: "Almoço" });
    listUserMealsMock.mockResolvedValue([]);
    updateUserMealMock.mockReset();
    removeUserMealMock.mockReset();
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "meu almoço",
      imageUrl: "data:image/jpeg;base64,abc",
      audioUrl: undefined,
      transcript: undefined,
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Teste imagem anotada.",
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
    storagePutMock.mockImplementation(async (key: string) => ({
      key,
      url: `https://storage.test/${key}`,
    }));
    generateImageMock.mockResolvedValue({ skipped: true, skippedReason: "local overlay available" });
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      storageKey: "generated/meal-support/annotated.png",
      storageUrl: "https://storage.test/generated/meal-support/annotated.png",
    });

    global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(init.body as string) : null;
      if (url.includes("/media")) {
        uploadedMediaRequests.push(url);
      }
      if (body?.type === "text") {
        sentTextMessages.push(body.text.body);
      }
      if (body?.type === "image") {
        sentImageMessages.push({
          link: body.image?.link,
          id: body.image?.id,
          caption: body.image?.caption,
        });
      }
      if (url.endsWith("/image-media-id")) {
        return {
          ok: true,
          json: async () => ({ url: "https://graph.test/image-media-id" }),
        } as Response;
      }
      if (url === "https://graph.test/image-media-id") {
        return {
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode("image-bytes").buffer,
          headers: new Headers({ "content-type": "image/jpeg" }),
        } as Response;
      }
      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("salva a imagem original e a anotada junto à refeição e devolve a anotada no WhatsApp", async () => {
    const req = { body: createImagePayload() };
    const res = createResponse();
    const fallbackWebhookMock = handleWhatsAppWebhookMock;

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(fallbackWebhookMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "meu almoço",
      imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    }));
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledOnce();
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      42,
      "whatsapp",
      expect.objectContaining({ imageUrl: "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg" }),
      expect.arrayContaining([
        expect.objectContaining({
          mediaType: "image",
          storageKey: "whatsapp/image/5511999999999-image-media-id.jpg",
          storageUrl: "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg",
          originalFileName: "5511999999999-image-media-id.jpg",
        }),
        expect.objectContaining({
          mediaType: "image",
          storageKey: "generated/meal-support/annotated.png",
          storageUrl: "https://storage.test/generated/meal-support/annotated.png",
          originalFileName: "whatsapp-annotated-meal.png",
        }),
      ]),
    );
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-1",
      userId: 42,
      mealLabel: "Almoço",
    }));
    expect(sentTextMessages[0]).toBe("Recebi sua imagem e estou processando.");
    expect(sentTextMessages[1]).toBe([
      "*Almoço Registrado às 13:00hs.*",
      "",
      "Itens:",
      "• 🍚 arroz — 100g",
      "130 kcal | P 2,7 g | C 28 g | G 0,3 g",
      "",
      "Total da refeição:",
      "130 kcal | P 2,7 g | C 28 g | G 0,3 g",
      "",
      "Meta de hoje:",
      "* Meta estimada: 2.200 kcal",
      "* Meta ajustada: 2.200 kcal",
      "* Consumo: 1.620 kcal",
      "* Déficit: 580 kcal",
    ].join("\n"));
    expect(uploadedMediaRequests.length).toBe(0);
    expect(sentImageMessages).toEqual([
      {
        link: "https://storage.test/generated/meal-support/annotated.png",
        id: undefined,
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
  });
});
