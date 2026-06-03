import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const createWaterLogMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
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

const { handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

type MockResponse = {
  statusCode: number;
  body: unknown;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
};

const riceItem = {
  foodName: "Arroz branco",
  canonicalName: "Arroz branco cozido",
  portionText: "150 g",
  servings: 1,
  estimatedGrams: 150,
  calories: 195,
  protein: 4.1,
  carbs: 42,
  fat: 0.5,
  confidence: 0.9,
  source: "catalog" as const,
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

function createTextWebhookRequest(text: string, options: { id?: string; timestamp?: string } = {}) {
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
                    id: options.id ?? `wamid-${text.length}-${Date.now()}`,
                    from: "5511999999999",
                    timestamp: options.timestamp ?? "1780502400",
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

describe("handleWhatsAppWebhookWithTextIntent", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-03T12:00:00.000Z"));
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookMock.mockReset();
    createWaterLogMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
    handleWhatsAppWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) {
        sentMessages.push(payload.text.body);
      }
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("registra hidratação pela intenção nova e não delega para criação de refeição", async () => {
    const req = createTextWebhookRequest("500 ml de água ontem", {
      id: "water-yesterday",
      timestamp: "1780502400",
    });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(createWaterLogMock).toHaveBeenCalledWith(42, {
      amountMl: 500,
      occurredAt: expect.stringMatching(/^2026-06-02T/),
    });
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.water_logged",
    }));
    expect(sentMessages.at(-1)).toContain("Registrei 500 ml de água");
  });

  it("pede esclarecimento para água sem quantidade e não delega para criação de refeição", async () => {
    const req = createTextWebhookRequest("adicionar água ontem", { id: "water-clarification" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "warning",
      eventType: "whatsapp.intent.clarification_needed",
    }));
    expect(sentMessages.at(-1)).toContain("preciso da quantidade");
  });

  it("ajusta refeição existente e não delega para inferência nutricional", async () => {
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
    const req = createTextWebhookRequest("reduzir 50 gramas do arroz", { id: "reduce-rice" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [expect.objectContaining({
        foodName: "Arroz branco",
        estimatedGrams: 100,
        portionText: "100 g",
        calories: 130,
      })],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
    }));
    expect(sentMessages.at(-1)).toContain("de 150 g para 100 g");
  });

  it("adiciona café sem açúcar à refeição existente e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 12,
        userId: 42,
        mealLabel: "Café da manhã",
        occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime(),
        notes: "Registro pelo WhatsApp",
        items: [riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 12,
      ...input,
    }));
    const req = createTextWebhookRequest("Adicionar 3 xícaras de café sem açúcar a refeição café da manhã", { id: "add-coffee" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 12,
      mealLabel: "Café da manhã",
      items: [
        riceItem,
        expect.objectContaining({
          foodName: "Café sem açúcar",
          portionText: "3 xícaras (150 ml)",
          calories: 6,
        }),
      ],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(sentMessages.at(-1)).toContain("Adicionei 3 xícaras (150 ml) de café sem açúcar");
  });

  it("envia sugestão de lanche e não delega para inferência nutricional", async () => {
    const req = createTextWebhookRequest("Me dê uma sugestão para o lanche da tarde", { id: "snack-suggestion" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_suggestion",
    }));
    expect(sentMessages.at(-1)).toContain("Sugestão para o lanche da tarde");
  });

  it("envia relatório do período e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 20,
        userId: 42,
        mealLabel: "Almoço",
        occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(),
        items: [riceItem],
      },
    ]);
    const req = createTextWebhookRequest("Me envie um resumo da semana", { id: "week-report" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.period_report",
    }));
    expect(sentMessages.at(-1)).toContain("Resumo de semana");
    expect(sentMessages.at(-1)).toContain("Refeições registradas: 1");
  });

  it("mantém texto comum de refeição no fluxo normal de inferência", async () => {
    const req = createTextWebhookRequest("almocei arroz, feijão e frango", { id: "regular-meal" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(handleWhatsAppWebhookMock).toHaveBeenCalledOnce();
    expect(sentMessages).toEqual([]);
  });
});
