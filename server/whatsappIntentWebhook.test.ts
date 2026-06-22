import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const createWaterLogMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const tryCreateQuickEditLinkForMealMock = vi.fn();

vi.mock("./db", () => ({
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
}));

vi.mock("./modules/quickEdit/service", () => ({
  tryCreateQuickEditLinkForMeal: tryCreateQuickEditLinkForMealMock,
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

const bananaItem = {
  foodName: "Banana",
  canonicalName: "Banana prata",
  portionText: "120 g",
  servings: 1,
  estimatedGrams: 120,
  calories: 106,
  protein: 1.3,
  carbs: 27.6,
  fat: 0.4,
  confidence: 0.9,
  source: "catalog" as const,
};

const mayonnaiseItem = {
  foodName: "Maionese",
  canonicalName: "Maionese",
  portionText: "30 g",
  servings: 1,
  estimatedGrams: 30,
  calories: 198,
  protein: 0.3,
  carbs: 0.4,
  fat: 21,
  confidence: 0.9,
  source: "catalog" as const,
};

let sentMessages: string[];
let sentPayloads: Record<string, any>[];

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
    __resetWhatsAppTextIntentContextForTests();
    sentMessages = [];
    sentPayloads = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookMock.mockReset();
    createWaterLogMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    tryCreateQuickEditLinkForMealMock.mockReset();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
    tryCreateQuickEditLinkForMealMock.mockResolvedValue(null);
    handleWhatsAppWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      sentPayloads.push(payload);
      const text = payload?.text?.body ?? payload?.interactive?.body?.text;
      if (text) {
        sentMessages.push(text);
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
    listMealsMock.mockResolvedValue([{ id: 10, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 10, ...input }));
    const req = createTextWebhookRequest("reduzir 50 gramas do arroz", { id: "reduce-rice" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [expect.objectContaining({ foodName: "Arroz branco", estimatedGrams: 100, portionText: "100 g", calories: 130 })],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_grams_adjusted" }));
    expect(sentMessages.at(-1)).toContain("de 150 g para 100 g");
  });

  it("envia botão de edição rápida ao ajustar refeição existente por texto", async () => {
    listMealsMock.mockResolvedValue([{ id: 10, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 10, ...input }));
    tryCreateQuickEditLinkForMealMock.mockResolvedValue({
      token: "token-test",
      url: "https://app.example.com/quick-edit/token-test",
      expiresAt: new Date("2026-06-04T12:00:00.000Z").toISOString(),
    });
    const req = createTextWebhookRequest("reduzir 50 gramas do arroz", { id: "reduce-rice-quick-edit" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(tryCreateQuickEditLinkForMealMock).toHaveBeenCalledWith({ userId: 42, mealId: 10 });
    const lastPayload = sentPayloads.at(-1);
    expect(lastPayload?.interactive?.type).toBe("cta_url");
    expect(lastPayload?.interactive?.action?.parameters?.display_text).toBe("Editar refeição");
    expect(lastPayload?.interactive?.action?.parameters?.url).toBe("https://app.example.com/quick-edit/token-test");
    expect(sentMessages.at(-1)).toContain("de 150 g para 100 g");
  });

  it("soma gramas ao alimento existente e não delega para inferência nutricional", async () => {
    const currentRiceItem = {
      ...riceItem,
      portionText: "100 g",
      estimatedGrams: 100,
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
    };
    listMealsMock.mockResolvedValue([{ id: 10, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [currentRiceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 10, ...input }));
    const req = createTextWebhookRequest("somar 45g ao arroz", { id: "increment-rice" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [expect.objectContaining({ foodName: "Arroz branco", estimatedGrams: 145, portionText: "145 g", calories: 188.5 })],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_grams_adjusted" }));
    expect(sentMessages.at(-1)).toContain("de 100 g para 145 g");
    expect(sentMessages.at(-1)).toContain("recalculei os macros");
  });

  it("substitui gramas do alimento existente e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([{ id: 13, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-03T18:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [bananaItem, riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 13, ...input }));
    const req = createTextWebhookRequest("Mudar banana para 79g", { id: "replace-banana-grams" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 13,
      mealLabel: "Lanche",
      items: [expect.objectContaining({ foodName: "Banana", estimatedGrams: 79, portionText: "79 g", calories: 69.8 }), riceItem],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_grams_adjusted" }));
    expect(sentMessages.at(-1)).toContain("de 120 g para 79 g");
  });

  it("troca alimento existente, recalcula macros e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([{ id: 14, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-03T18:00:00.000Z").getTime(), notes: "Registro por imagem", items: [mayonnaiseItem, riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 14, ...input }));
    const req = createTextWebhookRequest("troque a maionese por requeijão", { id: "replace-food" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 14,
      mealLabel: "Lanche",
      items: [expect.objectContaining({ foodName: "requeijão", canonicalName: "requeijão", estimatedGrams: 30, calories: 45, source: "heuristic" }), riceItem],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_replaced" }));
    expect(sentMessages.at(-1)).toContain("recalculei os macros");
    expect(sentMessages.at(-1)).toContain("45 kcal");
  });

  it("adiciona café sem açúcar à refeição existente e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([{ id: 12, userId: 42, mealLabel: "Café da manhã", occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 12, ...input }));
    const req = createTextWebhookRequest("Adicionar 3 xícaras de café sem açúcar a refeição café da manhã", { id: "add-coffee" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 12,
      mealLabel: "Café da manhã",
      items: [riceItem, expect.objectContaining({ foodName: "Café sem açúcar", portionText: "3 xícaras (150 ml)", calories: 6 })],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_added" }));
    expect(sentMessages.at(-1)).toContain("Adicionei 3 xícaras (150 ml) de café sem açúcar");
  });

  it("envia sugestão de lanche e não delega para inferência nutricional", async () => {
    const req = createTextWebhookRequest("Me dê uma sugestão para o lanche da tarde", { id: "snack-suggestion" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_suggestion" }));
    expect(sentMessages.at(-1)).toContain("Sugestão para o lanche da tarde");
  });

  it("envia relatório do período considerando calorias gastas em exercícios", async () => {
    listMealsMock.mockResolvedValue([{ id: 20, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), items: [riceItem] }]);
    listUserExercisesMock.mockResolvedValue([{ id: 30, userId: 42, activityType: "Corrida", durationMinutes: 30, caloriesBurned: 300, occurredAt: new Date("2026-06-03T16:00:00.000Z").getTime() }]);
    const req = createTextWebhookRequest("Me envie um resumo da semana", { id: "week-report" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.period_report" }));
    expect(sentMessages.at(-1)).toContain("*Resumo de semana:*");
    expect(sentMessages.at(-1)).toContain("Refeições registradas: 1");
    expect(sentMessages.at(-1)).toContain("Almoço: 195 kcal");
    expect(sentMessages.at(-1)).toContain("* Prot. 4,1 g | Carb. 42 g | Gord. 0,5 g");
    expect(sentMessages.at(-1)).not.toContain("Total consumido:");
    expect(sentMessages.at(-1)).toContain("Meta do *resumo:*");
    expect(sentMessages.at(-1)).toContain("* Meta estimada: 15.400 kcal");
    expect(sentMessages.at(-1)).toContain("* Exercícios: 300 kcal");
    expect(sentMessages.at(-1)).toContain("* Meta ajustada: 15.700 kcal");
    expect(sentMessages.at(-1)).toContain("* Consumo: 195 kcal");
    expect(sentMessages.at(-1)).toContain("* Déficit: 15.505 kcal (-99%)");
    expect(sentMessages.at(-1)).not.toContain("Você está em déficit");
    expect(sentMessages.at(-1)).not.toContain("para a meta ajustada do período");
  });

  it("interpreta Resumo sem período como relatório de hoje", async () => {
    listMealsMock.mockResolvedValue([{ id: 20, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), items: [riceItem] }]);
    const req = createTextWebhookRequest("Resumo", { id: "summary-today" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.period_report" }));
    expect(sentMessages.at(-1)).toContain("*Resumo de hoje:*");
    expect(sentMessages.at(-1)).toContain("Refeições registradas: 1");
    expect(sentMessages.at(-1)).toContain("Almoço: 195 kcal");
    expect(sentMessages.at(-1)).toContain("* Prot. 4,1 g | Carb. 42 g | Gord. 0,5 g");
    expect(sentMessages.at(-1)).not.toContain("Total consumido:");
    expect(sentMessages.at(-1)).toContain("*Resumo das Metas:*");
    expect(sentMessages.at(-1)).toContain("* Meta estimada: 2.200 kcal");
    expect(sentMessages.at(-1)).toContain("* Meta ajustada: 2.200 kcal");
    expect(sentMessages.at(-1)).toContain("* Consumo: 195 kcal");
  });

  it("mantém contexto de resumo para pedidos ambíguos que não sejam apenas Resumo", async () => {
    listMealsMock.mockResolvedValue([{ id: 20, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), items: [riceItem] }]);
    const askSummary = createTextWebhookRequest("Me envie um resumo", { id: "summary-without-period" });
    const askResponse = createResponse();

    await handleWhatsAppWebhookWithTextIntent(askSummary as never, askResponse as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("Me diga o período");

    const periodAnswer = createTextWebhookRequest("Hoje", { id: "summary-period-answer" });
    const periodResponse = createResponse();

    await handleWhatsAppWebhookWithTextIntent(periodAnswer as never, periodResponse as never);

    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenLastCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.period_report" }));
    expect(sentMessages.at(-1)).toContain("*Resumo de hoje:*");
    expect(sentMessages.at(-1)).toContain("Refeições registradas: 1");
  });

  it("mantém bebida com volume explícito no fluxo normal de inferência", async () => {
    const req = createTextWebhookRequest("200ml guaraná antártica", { id: "guarana-volume" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(handleWhatsAppWebhookMock).toHaveBeenCalledOnce();
    expect(logInferenceEventMock).not.toHaveBeenCalledWith(expect.objectContaining({
      eventType: "whatsapp.intent.food_not_found",
    }));
    expect(sentMessages).toEqual([]);
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
