import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const createWaterLogMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

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

vi.mock("./modules/water/service", () => ({
  createWaterLog: createWaterLogMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const { __resetWhatsAppTextIntentContextForTests, handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

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
                    id: "food-assistant-message",
                    from: "5511999999999",
                    timestamp: "1780502400",
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

describe("handleWhatsAppWebhookWithTextIntent food assistant", () => {
  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookMock.mockReset();
    createWaterLogMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    listMealsMock.mockResolvedValue([]);
    handleWhatsAppWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) {
        sentMessages.push(payload.text.body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("responde orientação alimentar e não delega para inferência nutricional", async () => {
    const req = createTextWebhookRequest("O que posso comer no jantar?");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.food_assistant",
    }));
    expect(sentMessages.at(-1)).toContain("Sugestão alimentar");
    expect(sentMessages.at(-1)).toContain("Para registrar uma refeição");
  });
});
