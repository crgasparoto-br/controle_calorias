import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const processMealInputMock = vi.fn();
const generateImageMock = vi.fn();
const storagePutMock = vi.fn();
const fallbackWebhookMock = vi.fn();

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input: Record<string, unknown>) => ({
    id: String(input.storageKey).includes("annotated") ? 202 : 101,
    ...input,
  })),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppMediaConfig: async () => ({ accessToken: "access-token-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./storage", () => ({
  storagePut: storagePutMock,
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

vi.mock("./_core/imageGeneration", () => ({
  generateImage: generateImageMock,
}));

vi.mock("./whatsappWebhook", () => ({
  handleWhatsAppWebhook: fallbackWebhookMock,
}));

const { handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

let sentTextMessages: string[];
let sentImageMessages: Array<{ link: string; caption: string }>;

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
  };
}

function createImageWebhookRequest() {
  return {
    body: {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: {
                  phone_number_id: "phone-number-test",
                },
                messages: [
                  {
                    id: "image-with-foods",
                    from: "5511999999999",
                    timestamp: "1780502400",
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
    },
  };
}

describe("handleWhatsAppWebhookWithTextIntent annotated image flow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    sentTextMessages = [];
    sentImageMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    logInferenceEventMock.mockReset();
    getHabitSnapshotsMock.mockReset();
    createPendingMealInferenceMock.mockReset();
    confirmPendingMealMock.mockReset();
    processMealInputMock.mockReset();
    generateImageMock.mockReset();
    storagePutMock.mockReset();
    fallbackWebhookMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getHabitSnapshotsMock.mockResolvedValue([]);
    storagePutMock.mockImplementation(async (key: string, _buffer: Buffer, mimeType: string) => ({
      key,
      url: `https://storage.test/${key}`,
      mimeType,
    }));
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "meu almoço",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Inferência simulada para imagem.",
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
      totals: {
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
      },
    });
    generateImageMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
    });
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-1" });
    confirmPendingMealMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 10,
      mealLabel: input.mealLabel,
    }));
    fallbackWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (payload?.text?.body) {
          sentTextMessages.push(payload.text.body);
        }
        if (payload?.image?.link) {
          sentImageMessages.push({
            link: payload.image.link,
            caption: payload.image.caption,
          });
        }
        return { ok: true, json: async () => ({}) } as Response;
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
        arrayBuffer: async () => new TextEncoder().encode("binary-media").buffer,
      } as Response;
    }) as typeof fetch;
  });

  it("salva a imagem original e a anotada junto à refeição e devolve a anotada no WhatsApp", async () => {
    const req = createImageWebhookRequest();
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(fallbackWebhookMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "meu almoço",
      imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    }));
    expect(generateImageMock).toHaveBeenCalledOnce();
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
    expect(sentImageMessages).toEqual([
      {
        link: "https://storage.test/generated/meal-support/annotated.png",
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
  });
});
