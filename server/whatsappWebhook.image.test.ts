import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleWhatsAppWebhook } from "./whatsappWebhook";
import { listUserMeals } from "./db";

const sentWhatsAppPayloads: any[] = [];
const generateImageMock = vi.fn(async () => ({
  url: "https://storage.test/generated/meal-support/annotated.png",
  storageKey: "generated/meal-support/annotated.png",
  mimeType: "image/png",
}));
const processMealInputMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const storagePutMock = vi.fn();
const logInferenceEventMock = vi.fn();
const createUserWaterLogMock = vi.fn();

vi.mock("./_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./nutritionEngine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./nutritionEngine")>();
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

vi.mock("./db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./db")>();
  return {
    ...actual,
    getUserIdByWhatsappPhone: vi.fn(async () => 123),
    getHabitSnapshots: vi.fn(async () => []),
    getUserNutritionGoal: vi.fn(async () => ({ today: { calories: 2200 } })),
    getUserDayMealTotals: vi.fn(async () => ({ totals: { calories: 0 } })),
    createPendingMealInference: createPendingMealInferenceMock,
    confirmPendingMeal: confirmPendingMealMock,
    logInferenceEvent: logInferenceEventMock,
    createUserWaterLog: createUserWaterLogMock,
  };
});

function createResponse() {
  return {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    send(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function createWhatsAppOkResponse() {
  return {
    ok: true,
    json: async () => ({ messages: [{ id: "wamid.sent" }] }),
    text: async () => "ok",
  };
}

function createMetaImagePayload(messageId = "wamid.image") {
  return {
    object: "whatsapp_business_account",
    entry: [{
      changes: [{
        value: {
          metadata: { phone_number_id: "phone-number-test" },
          contacts: [{ wa_id: "5511999999999", profile: { name: "Cliente" } }],
          messages: [{
            from: "5511999999999",
            id: messageId,
            timestamp: "1700000000",
            type: "image",
            image: { id: "image-media-id", mime_type: "image/jpeg" },
          }],
        },
      }],
    }],
  };
}

function findFetchCallByBody(fragment: string) {
  return vi.mocked(global.fetch).mock.calls.find(([, init]) => String((init as RequestInit | undefined)?.body ?? "").includes(fragment));
}

function expectMessageMarkedAsRead(messageId: string) {
  expect(vi.mocked(global.fetch).mock.calls.some(([url, init]) => {
    return String(url).includes("/phone-number-test/messages")
      && String((init as RequestInit | undefined)?.body ?? "").includes(messageId)
      && String((init as RequestInit | undefined)?.body ?? "").includes("read");
  })).toBe(true);
}

function expectProcessingAcknowledgement() {
  expect(vi.mocked(global.fetch).mock.calls.some(([, init]) => {
    return String((init as RequestInit | undefined)?.body ?? "").includes("Recebi sua imagem e estou processando.");
  })).toBe(true);
}

describe("whatsappWebhook image inbound", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sentWhatsAppPayloads.length = 0;
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";
    process.env.WHATSAPP_ACCESS_TOKEN = "token-test";
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-test";
    process.env.PUBLIC_APP_URL = "https://app.test";

    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "Foto enviada pelo WhatsApp",
      confidence: 0.9,
      needsConfirmation: false,
      reasoning: "",
      items: [{
        foodName: "frango",
        canonicalName: "frango",
        portionText: "100g",
        quantity: 100,
        unit: "g",
        servings: 1,
        estimatedGrams: 100,
        calories: 165,
        protein: 31,
        carbs: 0,
        fat: 3.6,
        confidence: 0.9,
        source: "catalog",
      }],
      totals: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    });
    createPendingMealInferenceMock.mockResolvedValue({ draftId: "draft-image" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
    storagePutMock.mockImplementation(async (key: string, _buffer: Buffer, mimeType: string) => ({
      key,
      url: `https://storage.test/${key}`,
      mimeType,
    }));
    generateImageMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
    });
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/messages")) {
        sentWhatsAppPayloads.push(JSON.parse(String(init?.body ?? "{}")));
        return createWhatsAppOkResponse() as Response;
      }
      if (url.includes("graph.facebook.com")) {
        return {
          ok: true,
          json: async () => ({ url: "https://media.test/image", mime_type: "image/jpeg" }),
        } as Response;
      }
      return {
        ok: true,
        headers: { get: () => "image/jpeg" },
        arrayBuffer: async () => new TextEncoder().encode("image-test").buffer,
      } as Response;
    }));
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

  it("não envia cards quando a edição da foto original não retorna imagem anotada", async () => {
    generateImageMock.mockResolvedValueOnce({
      skippedReason: "provider_failed",
      detail: "Provider de imagem falhou; fallback local de classificação gerado.",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(createWhatsAppOkResponse() as never);

    const req = { body: createMetaImagePayload("wamid.image-cards-fallback") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(generateImageMock).toHaveBeenCalledTimes(1);
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      originalImages: expect.any(Array),
      prompt: expect.stringContaining("Mantenha a foto original"),
    }));
    expect(generateImageMock).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("Apenas sobreponha cards/etiquetas nutricionais"),
    }));
    expect(generateImageMock).not.toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining("cards nutricionais limpos"),
    }));

    const imageSendCall = findFetchCallByBody('"type":"image"');
    expect(imageSendCall).toBeFalsy();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.annotated_image_skipped",
      status: "warning",
      detail: expect.stringContaining("fallback local"),
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
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      imageUrl: expectedDataUrl,
    }));
  });
});
