import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getHabitSnapshotsMock = vi.fn();
const getUserDayMealTotalsMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const createUserWaterLogMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealInputMock = vi.fn();
const getWhatsAppAccessTokenMock = vi.fn();

vi.mock("./db", () => ({
  buildSavedMedia: vi.fn((input) => input),
  confirmPendingMeal: confirmPendingMealMock,
  createPendingMealInference: createPendingMealInferenceMock,
  createUserWaterLog: createUserWaterLogMock,
  getHabitSnapshots: getHabitSnapshotsMock,
  getUserDayMealTotals: getUserDayMealTotalsMock,
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  getWhatsAppAccessToken: getWhatsAppAccessTokenMock,
  listUserMeals: vi.fn(async () => []),
  logInferenceEvent: logInferenceEventMock,
  relabelUserMeals: vi.fn(async () => []),
}));

vi.mock("./nutritionEngine", () => ({
  processMealInput: processMealInputMock,
}));

vi.mock("./storage", () => ({
  storagePut: vi.fn(),
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

function createTextPayload(text: string) {
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
                  id: "wamid.reply-1",
                  timestamp: "1713708840",
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function outboundTextBodies() {
  return (global.fetch as unknown as { mock: { calls: Array<[string, { body?: string }]> } }).mock.calls
    .map(([, init]) => {
      if (!init?.body) return null;
      try {
        return JSON.parse(init.body).text?.body as string | undefined;
      } catch {
        return null;
      }
    })
    .filter((body): body is string => Boolean(body));
}

describe("whatsappWebhook detailed replies", () => {
  beforeEach(() => {
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    getUserIdByWhatsappPhoneMock.mockResolvedValue(123);
    getHabitSnapshotsMock.mockResolvedValue([]);
    getUserDayMealTotalsMock.mockResolvedValue({ totals: { calories: 795 } });
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    getWhatsAppAccessTokenMock.mockResolvedValue("access-token-test");
    createUserWaterLogMock.mockResolvedValue({ id: 789, userId: 123, amountMl: 250 });
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-reply" });
    confirmPendingMealMock.mockResolvedValue({ id: 456, mealLabel: "Almoço" });
    processMealInputMock.mockResolvedValue({
      detectedMealLabel: "Almoço",
      sourceText: "arroz e frango",
      confidence: 0.91,
      needsConfirmation: true,
      reasoning: "Teste de resposta detalhada.",
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
      totals: { calories: 295, protein: 33.7, carbs: 28, fat: 3.9 },
    });

    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({}),
    })) as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("envia lista de alimentos com macronutrientes por item e comparação com a meta", async () => {
    const req = { body: createTextPayload("arroz e frango") };
    const res = createResponse();

    await handleWhatsAppWebhook(req as never, res as never);

    const replies = outboundTextBodies();
    const finalReply = replies.at(-1) ?? "";

    expect(res.statusCode).toBe(200);
    expect(finalReply).toContain("Almoço Registrado às 11:14hs.");
    expect(finalReply).toContain("Itens:");
    expect(finalReply).toContain("• 🍚 arroz, 100g - 130 Kcal");
    expect(finalReply).toContain("Prot. 2,7 g | Carb. 28 g | Gord. 0,3 g");
    expect(finalReply).toContain("• 🍗 frango, 100g - 165 Kcal");
    expect(finalReply).toContain("Prot. 31 g | Carb. 0 g | Gord. 3,6 g");
    expect(finalReply).toContain("Total da refeição:");
    expect(finalReply).toContain("295 Kcal");
    expect(finalReply).toContain("Prot. 33,7 g | Carb. 28 g | Gord. 3,9 g");
    expect(finalReply).toContain("Meta de hoje:");
    expect(finalReply).toContain("* Meta estimada: 2.200 kcal");
    expect(finalReply).toContain("* Meta ajustada: 2.200 kcal");
    expect(finalReply).toContain("* Consumo: 795 kcal");
    expect(finalReply).toContain("* Déficit: 1.405 kcal");
    expect(finalReply).not.toContain("Alimentos e macros:");
    expect(finalReply).not.toContain("Total estimado:");
  });
});
