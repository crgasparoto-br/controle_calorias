import { beforeEach, describe, expect, it, vi } from "vitest";

const executeWhatsappContextualFoodReplacementIntentMock = vi.hoisted(() =>
  vi.fn()
);
const sendWhatsAppLogicalDomainReplyMock = vi.hoisted(() => vi.fn());
const handleWhatsAppWebhookWithAnnotatedImagesMock = vi.hoisted(() => vi.fn());
const executeWhatsappTextIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsappLlmIntentMock = vi.hoisted(() => vi.fn());
const processMealDraftFallbackMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({
  getDb: vi.fn(async () => null),
  getUserIdByWhatsappPhone: vi.fn(async () => 42),
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));

vi.mock("./whatsappConfig", () => ({
  getWhatsAppChannelConfig: () => ({ phoneNumberId: "phone-number-test" }),
  requireWhatsAppSendConfig: async () => ({
    accessToken: "access-token-test",
    phoneNumberId: "phone-number-test",
  }),
}));

vi.mock("./repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    getActivePendingOperation: vi.fn(async () => null),
    cancelPendingOperation: vi.fn(async () => undefined),
    createPendingOperation: vi.fn(async () => null),
  }),
}));

vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  markMessageProcessed: vi.fn(async () => undefined),
  recordDomainLink: vi.fn(async () => undefined),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
}));

vi.mock("./modules/whatsapp/messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: vi.fn(async () => ({
    step: "continue_pipeline",
  })),
}));

vi.mock("./modules/professionals/messageService", () => ({
  tryAssociateProfessionalWhatsappResponse: vi.fn(async () => null),
}));

vi.mock("./modules/whatsapp/timeZoneContext", () => ({
  resolveWhatsAppOperationTimeZone: vi.fn(async () => ({
    timeZone: "America/Sao_Paulo",
    source: "profile",
  })),
}));

vi.mock("./modules/whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppLogicalDomainReply: sendWhatsAppLogicalDomainReplyMock,
}));

vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages:
    handleWhatsAppWebhookWithAnnotatedImagesMock,
}));

vi.mock("./modules/whatsapp/contextualFoodReplacementIntent", () => ({
  executeWhatsappContextualFoodReplacementIntent:
    executeWhatsappContextualFoodReplacementIntentMock,
}));
vi.mock("./modules/whatsapp/intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));
vi.mock("./modules/whatsapp/llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));
vi.mock("./modules/whatsapp/foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: vi.fn(() => null),
}));
vi.mock("./modules/whatsapp/deleteIntent", () => ({
  executeWhatsappDeleteIntent: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/gramsAdjustmentIntent", () => ({
  executeWhatsappGramsAdjustmentIntent: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/gramsIncrementIntent", () => ({
  executeWhatsappGramsIncrementIntent: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/mealListIntent", () => ({
  executeWhatsappMealListIntent: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/mealItemSelectionCallback", () => ({
  resolveTextMealItemSelection: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/weightIdempotency", () => ({
  ensureWhatsAppWeightEntry: vi.fn(),
}));
vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({
  getWhatsAppWeightVariation: vi.fn(),
}));
vi.mock("./modules/meals/service", () => ({
  processMealDraft: processMealDraftFallbackMock,
}));

const { handleWhatsAppWebhookWithTextIntent } = await import(
  "./whatsappIntentWebhook"
);

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
                    id: "wamid-issue-918-webhook",
                    from: "5511999999999",
                    timestamp: "1785067500",
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

describe("webhook real com substituições multiline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendWhatsAppLogicalDomainReplyMock.mockResolvedValue({
      result: { ok: true, primaryOk: true },
    });
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValue({
      action: "meal_item_replaced",
      reply:
        "Requeijão → maionese\nPresunto → mortadela defumada\n\nResumo atualizado",
      eventType: "whatsapp.intent.meal_item_replaced",
      detail: "2 alimento(s) substituído(s) com estado atual recarregado.",
      data: { mealId: 10, mealIds: [10] },
    });
  });

  it("alcança o mesmo handler contextual e envia uma única resposta funcional", async () => {
    const text =
      "Não é requeijão, é maionese.\nNão é presunto, é mortadela defumada";
    const req = createTextWebhookRequest(text);
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(
      executeWhatsappContextualFoodReplacementIntentMock
    ).toHaveBeenCalledOnce();
    expect(
      executeWhatsappContextualFoodReplacementIntentMock
    ).toHaveBeenCalledWith(42, {
      text,
      receivedAt: expect.any(Date),
    });
    expect(sendWhatsAppLogicalDomainReplyMock).toHaveBeenCalledOnce();
    expect(sendWhatsAppLogicalDomainReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "5511999999999",
        userId: 42,
        replyText: expect.stringContaining("Presunto → mortadela defumada"),
        mealId: 10,
      })
    );
    expect(handleWhatsAppWebhookWithAnnotatedImagesMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftFallbackMock).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
  });
});
