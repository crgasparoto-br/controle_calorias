import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createWaterLogMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./whatsappWebhook", () => ({
  handleWhatsAppWebhook: handleWhatsAppWebhookMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("./modules/water/service", () => ({
  createWaterLog: createWaterLogMock,
}));

const { __resetWhatsAppTextIntentContextForTests, handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
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
  };
}

function createTextWebhookRequest(text: string) {
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
                    id: "meal-list-text-query",
                    from: "5511999999999",
                    timestamp: "1781997240",
                    type: "text",
                    text: { body: text },
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

describe("handleWhatsAppWebhookWithTextIntent meal list routing", () => {
  let sentMessages: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T23:14:00.000Z"));
    __resetWhatsAppTextIntentContextForTests();
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    handleWhatsAppWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) {
        sentMessages.push(payload.text.body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("responde consulta textual de alimentos sem cair no erro genérico de mídia", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 2,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Almoço",
        occurredAt: new Date("2026-06-20T15:30:00.000Z").getTime(),
        items: [
          {
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
          },
          {
            foodName: "Frango grelhado",
            canonicalName: "Frango grelhado",
            portionText: "120 g",
            servings: 1,
            estimatedGrams: 120,
            calories: 198,
            protein: 37.2,
            carbs: 0,
            fat: 4.3,
            confidence: 0.9,
            source: "catalog" as const,
          },
        ],
      },
    ]);
    const req = createTextWebhookRequest("listar alimentos do almoço de hoje");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_foods_listed",
    }));
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toContain("Alimentos de Almoço em 20/06/2026:");
    expect(sentMessages[0]).toContain("100 g de Arroz branco - 130 kcal");
    expect(sentMessages[0]).toContain("120 g de Frango grelhado - 198 kcal");
    expect(sentMessages[0]).toContain("Total: 328 kcal");
    expect(sentMessages[0]).not.toContain("Não consegui processar essa mídia agora");
  });
});