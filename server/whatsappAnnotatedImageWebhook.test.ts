import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserDayMealTotalsMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const listUserMealsMock = vi.fn();
const removeUserMealMock = vi.fn();
const updateUserMealMock = vi.fn();
const processMealInputMock = vi.fn();
const generateImageMock = vi.fn();
const createLocalMealPhotoOverlayMock = vi.fn();
const storagePutMock = vi.fn();
const fallbackWebhookMock = vi.fn();
const getAnnotatedImagePreferenceMock = vi.fn();
const { beginInboundMessageMock, recordOutboundReplyMock, recordDomainLinkMock, markMessageProcessedMock } = vi.hoisted(() => ({
  beginInboundMessageMock: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  recordOutboundReplyMock: vi.fn(async () => undefined),
  recordDomainLinkMock: vi.fn(async () => undefined),
  markMessageProcessedMock: vi.fn(async () => undefined),
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: beginInboundMessageMock,
  recordOutboundReply: recordOutboundReplyMock,
  recordDomainLink: recordDomainLinkMock,
  markMessageProcessed: markMessageProcessedMock,
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
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
  listUserMeals: listUserMealsMock,
  logInferenceEvent: logInferenceEventMock,
  removeUserMeal: removeUserMealMock,
  updateUserMeal: updateUserMealMock,
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

vi.mock("./modules/whatsapp/annotatedImagePreference", () => ({
  getAnnotatedImagePreference: getAnnotatedImagePreferenceMock,
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

const savedImageMeal = {
  id: 10,
  userId: 42,
  source: "whatsapp",
  mealLabel: "Almoço",
  occurredAt: "2026-06-03T13:00:00.000Z",
  notes: "meu almoço",
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
};

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
    listUserMealsMock.mockReset();
    removeUserMealMock.mockReset();
    updateUserMealMock.mockReset();
    processMealInputMock.mockReset();
    generateImageMock.mockReset();
    createLocalMealPhotoOverlayMock.mockReset();
    storagePutMock.mockReset();
    fallbackWebhookMock.mockReset();
    getAnnotatedImagePreferenceMock.mockReset();
    beginInboundMessageMock.mockReset();
    recordOutboundReplyMock.mockReset();
    recordDomainLinkMock.mockReset();
    markMessageProcessedMock.mockReset();
    beginInboundMessageMock.mockResolvedValue({ conversationId: 1, messageId: 1 });

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getAnnotatedImagePreferenceMock.mockResolvedValue({ enabled: true, readFailed: false });
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
      items: savedImageMeal.items,
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
      ...savedImageMeal,
      mealLabel: input.mealLabel as string,
      occurredAt: input.occurredAt as string,
      notes: input.notes as string | undefined,
      items: input.items as typeof savedImageMeal.items,
    }));
    listUserMealsMock.mockResolvedValue([savedImageMeal]);
    updateUserMealMock.mockImplementation(async (input: Record<string, unknown>) => ({
      ...savedImageMeal,
      id: input.mealId,
      mealLabel: input.mealLabel,
      occurredAt: input.occurredAt,
      notes: input.notes,
      items: input.items,
    }));
    removeUserMealMock.mockResolvedValue(undefined);
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
    // Fast path (#785): sem acknowledgement, apenas a resposta funcional final.
    expect(sentTextMessages).toHaveLength(1);
    expect(sentTextMessages[0]).toContain("🍽️ *Almoço* — 13:00");
    expect(sentTextMessages[0]).toContain("*Meta:* 2.200 kcal");
    expect(sentTextMessages[0]).toContain("*Exercícios:* 0 kcal");
    expect(sentTextMessages[0]).toContain("*Consumo:* 1.620 kcal");
    expect(sentTextMessages[0]).toContain("*Déficit:* 580 kcal (-26%)");
    expect(sentTextMessages[0]).not.toContain("Meta estimada");
    expect(sentTextMessages[0]).not.toContain("Meta ajustada");
    expect(uploadedMediaRequests).toBe(0);
    expect(sentImageMessages).toEqual([
      {
        link: "https://storage.test/generated/meal-support/annotated.png",
        id: undefined,
        caption: "Imagem anotada com os alimentos identificados.",
      },
    ]);
    expect(beginInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      contentType: "image",
      captionText: "meu almoço",
    }));
    expect(recordDomainLinkMock).toHaveBeenCalledWith({ conversationId: 1, messageId: 1 }, { mealId: 10 });
    expect(recordOutboundReplyMock).toHaveBeenCalledWith(
      { conversationId: 1, messageId: 1 },
      expect.objectContaining({ userId: 42, text: expect.stringContaining("Almoço Registrado") }),
    );
    expect(markMessageProcessedMock).toHaveBeenCalledWith({ conversationId: 1, messageId: 1 });
  });

  it("mantém a foto original e a resposta textual sem gerar ou persistir imagem anotada quando desabilitada", async () => {
    getAnnotatedImagePreferenceMock.mockResolvedValue({ enabled: false, readFailed: false });

    const res = createResponse();
    await handleWhatsAppWebhookWithTextIntent(createImageWebhookRequest("image-disabled") as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createLocalMealPhotoOverlayMock).not.toHaveBeenCalled();
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      42,
      "whatsapp",
      expect.any(Object),
      [expect.objectContaining({ storageKey: expect.stringContaining("whatsapp/image/") })],
    );
    expect(sentTextMessages).toHaveLength(1);
    expect(sentImageMessages).toHaveLength(0);
    expect(logInferenceEventMock).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: expect.stringMatching(/annotated_image_(skipped|reply_failed)/),
    }));
  });

  it("consolida a foto na refeição lógica existente do mesmo dia", async () => {
    const existingLunch = {
      ...savedImageMeal,
      id: 7,
      mealLabel: "Almoço",
      occurredAt: "2026-06-03T12:30:00.000Z",
      items: [
        {
          foodName: "Feijão",
          canonicalName: "Feijão cozido",
          portionText: "100 g",
          servings: 1,
          estimatedGrams: 100,
          calories: 90,
          protein: 5,
          carbs: 15,
          fat: 1,
          confidence: 0.9,
          source: "catalog" as const,
        },
      ],
    };
    listUserMealsMock.mockResolvedValue([savedImageMeal, existingLunch]);
    updateUserMealMock.mockImplementation(async input => ({
      ...existingLunch,
      id: input.mealId,
      items: input.items,
    }));

    const req = createImageWebhookRequest("image-consolidated-with-lunch");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateUserMealMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      mealId: 7,
      mealLabel: "Almoço",
      items: [...existingLunch.items, ...savedImageMeal.items],
    }));
    expect(removeUserMealMock).toHaveBeenCalledWith(42, 10);
    expect(sentTextMessages[0]).toContain("*Almoço Atualizado às 13:00hs.*");
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

  it("mantém somente a resposta nutricional quando a imagem anotada não pode ser gerada", async () => {
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
    expect(sentTextMessages.at(-1)).toContain("Almoço");
    expect(sentTextMessages).not.toContain("A refeição foi registrada, mas não consegui gerar a imagem anotada agora. Você já pode acompanhar o resumo nutricional acima.");
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
    // Fast path (#785): sem acknowledgement; erro central sanitizado (#787).
    expect(sentTextMessages).toHaveLength(1);
    expect(sentTextMessages.at(-1)).toContain("*⚠️ Não foi possível processar a imagem*");
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      status: "error",
      eventType: "whatsapp.processing_error",
      detail: "provider timeout",
    }));
  });

  it("usa o estado persistido ao responder uma refeição nova criada por imagem", async () => {
    const persistedMeal = {
      ...savedImageMeal,
      items: [{
        ...savedImageMeal.items[0],
        foodName: "Arroz persistido da imagem",
        portionText: "120 g",
        estimatedGrams: 120,
        calories: 156,
        protein: 3.2,
        carbs: 33.6,
        fat: 0.4,
      }],
    };
    confirmPendingMealMock.mockResolvedValue(persistedMeal);
    listUserMealsMock.mockResolvedValue([persistedMeal]);

    const req = createImageWebhookRequest("image-persisted-domain-state");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(sentTextMessages[0]).toContain("Arroz persistido da imagem — 120g");
    expect(sentTextMessages[0]).toContain("156 kcal | P 3,2 g | C 33,6 g | G 0,4 g");
    expect(sentTextMessages[0]).not.toContain("• 🍚 arroz — 100g");
  });
});
