import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const foodAssistantIntentMock = vi.fn();
const annotatedWebhookMock = vi.fn();
const listMealsMock = vi.fn();

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

vi.mock("./modules/whatsapp/intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

vi.mock("./modules/whatsapp/llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));

vi.mock("./modules/whatsapp/foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: foodAssistantIntentMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
}));

vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: annotatedWebhookMock,
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
                metadata: { phone_number_id: "phone-number-test" },
                messages: [
                  {
                    id: `wamid-${text.length}`,
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

describe("handleWhatsAppWebhookWithTextIntent com LLM contextual", () => {
  let sentMessages: string[];

  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    foodAssistantIntentMock.mockReset();
    annotatedWebhookMock.mockReset();
    listMealsMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    foodAssistantIntentMock.mockReturnValue(null);
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    listMealsMock.mockResolvedValue([]);
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) sentMessages.push(payload.text.body);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("responde intencao contextual do LLM antes do fallback nutricional", async () => {
    executeWhatsappLlmIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "llm_intent_list_meal_records",
      reply: "Refeicoes registradas hoje:\n\n• Almoço: 130 kcal",
      eventType: "whatsapp.llm_intent.list_meal_records",
      detail: "Consulta estruturada de refeicoes respondida pelo WhatsApp.",
    });
    const req = createTextWebhookRequest("quais refeições eu registrei hoje?");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(executeWhatsappLlmIntentMock).toHaveBeenCalledWith(42, expect.objectContaining({ text: "quais refeições eu registrei hoje?" }));
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.llm_intent.list_meal_records",
    }));
    expect(sentMessages.at(-1)).toContain("Refeicoes registradas hoje");
  });

  it("mantem texto comum no fluxo nutricional quando a camada LLM nao trata", async () => {
    const req = createTextWebhookRequest("almocei arroz, feijão e frango");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(executeWhatsappLlmIntentMock).toHaveBeenCalled();
    expect(annotatedWebhookMock).toHaveBeenCalledOnce();
    expect(sentMessages).toEqual([]);
  });
});
