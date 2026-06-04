import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createWaterLogMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const getUserIdByWhatsappPhoneMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const transcribeAudioMock = vi.fn();

vi.mock("./modules/water/service", () => ({
  createWaterLog: createWaterLogMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input: Record<string, unknown>) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  createUserWaterLog: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  listUserMeals: vi.fn(async () => []),
  logInferenceEvent: logInferenceEventMock,
  relabelUserMeals: vi.fn(),
  updateUserCurrentWeight: vi.fn(),
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(async (key: string, _buffer: Buffer, mimeType: string) => ({
    key,
    url: `https://storage.test/${key}`,
    mimeType,
  })),
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({
    phoneNumberId: "phone-number-test",
    verifyToken: "verify-token-test",
  }),
  requireWhatsAppMediaConfig: async () => ({ accessToken: "access-token-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./_core/voiceTranscription", () => ({
  transcribeAudio: transcribeAudioMock,
}));

vi.mock("./nutritionEngine", async () => {
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return {
    ...actual,
    processMealInput: processMealInputMock,
  };
});

vi.mock("./_core/imageGeneration", () => ({
  generateImage: vi.fn(async () => ({ skippedReason: "disabled_in_test" })),
}));

const { handleWhatsAppWebhook } = await import("./whatsappWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

let sentMessages: string[];

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

function createWebhookRequest(message: Record<string, unknown>) {
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
                messages: [message],
              },
            },
          ],
        },
      ],
    },
  };
}

function mockNutritionResult() {
  return {
    detectedMealLabel: "Almoço",
    sourceText: "caption de teste",
    confidence: 0.91,
    needsConfirmation: true,
    reasoning: "Inferência simulada.",
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
  };
}

const riceItem = {
  foodName: "Arroz branco",
  canonicalName: "Arroz branco cozido",
  portionText: "100 g",
  servings: 1,
  estimatedGrams: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("handleWhatsAppWebhook media text intents", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    sentMessages = [];
    createWaterLogMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockReset();
    logInferenceEventMock.mockReset();
    processMealInputMock.mockReset();
    confirmPendingMealMock.mockReset();
    createPendingMealInferenceMock.mockReset();
    transcribeAudioMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
    processMealInputMock.mockResolvedValue(mockNutritionResult());
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-1" });
    confirmPendingMealMock.mockImplementation(async (input: Record<string, unknown>) => ({
      id: 10,
      mealLabel: input.mealLabel,
    }));

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages")) {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (payload?.text?.body) {
          sentMessages.push(payload.text.body);
        }
        return { ok: true, json: async () => ({}) } as Response;
      }

      if (url.includes("graph.facebook.com")) {
        return {
          ok: true,
          json: async () => ({
            url: url.includes("audio-media-id") ? "https://media.test/audio" : "https://media.test/image",
            mime_type: url.includes("audio-media-id") ? "audio/ogg" : "image/jpeg",
          }),
        } as Response;
      }

      return {
        ok: true,
        headers: { get: () => (url.includes("audio") ? "audio/ogg" : "image/jpeg") },
        arrayBuffer: async () => new TextEncoder().encode("binary-media").buffer,
      } as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("interpreta áudio transcrito como hidratação e não chama inferência nutricional", async () => {
    transcribeAudioMock.mockResolvedValue({
      text: "500 ml de água ontem",
      language: "pt",
      segments: [],
    });
    const req = createWebhookRequest({
      id: "audio-water-intent",
      from: "5511999999999",
      timestamp: "1780502400",
      type: "audio",
      audio: { id: "audio-media-id", mime_type: "audio/ogg" },
    });
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(createWaterLogMock).toHaveBeenCalledWith(42, {
      amountMl: 500,
      occurredAt: expect.stringMatching(/^2026-06-02T/),
    });
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.water_logged",
    }));
    expect(sentMessages[0]).toBe("Recebi seu áudio e estou processando.");
    expect(sentMessages.at(-1)).toContain("Registrei 500 ml de água");
  });

  it("interpreta áudio transcrito como incremento de gramas e não chama inferência nutricional", async () => {
    transcribeAudioMock.mockResolvedValue({
      text: "somar 45g ao arroz",
      language: "pt",
      segments: [],
    });
    listMealsMock.mockResolvedValue([
      {
        id: 10,
        userId: 42,
        mealLabel: "Almoço",
        occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(),
        notes: "Registro pelo WhatsApp",
        items: [riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 10,
      ...input,
    }));
    const req = createWebhookRequest({
      id: "audio-increment-rice-intent",
      from: "5511999999999",
      timestamp: "1780502400",
      type: "audio",
      audio: { id: "audio-media-id", mime_type: "audio/ogg" },
    });
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [expect.objectContaining({ foodName: "Arroz branco", estimatedGrams: 145, portionText: "145 g", calories: 188.5 })],
    }));
    expect(processMealInputMock).not.toHaveBeenCalled();
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    expect(createPendingMealInferenceMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
    }));
    expect(sentMessages[0]).toBe("Recebi seu áudio e estou processando.");
    expect(sentMessages.at(-1)).toContain("de 100 g para 145 g");
  });

  it("mantém caption de imagem no fluxo multimodal normal", async () => {
    const req = createWebhookRequest({
      id: "image-caption-water-text",
      from: "5511999999999",
      timestamp: "1780502400",
      type: "image",
      image: {
        id: "image-media-id",
        mime_type: "image/jpeg",
        caption: "500 ml de água ontem",
      },
    });
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(processMealInputMock).toHaveBeenCalledWith(expect.objectContaining({
      text: "500 ml de água ontem",
      imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/),
    }));
    expect(confirmPendingMealMock).toHaveBeenCalled();
    expect(sentMessages[0]).toBe("Recebi sua imagem e estou processando.");
  });
});
