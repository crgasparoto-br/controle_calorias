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
const requestWhatsappImageMealIdentityClarificationMock = vi.fn();
const requestWhatsappImageMealQuantityClarificationMock = vi.fn();
const beginInboundMessageMock = vi.fn(async () => null);
const claimMessageForProcessingStateMock = vi.fn(async () => "claimed" as const);
const wasMessageAlreadyProcessedMock = vi.fn(async () => false);

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: beginInboundMessageMock,
  claimMessageForProcessingState: claimMessageForProcessingStateMock,
  wasMessageAlreadyProcessed: wasMessageAlreadyProcessedMock,
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  markMessageProcessed: vi.fn(async () => undefined),
  releaseMessageForRetry: vi.fn(async () => true),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  ensureMessageProcessingOwnership: vi.fn(async () => true),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
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

vi.mock("./nutritionEngine", () => ({ resolveCommercialFoodIdentity: vi.fn(),
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

vi.mock("./modules/whatsapp/foodQuantityClarification", () => ({
  requestWhatsappImageMealIdentityClarification: requestWhatsappImageMealIdentityClarificationMock,
  requestWhatsappImageMealQuantityClarification: requestWhatsappImageMealQuantityClarificationMock,
}));

vi.mock("./modules/whatsapp/goalProgressService", () => ({
  getWhatsAppMealGoalProgress: vi.fn(async () => null),
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

function findFetchCallByBody(expectedBodyPart: string) {
  return vi.mocked(global.fetch).mock.calls.find(([, init]) => {
    const body = init && "body" in init ? init.body : undefined;
    return typeof body === "string" && body.includes(expectedBodyPart);
  });
}

function expectOpaqueImageStorageUrl(value: unknown) {
  expect(value).toEqual(expect.stringMatching(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/));
  expect(value).not.toEqual(expect.stringContaining("5511999999999"));
  expect(value).not.toEqual(expect.stringContaining("image-media-id"));
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
    requestWhatsappImageMealIdentityClarificationMock.mockReset();
    requestWhatsappImageMealQuantityClarificationMock.mockReset();
    beginInboundMessageMock.mockReset();
    beginInboundMessageMock.mockResolvedValue(null);
    claimMessageForProcessingStateMock.mockReset();
    claimMessageForProcessingStateMock.mockResolvedValue("claimed");
    wasMessageAlreadyProcessedMock.mockReset();
    wasMessageAlreadyProcessedMock.mockResolvedValue(false);
    requestWhatsappImageMealIdentityClarificationMock.mockResolvedValue({
      action: "food_clarification_requested",
      reply: "Informe qual é o alimento do item 2 e a quantidade consumida.",
      eventType: "whatsapp.food_clarification.identity_requested",
      detail: "Clarificação de identidade visual persistida.",
    });
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
    confirmPendingMealMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 456,
      mealLabel: input.mealLabel as string,
      occurredAt: input.occurredAt as string,
      notes: input.notes as string | undefined,
      items: input.items as Array<Record<string, unknown>>,
    }));
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
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          url: "https://media.test/image-download",
          mime_type: "image/jpeg",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("image-test")); controller.close(); } }),
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

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expectMessageMarkedAsRead("wamid.image-inline");
    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: undefined,
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
      occurredAt: expect.any(Date),
      timeZone: "America/Sao_Paulo",
    }));
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({ imageUrl: expect.stringMatching(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/) }),
      [expect.objectContaining({ storageUrl: expect.stringMatching(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/), mediaType: "image" })],
    );
    const [, , processed, media] = createPendingMealInferenceMock.mock.calls[0];
    expectOpaqueImageStorageUrl(processed.imageUrl);
    expectOpaqueImageStorageUrl(media[0].storageUrl);
    expect(media[0].storageKey).toEqual(expect.stringMatching(/^whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/));
    expect(media[0].originalFileName).toEqual(expect.stringMatching(/^image-[0-9a-f-]{36}\.jpg$/));
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
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "47g",
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
      occurredAt: expect.any(Date),
      timeZone: "America/Sao_Paulo",
    }));
  });

  it("persiste e responde com a mesma identidade e os mesmos nutrientes do produto com marca", async () => {
    processMealInputMock.mockResolvedValueOnce({
      detectedMealLabel: "Lanche",
      sourceText: "",
      confidence: 0.93,
      needsConfirmation: true,
      reasoning: "Marca e variante reconhecidas no rótulo.",
      items: [{
        foodName: "Cerveja Weissbier Marca Aurora",
        canonicalName: "Cerveja Marca Aurora Weissbier",
        brand: "Marca Aurora",
        portionText: "1 garrafa (500 ml)",
        quantity: 500,
        unit: "ml",
        servings: 1,
        estimatedGrams: 500,
        calories: 211,
        protein: 2.4,
        carbs: 17.3,
        fat: 0,
        confidence: 0.92,
        source: "catalog" as const,
      }],
      totals: { calories: 211, protein: 2.4, carbs: 17.3, fat: 0 },
    });

    const req = { body: createMetaImagePayload("wamid.image-brand-consistency") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({
        items: [expect.objectContaining({
          foodName: "Cerveja Weissbier Marca Aurora",
          brand: "Marca Aurora",
          calories: 211,
          protein: 2.4,
          carbs: 17.3,
          fat: 0,
        })],
        totals: { calories: 211, protein: 2.4, carbs: 17.3, fat: 0 },
      }),
      expect.any(Array),
    );
    const replyCall = findFetchCallByBody("Cerveja Weissbier Marca Aurora");
    expect(replyCall?.[1]).toEqual(expect.objectContaining({
      body: expect.stringContaining("211 kcal | P 2,4 g | C 17,3 g | G 0 g"),
    }));
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
  });

  it("reconhece duas latas de Spaten Munich sem perder marca, variante ou quantidade", async () => {
    processMealInputMock.mockResolvedValueOnce({
      detectedMealLabel: "Bebidas",
      sourceText: "",
      confidence: 0.96,
      needsConfirmation: true,
      reasoning: "As duas latas exibem marca e linha legíveis.",
      items: [{
        foodName: "Cerveja Spaten Munich",
        canonicalName: "Cerveja Spaten Munich",
        brand: "Spaten",
        portionText: "1 lata (350 ml)",
        quantity: 2,
        unit: "lata",
        servings: 2,
        estimatedGrams: 700,
        calories: 294,
        protein: 2.8,
        carbs: 22,
        fat: 0,
        confidence: 0.96,
        source: "catalog" as const,
        resolution: {
          nutritionOrigin: "catalog" as const,
          nutritionVerified: true,
          productVariant: "Munich",
          sourceEvidence: "Catálogo comercial Spaten Munich 350 ml",
        },
      }],
      totals: { calories: 294, protein: 2.8, carbs: 22, fat: 0 },
    });

    const res = createResponse();
    await handleWhatsAppWebhook(
      { body: createMetaImagePayload("wamid.image-spaten-munich") } as never,
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(createPendingMealInferenceMock).toHaveBeenCalledWith(
      123,
      "whatsapp",
      expect.objectContaining({
        items: [expect.objectContaining({
          foodName: "Cerveja Spaten Munich",
          canonicalName: "Cerveja Spaten Munich",
          brand: "Spaten",
          quantity: 2,
          unit: "lata",
          portionText: "1 lata (350 ml)",
          resolution: expect.objectContaining({ productVariant: "Munich" }),
        })],
        totals: { calories: 294, protein: 2.8, carbs: 22, fat: 0 },
      }),
      expect.any(Array),
    );
    expect(findFetchCallByBody("Cerveja Spaten Munich")).toBeTruthy();
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
  });

  it("preserva itens reconhecidos e abre identidade somente para o item ambíguo", async () => {
    processMealInputMock.mockResolvedValueOnce({
      detectedMealLabel: "Lanche",
      sourceText: "",
      imageUrl: "data:image/jpeg;base64,image-test",
      confidence: 0.88,
      needsConfirmation: true,
      reasoning: "Dois produtos visíveis; um item não tem identidade confiável.",
      items: [
        {
          foodName: "Cerveja Lager",
          canonicalName: "Cerveja Lager",
          portionText: "1 lata (350 ml)",
          quantity: 350,
          unit: "ml",
          servings: 1,
          estimatedGrams: 350,
          calories: 140,
          protein: 1.2,
          carbs: 10,
          fat: 0,
          confidence: 0.92,
          source: "heuristic" as const,
        },
        {
          foodName: "item 2",
          canonicalName: "item 2",
          portionText: "1 unidade",
          quantity: 1,
          unit: "unidade",
          servings: 1,
          estimatedGrams: 100,
          calories: 100,
          protein: 3,
          carbs: 10,
          fat: 2,
          confidence: 0.42,
          source: "heuristic" as const,
        },
      ],
      totals: { calories: 240, protein: 4.2, carbs: 20, fat: 2 },
    });

    const req = { body: createMetaImagePayload("wamid.image-partial-identity") };
    const res = createResponse();
    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(requestWhatsappImageMealIdentityClarificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingItemIndexes: [1],
        currentItemIndex: 1,
        items: expect.arrayContaining([
          expect.objectContaining({ foodName: "Cerveja Lager" }),
          expect.objectContaining({ foodName: "item 2" }),
        ]),
        semanticContract: expect.objectContaining({
          clarifications: [expect.objectContaining({
            itemIndex: 1,
            code: "image_identity_unresolved",
          })],
        }),
      }),
    );
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(findFetchCallByBody("Informe qual é o alimento do item 2")).toBeTruthy();
    expect(findFetchCallByBody("Não consegui identificar o alimento na imagem")).toBeUndefined();
  });

  it("envia imagem anotada quando o overlay local retorna URL", async () => {
    createLocalMealPhotoOverlayMock.mockResolvedValueOnce({
      url: "https://storage.test/generated/meal-support/annotated.png",
      storageKey: "generated/meal-support/annotated.png",
      mimeType: "image/png",
      buffer: Buffer.from("local-overlay-png"),
      detail: "Overlay local aplicado sobre a foto original da refeição.",
    });
    vi.mocked(global.fetch).mockResolvedValueOnce(createWhatsAppOkResponse() as never);

    const req = { body: createMetaImagePayload("wamid.image-annotated") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const expectedB64 = Buffer.from("image-test").toString("base64");

    expect(res.statusCode).toBe(200);
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledWith(expect.objectContaining({
      image: expect.objectContaining({
        mimeType: "image/jpeg",
        b64Json: expectedB64,
      }),
      processed: expect.objectContaining({
        items: expect.arrayContaining([expect.objectContaining({ foodName: "frango" })]),
      }),
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
      expect.objectContaining({ imageUrl: expect.stringMatching(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/) }),
      [
        expect.objectContaining({
          mediaType: "image",
          storageUrl: expect.stringMatching(/^https:\/\/storage\.test\/whatsapp\/image\/image-[0-9a-f-]{36}\.jpg$/),
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
    const [, , processed, media] = createPendingMealInferenceMock.mock.calls[0];
    expectOpaqueImageStorageUrl(processed.imageUrl);
    expectOpaqueImageStorageUrl(media[0].storageUrl);
    expect(processMealInputMock).toHaveBeenCalled();
  });

  it("não envia imagem quando o overlay local falha", async () => {
    createLocalMealPhotoOverlayMock.mockRejectedValueOnce(new Error("Provider de imagem falhou; fallback local de classificação gerado."));
    vi.mocked(global.fetch).mockResolvedValueOnce(createWhatsAppOkResponse() as never);

    const req = { body: createMetaImagePayload("wamid.image-cards-fallback") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(createLocalMealPhotoOverlayMock).toHaveBeenCalledTimes(1);

    const imageSendCall = findFetchCallByBody('"type":"image"');
    expect(imageSendCall).toBeFalsy();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.annotated_image_skipped",
      status: "warning",
      detail: expect.stringContaining("registro nutricional foi preservado"),
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
    expect(createUserWaterLogMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: undefined,
      transcript: undefined,
      imageUrl: expectedDataUrl,
      audioUrl: undefined,
      habits: [],
      occurredAt: expect.any(Date),
      timeZone: "America/Sao_Paulo",
    }));
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
    wasMessageAlreadyProcessedMock
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
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
    expect(findFetchCallByBody("Recebi sua imagem e estou processando")).toBeFalsy();
    const acknowledgementCalls = vi.mocked(global.fetch).mock.calls.filter(([, init]) => {
      const body = init && "body" in init ? init.body : undefined;
      return typeof body === "string" && body.includes("Recebi sua imagem e estou processando");
    });
    expect(acknowledgementCalls).toHaveLength(0);
  });

  it("responde retryable quando outro owner persistente processa a mesma imagem", async () => {
    beginInboundMessageMock.mockResolvedValue({
      conversationId: 1,
      messageId: 99,
      wasNewInsert: false,
    });
    claimMessageForProcessingStateMock
      .mockResolvedValueOnce("claimed")
      .mockResolvedValueOnce("inflight");

    const req = { body: createMetaImagePayload("wamid.image-inflight") };
    const firstRes = createResponse();
    await handleWhatsAppWebhook(req as never, firstRes as never);

    __resetWhatsAppWebhookDeduplicationForTests();
    const secondRes = createResponse();
    await handleWhatsAppWebhook(req as never, secondRes as never);

    expect(firstRes.statusCode).toBe(200);
    expect(secondRes.statusCode).toBe(503);
    expect(secondRes.body).toEqual({
      ok: false,
      retryable: true,
      reason: "message_processing_inflight",
    });
    expect(processMealInputMock).toHaveBeenCalledTimes(1);
    expect(createPendingMealInferenceMock).toHaveBeenCalledTimes(1);
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
  });

  it("mantém a imagem retryable quando a resposta primária é rejeitada pelo provider", async () => {
    beginInboundMessageMock.mockResolvedValue({
      conversationId: 1,
      messageId: 101,
      wasNewInsert: true,
    });
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(createWhatsAppOkResponse())
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://media.test/image-download", mime_type: "image/jpeg" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("image-test"));
            controller.close();
          },
        }),
        headers: { get: () => "image/jpeg" },
      })
      .mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: "provider unavailable" }) }) as typeof fetch;

    const res = createResponse();
    await handleWhatsAppWebhook(
      { body: createMetaImagePayload("wamid.image-provider-retry") } as never,
      res as never,
    );

    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      ok: false,
      retryable: true,
      reason: "whatsapp_reply_delivery_failed",
    });
  });
});
