import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const createWaterLogMock = vi.fn();
const updateUserCurrentWeightMock = vi.fn();
const ensureWhatsAppWeightEntryMock = vi.fn();
const getWhatsAppWeightVariationMock = vi.fn();
const getWhatsAppUserTimeZoneMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const updateMealWithHouseholdMeasureLearningMock = vi.fn();
const tryCreateQuickEditLinkForMealMock = vi.fn();
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
  wasMessageAlreadyProcessed: vi.fn(async () => false),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: { name: string }, val: unknown) => ({ __op: "eq", col, val }),
  desc: (col: { name: string }) => ({ __op: "desc", col }),
  and: (...conditions: unknown[]) => ({ __op: "and", conditions }),
}));

type FakeDbRow = Record<string, unknown>;
type FakeDbCondition =
  | { __op: "eq"; col: { name: string }; val: unknown }
  | { __op: "and"; conditions: FakeDbCondition[] }
  | { __op: "desc"; col: { name: string } };

function createFakePendingOperationDb() {
  let rows: FakeDbRow[] = [];
  let nextId = 1;

  function matches(row: FakeDbRow, condition?: FakeDbCondition): boolean {
    if (!condition) return true;
    if (condition.__op === "eq") return row[condition.col.name] === condition.val;
    if (condition.__op === "and") return condition.conditions.every(inner => matches(row, inner));
    return true;
  }

  function createSelectChain() {
    let whereCondition: FakeDbCondition | undefined;
    let limitValue: number | undefined;
    const resolve = () => {
      let result = rows.filter(row => matches(row, whereCondition));
      result = [...result].sort((a, b) => (b.id as number) - (a.id as number));
      if (limitValue !== undefined) result = result.slice(0, limitValue);
      return result.map(row => ({ ...row }));
    };
    const chain: any = {
      from: vi.fn(() => chain),
      where: vi.fn((condition: FakeDbCondition) => { whereCondition = condition; return chain; }),
      orderBy: vi.fn(() => chain),
      limit: vi.fn((value: number) => { limitValue = value; return Promise.resolve(resolve()); }),
    };
    return chain;
  }

  return {
    select: vi.fn(() => ({ from: vi.fn(() => createSelectChain()) })),
    insert: vi.fn(() => ({
      values: vi.fn((payload: FakeDbRow) => {
        const id = nextId++;
        rows.push({ id, ...payload });
        return Promise.resolve({ insertId: id });
      }),
    })),
    update: vi.fn(() => {
      let setPayload: FakeDbRow = {};
      const chain: any = {
        set: vi.fn((payload: FakeDbRow) => { setPayload = payload; return chain; }),
        where: vi.fn((condition: FakeDbCondition) => {
          const matching = rows.filter(row => matches(row, condition));
          for (const row of matching) Object.assign(row, setPayload);
          return Promise.resolve({ affectedRows: matching.length });
        }),
      };
      return chain;
    }),
    reset() {
      rows = [];
      nextId = 1;
    },
  };
}

const fakePendingOperationDb = createFakePendingOperationDb();

vi.mock("./db", () => ({
  getDb: vi.fn(async () => fakePendingOperationDb),
  logPersistenceWarning: vi.fn(),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserNutritionGoal: getUserNutritionGoalMock,
  listUserExercises: listUserExercisesMock,
  logInferenceEvent: logInferenceEventMock,
  updateUserCurrentWeight: updateUserCurrentWeightMock,
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

vi.mock("./modules/whatsapp/weightIdempotency", () => ({
  ensureWhatsAppWeightEntry: ensureWhatsAppWeightEntryMock,
}));

vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({
  getWhatsAppWeightVariation: getWhatsAppWeightVariationMock,
  getWhatsAppUserTimeZone: getWhatsAppUserTimeZoneMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  updateMealWithHouseholdMeasureLearning: updateMealWithHouseholdMeasureLearningMock,
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
    fakePendingOperationDb.reset();
    sentMessages = [];
    sentPayloads = [];
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    listUserExercisesMock.mockReset();
    logInferenceEventMock.mockReset();
    handleWhatsAppWebhookMock.mockReset();
    createWaterLogMock.mockReset();
    updateUserCurrentWeightMock.mockReset();
    ensureWhatsAppWeightEntryMock.mockReset();
    getWhatsAppWeightVariationMock.mockReset();
    getWhatsAppUserTimeZoneMock.mockReset();
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    updateMealWithHouseholdMeasureLearningMock.mockReset();
    updateMealWithHouseholdMeasureLearningMock.mockImplementation(async (userId: number, input: Record<string, unknown>) => updateMealMock(userId, input));
    tryCreateQuickEditLinkForMealMock.mockReset();
    beginInboundMessageMock.mockReset();
    recordOutboundReplyMock.mockReset();
    recordDomainLinkMock.mockReset();
    markMessageProcessedMock.mockReset();
    let nextLifecycleMessageId = 1;
    beginInboundMessageMock.mockImplementation(async () => ({
      conversationId: 1,
      messageId: nextLifecycleMessageId++,
    }));

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
    updateUserCurrentWeightMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      userId: 42,
      ...input,
    }));
    getWhatsAppWeightVariationMock.mockResolvedValue({ variationKg: null, previousWeightKg: null });
    getWhatsAppUserTimeZoneMock.mockResolvedValue("America/Sao_Paulo");
    ensureWhatsAppWeightEntryMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      entry: { id: 92, userId: 42, ...input },
      created: true,
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
    expect(beginInboundMessageMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      externalMessageId: "water-yesterday",
      contentType: "text",
    }));
    expect(recordOutboundReplyMock).toHaveBeenCalledWith(
      { conversationId: 1, messageId: 1 },
      expect.objectContaining({ userId: 42, text: expect.stringContaining("Registrei 500 ml de água") }),
    );
    expect(markMessageProcessedMock).toHaveBeenCalledWith({ conversationId: 1, messageId: 1 });
  });

  it("água + alimento na mesma mensagem compõe uma única resposta funcional diferida (#785)", async () => {
    const req = createTextWebhookRequest("300 ml de água\n1 pão francês", {
      id: "water-food-mixed",
      timestamp: "1780502400",
    });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    // Água registrada exatamente uma vez.
    expect(createWaterLogMock).toHaveBeenCalledTimes(1);
    expect(createWaterLogMock).toHaveBeenCalledWith(42, expect.objectContaining({ amountMl: 300 }));
    // O intent webhook não envia outbound próprio para a água: o bloco entra
    // como prefixo diferido da resposta nutricional do webhook base.
    expect(sentMessages).toHaveLength(0);
    expect(handleWhatsAppWebhookMock).toHaveBeenCalledTimes(1);
    const forwardedReq = handleWhatsAppWebhookMock.mock.calls[0][0];
    const forwardedText = forwardedReq.body.entry[0].changes[0].value.messages[0].text.body;
    expect(forwardedText).toContain("pão francês");
    expect(forwardedText).not.toContain("água");

    const { getWhatsAppDeferredLogicalReply, composeWhatsAppDeferredReplyText } = await import("./modules/whatsapp/deferredLogicalReply");
    const deferred = getWhatsAppDeferredLogicalReply(forwardedReq, "water-food-mixed");
    expect(deferred).not.toBeNull();
    expect(deferred?.prefixBlocks.join("\n")).toContain("Água registrada");
    expect(deferred?.domainLinks).toEqual([{ waterLogId: 91 }]);
    const composed = composeWhatsAppDeferredReplyText(deferred, "🍽️ *Almoço*");
    expect(composed.indexOf("Água registrada")).toBeLessThan(composed.indexOf("🍽️ *Almoço*"));
  });

  it("registra peso pela intenção textual e não delega para criação de refeição", async () => {
    const req = createTextWebhookRequest("peso 80,5 kg", {
      id: "weight-current",
      timestamp: "1780502400",
    });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true, processed: 1 });
    expect(ensureWhatsAppWeightEntryMock).toHaveBeenCalledWith(42, {
      weightKg: 80.5,
      occurredAt: expect.stringMatching(/^2026-06-03T/),
      source: "whatsapp",
      idempotencyKey: "whatsapp-weight:weight-current",
    });
    expect(updateUserCurrentWeightMock).not.toHaveBeenCalled();
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.weight_logged",
    }));
    expect(sentMessages.at(-1)).toContain("Registrei seu peso em *80,5 kg*");
    expect(recordDomainLinkMock).toHaveBeenCalledWith({ conversationId: 1, messageId: 1 }, { userWeightId: 92 });
  });

  it("reativa a mesma mensagem de peso sem criar um segundo registro", async () => {
    ensureWhatsAppWeightEntryMock
      .mockResolvedValueOnce({ entry: { id: 92, userId: 42, weightKg: 80.5 }, created: true })
      .mockResolvedValueOnce({ entry: { id: 92, userId: 42, weightKg: 80.5 }, created: false });
    const req = createTextWebhookRequest("peso 80,5 kg", { id: "weight-retry" });

    await handleWhatsAppWebhookWithTextIntent(req as never, createResponse() as never);
    await handleWhatsAppWebhookWithTextIntent(req as never, createResponse() as never);

    expect(ensureWhatsAppWeightEntryMock).toHaveBeenCalledTimes(2);
    expect(ensureWhatsAppWeightEntryMock).toHaveBeenNthCalledWith(1, 42, expect.objectContaining({ idempotencyKey: "whatsapp-weight:weight-retry" }));
    expect(ensureWhatsAppWeightEntryMock).toHaveBeenNthCalledWith(2, 42, expect.objectContaining({ idempotencyKey: "whatsapp-weight:weight-retry" }));
    expect(recordDomainLinkMock).toHaveBeenCalledTimes(2);
  });

  it("consulta meta calórica diária sem delegar para criação de refeição", async () => {
    const req = createTextWebhookRequest("qual minha meta de calorias?", { id: "goal-query" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(getUserNutritionGoalMock).toHaveBeenCalledWith(42, expect.objectContaining({ timeZone: "America/Sao_Paulo" }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("meta de hoje é *2.200 kcal*");
  });

  it("consulta gasto por exercícios sem delegar para criação de refeição", async () => {
    listUserExercisesMock.mockResolvedValue([
      { id: 1, name: "Corrida", caloriesBurned: 320, occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime() },
      { id: 2, name: "Caminhada", caloriesBurned: 120, occurredAt: new Date("2026-06-03T11:00:00.000Z").getTime() },
    ]);
    const req = createTextWebhookRequest("quantas calorias gastei hoje?", { id: "exercise-query" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(listUserExercisesMock).toHaveBeenCalledWith(42);
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("*440 kcal* em exercícios");
  });

  it("solicita esclarecimento quando falta alimento para registrar", async () => {
    const req = createTextWebhookRequest("registrar", { id: "registration-missing-food" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("Qual alimento");
  });

  it("mantém pergunta ambígua fora do registro nutricional", async () => {
    const req = createTextWebhookRequest("e depois?", { id: "ambiguous-question" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("Não consegui entender");
  });

  it("mantém comando curto de resumo no roteamento determinístico", async () => {
    const req = createTextWebhookRequest("resumo", { id: "summary-short" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("Resumo de hoje");
  });

  it("mantém texto explícito de registro no fluxo nutricional", async () => {
    const req = createTextWebhookRequest("Registrar 100g de arroz", { id: "explicit-register" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookMock).toHaveBeenCalledTimes(1);
  });

  it("lista refeições recentes sem delegar para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([
      { id: 40, userId: 42, mealLabel: "Café da manhã", occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime(), notes: null, items: [bananaItem] },
      { id: 41, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), notes: null, items: [riceItem] },
    ]);
    const req = createTextWebhookRequest("listar refeições", { id: "list-meals" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(sentMessages.at(-1)).toContain("Café da manhã");
    expect(sentMessages.at(-1)).toContain("Almoço");
  });

  it("adiciona alimento na refeição existente e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([
      { id: 36, userId: 42, mealLabel: "Almoço", occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(), notes: "Registro pelo WhatsApp", items: [riceItem] },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: (input as { mealId: number }).mealId, ...input }));
    const req = createTextWebhookRequest("Adicionar 100g de feijão no almoço", { id: "add-beans-to-lunch" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", eventType: "whatsapp.intent.meal_item_added" }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 36,
      items: [riceItem, expect.objectContaining({ estimatedGrams: 100 })],
    }));
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
      items: [
        expect.objectContaining({ foodName: "requeijão", canonicalName: "requeijão", estimatedGrams: 30, calories: 45, source: "heuristic" }),
        expect.objectContaining(riceItem),
      ],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({ origin: "whatsapp", status: "success", eventType: "whatsapp.intent.meal_item_replaced" }));
  });

  it("remove alimento existente sem delegar para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([{ id: 15, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-03T18:00:00.000Z").getTime(), notes: null, items: [bananaItem, riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 15, ...input }));
    const req = createTextWebhookRequest("remover banana", { id: "remove-food" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 15,
      items: [riceItem],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
  });

  it("move alimento para outra refeição e não delega para inferência nutricional", async () => {
    listMealsMock.mockResolvedValue([{ id: 16, userId: 42, mealLabel: "Café da manhã", occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime(), notes: null, items: [bananaItem, riceItem] }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 16, ...input }));
    const req = createTextWebhookRequest("mover banana para jantar", { id: "move-food" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({ mealId: 16, mealLabel: "Jantar" }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
  });

  it("delega texto alimentar comum para inferência nutricional", async () => {
    const req = createTextWebhookRequest("2 ovos e 1 pão francês", { id: "food-fallback" });
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(handleWhatsAppWebhookMock).toHaveBeenCalledTimes(1);
  });
});
