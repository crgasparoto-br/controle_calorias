import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();
const listUserExercisesMock = vi.fn();
const logInferenceEventMock = vi.fn();
const handleWhatsAppWebhookMock = vi.fn();
const getWhatsAppUserTimeZoneMock = vi.fn();
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const tryCreateQuickEditLinkForMealMock = vi.fn();

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  markMessageProcessed: vi.fn(async () => undefined),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
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
  createWaterLog: vi.fn(),
}));

vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({
  getWhatsAppWeightVariation: vi.fn(async () => ({ variationKg: null, previousWeightKg: null })),
  getWhatsAppUserTimeZone: getWhatsAppUserTimeZoneMock,
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
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id: "issue-970-webhook",
              from: "5511999999999",
              timestamp: "1786546800",
              type: "text",
              text: { body: text },
            }],
          },
        }],
      }],
    },
  };
}

describe("issue #970 - webhook textual real", () => {
  let sentMessages: string[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
    __resetWhatsAppTextIntentContextForTests();
    vi.clearAllMocks();
    sentMessages = [];

    getUserIdByWhatsappPhoneMock.mockResolvedValue(42);
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
    listUserExercisesMock.mockResolvedValue([]);
    getWhatsAppUserTimeZoneMock.mockResolvedValue("America/Sao_Paulo");
    tryCreateQuickEditLinkForMealMock.mockResolvedValue(null);
    handleWhatsAppWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      const message = payload?.text?.body ?? payload?.interactive?.body?.text;
      if (message) sentMessages.push(message);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("trata a frase original pela cadeia textual canônica sem fallback nutricional", async () => {
    const existingItem = {
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
    listMealsMock.mockResolvedValue([{
      id: 970,
      userId: 42,
      mealLabel: "Café da manhã",
      occurredAt: new Date("2026-08-12T10:00:00.000Z").getTime(),
      notes: "Registro pelo WhatsApp",
      items: [existingItem],
    }]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: 970, ...input }));

    const req = createTextWebhookRequest("Adicionar 3 xícaras de café sem açúcar no café da manhã");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 970,
      mealLabel: "Café da manhã",
      items: [
        existingItem,
        expect.objectContaining({
          foodName: "Café sem açúcar",
          quantity: 3,
          unit: "xícara",
          portionText: "3 xícaras (600 ml)",
        }),
      ],
    }));
    expect(handleWhatsAppWebhookMock).not.toHaveBeenCalled();
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      origin: "whatsapp",
      status: "success",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(sentMessages.at(-1)).toContain("Adicionei 3 xícaras (600 ml) de café sem açúcar");
  });
});
