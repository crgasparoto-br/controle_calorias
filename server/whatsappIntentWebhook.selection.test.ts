import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn(async () => 43);
const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const removeMealMock = vi.fn();
const annotatedWebhookMock = vi.fn();

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => null),
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
  getUserNutritionGoal: vi.fn(async () => ({ today: { calories: 2200 } })),
  listUserExercises: vi.fn(async () => []),
  logInferenceEvent: vi.fn(),
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({ accessToken: "access-token-test", phoneNumberId: "phone-number-test" }),
}));

vi.mock("./modules/whatsapp/intentActions", () => ({ executeWhatsappTextIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/llmIntentActions", () => ({ executeWhatsappLlmIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: vi.fn(() => null) }));
vi.mock("./modules/professionals/service", () => ({ processProfessionalAccessWhatsappResponse: vi.fn(async () => null) }));
vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  removeMeal: removeMealMock,
}));
vi.mock("./whatsappAnnotatedImageWebhook", () => ({ handleWhatsAppWebhookWithAnnotatedImages: annotatedWebhookMock }));

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
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
}

function createRequest(id: string, text: string) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{ id, from: "5511999999999", timestamp: "1780502400", type: "text", text: { body: text } }],
          },
        }],
      }],
    },
  };
}

const meal = {
  id: 991,
  mealLabel: "Jantar",
  occurredAt: "2026-07-11T22:00:00.000Z",
  notes: null,
  items: [
    { foodName: "Chocolate ao leite", canonicalName: "Chocolate", portionText: "15 g", servings: 1, estimatedGrams: 15, calories: 80, protein: 1, carbs: 10, fat: 4, confidence: 0.9, source: "catalog" },
    { foodName: "Chocolate amargo", canonicalName: "Chocolate", portionText: "15 g", servings: 1, estimatedGrams: 15, calories: 70, protein: 1, carbs: 8, fat: 4, confidence: 0.9, source: "catalog" },
  ],
};

describe("text webhook persisted delete selection", () => {
  let sentMessages: string[];

  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    vi.clearAllMocks();
    sentMessages = [];
    getUserIdByWhatsappPhoneMock.mockResolvedValue(43);
    listMealsMock.mockResolvedValue([structuredClone(meal)]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ ...meal, ...input }));
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      if (payload?.text?.body) sentMessages.push(payload.text.body);
      if (payload?.interactive?.body?.text) sentMessages.push(payload.interactive.body.text);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("executa excluir chocolate -> o segundo -> sim somente após confirmação", async () => {
    for (const [id, text] of [
      ["wamid-select-1", "excluir chocolate"],
      ["wamid-select-2", "o segundo"],
      ["wamid-select-3", "sim"],
    ] as const) {
      const response = createResponse();
      await handleWhatsAppWebhookWithTextIntent(createRequest(id, text) as never, response as never);
      expect(response.body).toEqual({ ok: true, processed: 1 });
    }

    expect(sentMessages[0]).toContain("2. Chocolate amargo");
    expect(sentMessages[1]).toContain("Chocolate amargo");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(updateMealMock.mock.calls[0][1].items.map((item: { foodName: string }) => item.foodName)).toEqual(["Chocolate ao leite"]);
    expect(removeMealMock).not.toHaveBeenCalled();
  });
});
