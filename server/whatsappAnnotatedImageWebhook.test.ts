import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserDayMealTotalsMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const processMealInputMock = vi.fn();
const generateImageMock = vi.fn();
const createLocalMealPhotoOverlayMock = vi.fn();
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
  getUserDayMealTotals: getUserDayMealTotalsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
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

vi.mock("./modules/whatsapp/localMealPhotoOverlay", () => ({
  createLocalMealPhotoOverlay: createLocalMealPhotoOverlayMock,
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
let sentImageMessages: Array<{ link?: string; id?: string; caption: string }>;
let uploadedMediaRequests: number;

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

function createImageWebhookRequest(messageId = "image-with-foods") {
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
                    id: messageId,
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
    uploadedMediaRequests = 0;
    getUserIdByWhatsappPhoneMock.mockReset();
    logInferenceEventMock.mockReset();
    getHabitSnapshotsMock.mockReset();
    getUserDayMealTotalsMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    createPendingMealInferenceMock.mockReset();
    confirmPendingMealMock.mockReset();
    processMealInputMock.mockReset();
    generateImageMock.mockReset();
    createLocalMealPhotoOverlayMock.mockReset();
    storagePutMock.mockReset();
    fallbackWebhookMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getUserDayMealTotalsMock.mockResolvedValue({
      date: "2026-06-03",
      meals: [],
      totals: {
        calories: 1620,
        protein: 92,
        carbs: 180,
        fat: 43,
      },
    });
    getUserNutritionGoalMock.mockResolvedValue({
      today: {
        calories: 2200,
      },
    });
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
    generateImageMock.mockResolvedValue({ skippedReason: "disabled" });
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
      buffer: Buffer.from("local-overlay-png"),
      detail: "Overlay local aplicado sobre a foto original da refeição.",
    });
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-1" });
    confirmPendingMealMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 10,
      mealLabel: input.mealLabel,
    }));
    fallbackWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/media")) {
        uploadedMediaRequests += 1;
        return { ok: true, json: async () => ({ id: "uploaded-annotated-media-id" }) } as Response;
      }

      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (payload?.text?.body) {
          sentTextMessages.push(payload.text.body);
        }
        if (payload?.image?.link || payload?.image?.id) {
          sentImageMessages.push({
            link: payload.image.link,
            id: payload.image.id,
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
      "Almoço Registrado às 13:00hs.",
      "",
      "Itens:",
      "• 🍚 arroz, 100g - 130 Kcal",
      "Prot. 2,7 g | Carb. 28 g | Gord. 0,3 g",
      "",
      "Total da refeição:",
      "130 Kcal",
      "Prot. 2,7 g | Carb. 28 g | Gord. 0,3 g",
      "",
      "Meta de hoje:",
      "* Meta estimada: 2.200 kcal",
      "* Meta ajustada: 2.200 kcal",
      "* Consumo: 1.620 kcal",
      "* Déficit: 580 kcal",
    ].join("\n"));
    expect(uploadedMediaRequests).toBe(0);
    expect(sentImageMessages).toEqual([
      {
        link: "https://storage.test/generated/meal-support/annotated.png",
        id: undefined,
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
  });

  it("envia por upload a imagem editada quando ela existe só em buffer", async () => {
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      buffer: Buffer.from("edited-photo-png"),
      mimeType: "image/png",
      detail: "Overlay local aplicado sobre a foto original da refeição.",
    });
    const req = createImageWebhookRequest("image-with-buffer-annotation");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(uploadedMediaRequests).toBe(1);
    expect(sentImageMessages).toEqual([
      {
        link: undefined,
        id: "uploaded-annotated-media-id",
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
    expect(sentTextMessages).not.toContain("A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.");
    expect(logInferenceEventMock).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.annotated_image_skipped",
    }));
  });

  it("envia o card de fallback local quando houver buffer utilizável", async () => {
    createLocalMealPhotoOverlayMock.mockResolvedValue({
      buffer: Buffer.from("fallback-card-png"),
      mimeType: "image/png",
      skippedReason: "provider_failed",
      detail: "Provider de imagem falhou; fallback local de classificação gerado.",
    });
    const req = createImageWebhookRequest("image-with-fallback-card");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(uploadedMediaRequests).toBe(1);
    expect(sentImageMessages).toEqual([
      {
        link: undefined,
        id: "uploaded-annotated-media-id",
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
    expect(sentTextMessages).not.toContain("A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.");
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.annotated_image_sent",
      detail: expect.stringContaining("origem=fallback_local"),
    }));
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.stringContaining("skippedReason=provider_failed"),
    }));
    expect(logInferenceEventMock).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.annotated_image_skipped",
    }));
  });

  it("mantém o registro e avisa quando a imagem anotada não pode ser gerada", async () => {
    createLocalMealPhotoOverlayMock.mockRejectedValue(new Error("provedor indisponível"));
    const req = createImageWebhookRequest("image-without-annotation");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(fallbackWebhookMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      42,
      "whatsapp",
      expect.objectContaining({ imageUrl: "https://storage.test/whatsapp/image/5511999999999-image-media-id.jpg" }),
      expect.arrayContaining([
        expect.objectContaining({
          mediaType: "image",
          storageKey: "whatsapp/image/5511999999999-image-media-id.jpg",
        }),
      ]),
    );
    expect(confirmPendingMealMock).toHaveBeenCalledWith(expect.objectContaining({
      draftId: "draft-1",
      userId: 42,
      mealLabel: "Almoço",
    }));
    expect(uploadedMediaRequests).toBe(0);
    expect(sentImageMessages).toEqual([]);
    expect(sentTextMessages.at(-1)).toBe("A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.");
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.annotated_image_skipped",
      detail: expect.stringContaining("provedor indisponível"),
    }));
  });

  it("responde com erro controlado quando a análise da imagem falha", async () => {
    processMealInputMock.mockRejectedValue(new Error("provider timeout"));
    const req = createImageWebhookRequest("image-analysis-failure");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(fallbackWebhookMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(sentTextMessages[0]).toBe("Recebi sua imagem e estou processando.");
    expect(sentTextMessages.at(-1)).toBe("Não consegui processar essa imagem agora. Tente enviar novamente ou descreva os alimentos em texto para eu registrar.");
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.processing_error",
      detail: "provider timeout",
    }));
  });
});
