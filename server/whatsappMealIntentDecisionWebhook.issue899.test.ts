import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const processMealInputMock = vi.fn();
const createPendingMealInferenceMock = vi.fn();
const confirmPendingMealMock = vi.fn();
const annotatedWebhookMock = vi.fn();
const logInferenceEventMock = vi.fn();
const recordDomainLinkMock = vi.fn(async () => undefined);

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ conversationId: 899, messageId: 899 })),
  recordOutboundReply: vi.fn(async () => undefined),
  recordDomainLink: recordDomainLinkMock,
  markMessageProcessed: vi.fn(async () => undefined),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  enrichInboundMessage: vi.fn(async () => true),
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  logPersistenceWarning: vi.fn(),
  getUserIdByWhatsappPhone: getUserIdByWhatsappPhoneMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  normalizeWhatsAppPhoneNumber: (value: string) => value.replace(/\D/g, ""),
  getUserNutritionGoal: vi.fn(async () => ({ today: { calories: 2200 } })),
  listUserExercises: vi.fn(async () => []),
  logInferenceEvent: logInferenceEventMock,
  getHabitSnapshots: vi.fn(async () => []),
  createPendingMealInference: createPendingMealInferenceMock,
  confirmPendingMeal: confirmPendingMealMock,
  listUserMeals: vi.fn(async () => []),
  updateUserMeal: vi.fn(),
  removeUserMeal: vi.fn(),
}));

vi.mock("./nutritionEngine", () => ({
  MealInferenceError: class MealInferenceError extends Error {},
  processMealInput: processMealInputMock,
}));

vi.mock("./modules/whatsapp/mealConsolidationService", () => ({
  consolidateWhatsAppMealAfterSave: vi.fn(async (_deps, meal) => ({
    action: "created",
    meal,
  })),
}));

vi.mock("./modules/whatsapp/goalProgressService", () => ({
  getWhatsAppMealGoalProgress: vi.fn(async () => undefined),
}));

vi.mock("./modules/quickEdit/service", () => ({
  tryCreateQuickEditLinkForMeal: vi.fn(async () => null),
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: annotatedWebhookMock,
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: vi.fn(async () => []),
  updateMeal: vi.fn(),
  removeMeal: vi.fn(),
}));

vi.mock("./modules/professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: vi.fn(async () => null),
}));

const {
  __resetWhatsAppTextIntentContextForTests,
  handleWhatsAppWebhookWithTextIntent,
} = await import("./whatsappIntentWebhook");

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

function createTextRequest(id: string, text: string) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id,
              from: "5511999999999",
              timestamp: "1780502400",
              type: "text",
              text: { body: text },
            }],
          },
        }],
      }],
    },
  };
}

function createInteractiveButtonRequest(id: string, buttonId: string) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id,
              from: "5511999999999",
              timestamp: "1780502460",
              type: "interactive",
              interactive: {
                type: "button_reply",
                button_reply: { id: buttonId, title: "Registrar" },
              },
            }],
          },
        }],
      }],
    },
  };
}

function processedCoffee() {
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: "200 ml café com açúcar",
    transcript: null,
    reasoning: "Quantidade e alimento identificados.",
    confidence: 0.98,
    needsConfirmation: false,
    items: [{
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      portionText: "200 ml",
      quantity: 200,
      unit: "ml",
      servings: 1,
      estimatedGrams: 200,
      calories: 40,
      protein: 0,
      carbs: 10,
      fat: 0,
      fiber: 0,
      confidence: 0.98,
      source: "manual",
    }],
    totals: { calories: 40, protein: 0, carbs: 10, fat: 0, fiber: 0 },
  };
}

describe("issue #899 — cadeia HTTP real da decisão consumo x sugestão", () => {
  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    getUserIdByWhatsappPhoneMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    processMealInputMock.mockReset();
    createPendingMealInferenceMock.mockReset();
    confirmPendingMealMock.mockReset();
    annotatedWebhookMock.mockReset();
    logInferenceEventMock.mockReset();
    recordDomainLinkMock.mockClear();

    getUserIdByWhatsappPhoneMock.mockResolvedValue(899_001);
    getUserWhatsappConnectionMock.mockResolvedValue({
      phoneNumber: "5511999999999",
      status: "active",
    });
    processMealInputMock.mockResolvedValue(processedCoffee());
    createPendingMealInferenceMock.mockReturnValue({ draftId: "draft-899-http" });
    confirmPendingMealMock.mockResolvedValue({
      id: 899_900,
      userId: 899_001,
      mealLabel: "Café da manhã",
      occurredAt: new Date("2026-06-03T12:01:00.000Z"),
      notes: "200 ml café com açúcar",
      items: processedCoffee().items,
    });
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) =>
      res.status(200).json({ ok: true, processed: 1 })
    );

    (global as any).__issue899SentPayloads = [];
    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      (global as any).__issue899SentPayloads.push(payload);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
  });

  it("preserva 200 ml e registra uma única vez ao clicar Registrar", async () => {
    const askResponse = createResponse();
    await handleWhatsAppWebhookWithTextIntent(
      createTextRequest("wamid-899-ask", "200 ml café com açúcar") as never,
      askResponse as never,
    );

    expect(askResponse.statusCode).toBe(200);
    expect(confirmPendingMealMock).not.toHaveBeenCalled();
    const buttonsPayload = (global as any).__issue899SentPayloads.find(
      (payload: any) => payload.type === "interactive",
    );
    expect(buttonsPayload).toBeTruthy();
    expect(
      buttonsPayload.interactive.action.buttons.map(
        (button: { reply: { title: string } }) => button.reply.title,
      ),
    ).toEqual(["Registrar", "Receber sugestão", "Cancelar"]);
    const registerButton = buttonsPayload.interactive.action.buttons.find(
      (button: { reply: { title: string } }) => button.reply.title === "Registrar",
    );

    const clickResponse = createResponse();
    await handleWhatsAppWebhookWithTextIntent(
      createInteractiveButtonRequest(
        "wamid-899-register",
        registerButton.reply.id,
      ) as never,
      clickResponse as never,
    );

    expect(clickResponse.statusCode).toBe(200);
    expect(processMealInputMock).toHaveBeenCalledWith(
      expect.objectContaining({ text: "200 ml café com açúcar" }),
    );
    expect(confirmPendingMealMock).toHaveBeenCalledTimes(1);
    expect(confirmPendingMealMock).toHaveBeenCalledWith(
      expect.objectContaining({
        notes: "200 ml café com açúcar",
        items: [expect.objectContaining({ quantity: 200, unit: "ml" })],
      }),
    );
    expect(recordDomainLinkMock).toHaveBeenCalledWith(
      expect.anything(),
      { mealId: 899_900 },
    );
    const finalText = (global as any).__issue899SentPayloads
      .map((payload: any) => payload?.text?.body ?? payload?.interactive?.body?.text)
      .filter(Boolean)
      .at(-1);
    expect(finalText).not.toContain(
      "registrar um alimento, corrigir uma refeição ou consultar",
    );
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
  });
});
