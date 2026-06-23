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
const processProfessionalAccessWhatsappResponseMock = vi.fn();

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

vi.mock("./modules/professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
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
    processProfessionalAccessWhatsappResponseMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    foodAssistantIntentMock.mockReturnValue(null);
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    listMealsMock.mockResolvedValue([]);
    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) sentMessages.push(payload.text.body);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("processa decisão profissional antes dos fluxos de nutrição", async () => {
    processProfessionalAccessWhatsappResponseMock.mockResolvedValueOnce({
      handled: true,
      action: "professional_access_approved",
      reply: "Autorização confirmada.",
      eventType: "professional.access.whatsapp_approved",
      detail: "Solicitação de acompanhamento aprovada via WhatsApp.",
    });
    const req = createTextWebhookRequest("AUTORIZAR ABCD1234");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processProfessionalAccessWhatsappResponseMock).toHaveBeenCalledWith(42, "AUTORIZAR ABCD1234");
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(foodAssistantIntentMock).not.toHaveBeenCalled();
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "professional.access.whatsapp_approved",
    }));
    expect(sentMessages.at(-1)).toBe("Autorização confirmada.");
  });

  it("responde lista de refeições antes do LLM e do fallback nutricional", async () => {
    listMealsMock.mockResolvedValueOnce([
      {
        id: 10,
        mealLabel: "Almoço",
        occurredAt: "2026-06-03T15:00:00.000Z",
        items: [
          { foodName: "Arroz", portionText: "100 g", calories: 130, protein: 2.7, carbs: 28, fat: 0.3 },
        ],
      },
    ]);
    const req = createTextWebhookRequest("quais refeições eu registrei hoje?");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(processProfessionalAccessWhatsappResponseMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(foodAssistantIntentMock).not.toHaveBeenCalled();
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_foods_listed",
    }));
    expect(sentMessages.at(-1)).toContain("Alimentos registrados");
    expect(sentMessages.at(-1)).toContain("Almoço");
    expect(sentMessages.at(-1)).toContain("Arroz");
  });

  it("normaliza comando curto de resumo antes do fallback nutricional", async () => {
    executeWhatsappTextIntentMock.mockResolvedValueOnce({
      handled: true,
      action: "period_report",
      reply: "Resumo de hoje enviado.",
      eventType: "whatsapp.intent.period_report",
      detail: "Resumo diário enviado pelo WhatsApp.",
      data: {
        start: "2026-06-03T03:00:00.000Z",
        end: "2026-06-04T02:59:59.000Z",
        periodLabel: "hoje",
      },
    });
    const req = createTextWebhookRequest("Resuma");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(executeWhatsappTextIntentMock).toHaveBeenCalledWith(42, expect.objectContaining({ text: "Resumo hoje" }));
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(foodAssistantIntentMock).not.toHaveBeenCalled();
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.period_report",
    }));
    expect(sentMessages.at(-1)).toContain("Resumo de hoje");
  });

  it("mantem texto comum no fluxo nutricional sem chamar a camada LLM", async () => {
    const req = createTextWebhookRequest("almocei arroz, feijão e frango");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(processProfessionalAccessWhatsappResponseMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(annotatedWebhookMock).toHaveBeenCalledOnce();
    expect(sentMessages).toEqual([]);
  });
});