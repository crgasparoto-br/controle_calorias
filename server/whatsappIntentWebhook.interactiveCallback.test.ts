import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserIdByWhatsappPhoneMock = vi.fn();
const listMealsMock = vi.fn();
const removeMealMock = vi.fn();
const updateMealMock = vi.fn();
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
  getUserNutritionGoal: vi.fn(async () => ({ today: { calories: 2000 } })),
  listUserExercises: vi.fn(async () => []),
  logInferenceEvent: vi.fn(),
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./modules/meals/service", () => ({
  listMeals: listMealsMock,
  removeMeal: removeMealMock,
  updateMeal: updateMealMock,
}));

vi.mock("./modules/professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: vi.fn(async () => null),
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

function createTextRequest(id: string, text: string) {
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
              interactive: { type: "button_reply", button_reply: { id: buttonId, title: "Confirmar" } },
            }],
          },
        }],
      }],
    },
  };
}

describe("webhook real: reconhece button_reply e resolve o callback central (issue #782)", () => {
  beforeEach(() => {
    __resetWhatsAppTextIntentContextForTests();
    getUserIdByWhatsappPhoneMock.mockReset();
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    updateMealMock.mockReset();
    annotatedWebhookMock.mockReset();
    getUserIdByWhatsappPhoneMock.mockResolvedValue(71_001);
    annotatedWebhookMock.mockImplementation(async (_req, res: MockResponse) => res.status(200).json({ ok: true, processed: 1 }));

    global.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const payload = init?.body ? JSON.parse(String(init.body)) : {};
      (global as any).__sentPayloads.push(payload);
      return { ok: true, json: async () => ({}) } as Response;
    }) as typeof fetch;
    (global as any).__sentPayloads = [];
  });

  it("pede confirmação por botões via texto e executa a exclusão ao receber o button_reply real do webhook", async () => {
    listMealsMock.mockResolvedValue([{
      id: 900,
      userId: 71_001,
      mealLabel: "Almoço",
      occurredAt: "2026-06-23T15:00:00.000Z",
      source: "whatsapp",
      items: [{ foodName: "Arroz", portionText: "100 g" }],
    }]);

    const askResponse = createResponse();
    await handleWhatsAppWebhookWithTextIntent(createTextRequest("wamid-ask", "excluir almoço") as never, askResponse as never);
    expect(askResponse.statusCode).toBe(200);

    const buttonsPayload = (global as any).__sentPayloads.find((payload: any) => payload.type === "interactive");
    expect(buttonsPayload).toBeTruthy();
    const confirmButton = buttonsPayload.interactive.action.buttons.find((button: { reply: { title: string } }) => button.reply.title === "Confirmar");
    expect(confirmButton).toBeTruthy();

    removeMealMock.mockResolvedValue(undefined);
    const clickResponse = createResponse();
    await handleWhatsAppWebhookWithTextIntent(createInteractiveButtonRequest("wamid-click", confirmButton.reply.id) as never, clickResponse as never);

    expect(clickResponse.statusCode).toBe(200);
    expect(removeMealMock).toHaveBeenCalledTimes(1);
    expect(annotatedWebhookMock).not.toHaveBeenCalled();
  });

  it("reentrega do mesmo message.id de um clique não repete a exclusão", async () => {
    listMealsMock.mockResolvedValue([{
      id: 901,
      userId: 71_001,
      mealLabel: "Jantar",
      occurredAt: "2026-06-23T22:00:00.000Z",
      source: "whatsapp",
      items: [{ foodName: "Peixe", portionText: "150 g" }],
    }]);

    await handleWhatsAppWebhookWithTextIntent(createTextRequest("wamid-ask-2", "excluir jantar") as never, createResponse() as never);
    const buttonsPayload = (global as any).__sentPayloads.find((payload: any) => payload.type === "interactive");
    const confirmButton = buttonsPayload.interactive.action.buttons.find((button: { reply: { title: string } }) => button.reply.title === "Confirmar");

    removeMealMock.mockResolvedValue(undefined);
    await handleWhatsAppWebhookWithTextIntent(createInteractiveButtonRequest("wamid-click-2", confirmButton.reply.id) as never, createResponse() as never);
    expect(removeMealMock).toHaveBeenCalledTimes(1);

    // Reentrega do mesmo message.id (sem resetar o cache local de dedup): deve ser reconhecida como já processada.
    const retryResponse = createResponse();
    await handleWhatsAppWebhookWithTextIntent(createInteractiveButtonRequest("wamid-click-2", confirmButton.reply.id) as never, retryResponse as never);
    expect(removeMealMock).toHaveBeenCalledTimes(1);
  });
});
