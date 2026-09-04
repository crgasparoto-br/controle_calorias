import { beforeEach, describe, expect, it, vi } from "vitest";
import { COUNTABLE_FOOD_REGISTRATION_PARITY_CASES } from "./modules/whatsapp/testFixtures/countableFoodRegistrationParityCases";

const mocks = vi.hoisted(() => ({
  countableGate: vi.fn(),
  executeTextIntent: vi.fn(),
  executeLlmIntent: vi.fn(),
  handleBaseWebhook: vi.fn(),
  sendLogicalReply: vi.fn(),
  recordDomainLink: vi.fn(),
  markMessageProcessed: vi.fn(),
  logInferenceEvent: vi.fn(),
  splitWaterFood: vi.fn(),
  parseMealCommand: vi.fn(),
}));

vi.mock("./catalogRuntime", () => ({ getCatalogCache: () => [] }));
vi.mock("./modules/whatsapp/foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: () => null,
}));
vi.mock("./modules/whatsapp/intentActions", () => ({
  executeWhatsappTextIntent: mocks.executeTextIntent,
}));
vi.mock("./modules/whatsapp/contextualFoodReplacementIntent", () => ({
  executeWhatsappContextualFoodReplacementIntent: vi.fn(async () => null),
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
vi.mock("./modules/whatsapp/countableFoodRegistrationGate", () => ({
  prepareWhatsappCountableFoodRegistration: mocks.countableGate,
}));
vi.mock("./modules/whatsapp/mealCommandParser", () => ({
  parseMealCommandFromWhatsApp: mocks.parseMealCommand,
}));
vi.mock("./modules/whatsapp/mealItemSelectionCallback", () => ({
  resolveTextMealItemSelection: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/mealListIntent", () => ({
  executeWhatsappMealListIntent: vi.fn(async () => null),
}));
vi.mock("./modules/whatsapp/llmIntentActions", () => ({
  executeWhatsappLlmIntent: mocks.executeLlmIntent,
}));
vi.mock("./modules/whatsapp/intentResult", () => ({
  getWhatsAppIntentLogStatus: () => "success",
}));
vi.mock("./modules/whatsapp/promptInjectionGuard", () => ({
  inspectWhatsAppUserContentSafety: () => ({ safe: true, categories: [] }),
  buildSuspiciousWhatsAppContentReply: () => "bloqueado",
}));
vi.mock("./modules/whatsapp/waterFoodText", () => ({
  splitWhatsAppWaterAndFoodText: mocks.splitWaterFood,
}));
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getUserIdByWhatsappPhone: vi.fn(async () => 42),
  logInferenceEvent: mocks.logInferenceEvent,
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    getActivePendingOperation: vi.fn(async () => null),
    createPendingOperation: vi.fn(async () => null),
    cancelPendingOperation: vi.fn(async () => undefined),
  }),
}));
vi.mock("./modules/whatsapp/messageRouter", () => ({
  resolveWhatsAppPrecedenceGate: vi.fn(async () => ({ step: "continue_pipeline" })),
}));
vi.mock("./modules/whatsapp/webhookUtils", () => ({
  collapseWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
  stripDiacritics: (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  getWhatsAppInteractiveReplyId: () => null,
  isWhatsAppMessageForConfiguredChannel: () => true,
  resolveWhatsAppMessageOccurredAt: (message: any) => new Date(Number(message.timestamp ?? 0) * 1000),
  getExtractedWhatsAppMessageKey: (message: any) => `${message.entryIndex}:${message.changeIndex}:${message.messageIndex}`,
  extractWhatsAppWebhookMessages: (payload: any) => {
    const output: any[] = [];
    for (const [entryIndex, entry] of (payload?.entry ?? []).entries()) {
      for (const [changeIndex, change] of (entry?.changes ?? []).entries()) {
        for (const [messageIndex, message] of (change?.value?.messages ?? []).entries()) {
          output.push({
            ...message,
            entryIndex,
            changeIndex,
            messageIndex,
            channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
          });
        }
      }
    }
    return output;
  },
}));
vi.mock("./modules/whatsapp/logicalReplyDelivery", () => ({
  sendWhatsAppLogicalDomainReply: mocks.sendLogicalReply,
}));
vi.mock("./modules/whatsapp/periodReportClarification", () => ({
  buildWhatsappPeriodReportClarificationListReply: vi.fn(),
  PENDING_PERIOD_REPORT_TYPE: "period_report_clarification",
}));
vi.mock("./modules/whatsapp/weightIdempotency", () => ({
  ensureWhatsAppWeightEntry: vi.fn(),
}));
vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({
  getWhatsAppWeightVariation: vi.fn(),
}));
vi.mock("./modules/whatsapp/timeZoneContext", () => ({
  resolveWhatsAppOperationTimeZone: vi.fn(async () => ({ timeZone: "America/Sao_Paulo" })),
}));
vi.mock("./whatsappAnnotatedImageWebhook", () => ({
  handleWhatsAppWebhookWithAnnotatedImages: mocks.handleBaseWebhook,
}));
vi.mock("./modules/whatsapp/conversationHistory", () => ({
  recordConversationTurn: vi.fn(),
  __resetConversationHistoryForTests: vi.fn(),
}));
vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  markMessageProcessed: mocks.markMessageProcessed,
  recordDomainLink: mocks.recordDomainLink,
  wasMessageAlreadyProcessed: vi.fn(async () => false),
}));
vi.mock("./modules/professionals/messageService", () => ({
  tryAssociateProfessionalWhatsappResponse: vi.fn(async () => null),
}));

const { handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

function createRequest(text: string, id: string) {
  return {
    body: {
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: "phone-number-test" },
            messages: [{
              id,
              from: "5511999999999",
              timestamp: "1788374400",
              type: "text",
              text: { body: text },
            }],
          },
        }],
      }],
    },
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
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

describe("issue #1047 — matriz compartilhada na fronteira real do webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeLlmIntent.mockResolvedValue(null);
    mocks.executeTextIntent.mockResolvedValue(null);
    mocks.splitWaterFood.mockReturnValue(null);
    mocks.parseMealCommand.mockReturnValue({ intent: "unknown", mealType: null, items: [] });
    mocks.sendLogicalReply.mockResolvedValue({ result: { ok: true, primaryOk: true } });
    mocks.handleBaseWebhook.mockImplementation(async (_req: any, res: any) =>
      res.status(200).json({ ok: true, processed: 1 }));
  });

  it.each(COUNTABLE_FOOD_REGISTRATION_PARITY_CASES)(
    "preserva $id como registro alimentar determinístico",
    async testCase => {
      const resolutions = testCase.items.map((item, segmentIndex) => ({
        segmentIndex,
        request: {
          segment: item.segment,
          foodName: item.foodName,
          count: item.count,
          requestedUnit: "un",
        },
        resolution: {
          kind: "canonical_portion" as const,
          grams: item.grams,
        },
      }));
      mocks.countableGate.mockResolvedValue({
        kind: "ready",
        registrationText: testCase.registrationText,
        resolutions,
      });
      mocks.executeLlmIntent.mockResolvedValue({
        handled: true,
        action: "clarification_needed",
        reply: "resposta genérica que não deve vencer a resolução determinística",
        eventType: "whatsapp.llm_intent.clarification_needed",
        detail: "ambiguous",
      });

      const req = createRequest(testCase.input, `wamid-1047-webhook-${testCase.id}`);
      const res = createResponse();

      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(mocks.countableGate).toHaveBeenCalledWith(expect.objectContaining({
        userId: 42,
        text: testCase.input,
      }));
      expect(mocks.executeTextIntent).toHaveBeenCalledWith(42, expect.objectContaining({
        text: testCase.registrationText,
      }));
      expect(mocks.executeLlmIntent).not.toHaveBeenCalled();
      expect(mocks.handleBaseWebhook).toHaveBeenCalledTimes(1);
      const forwardedReq = mocks.handleBaseWebhook.mock.calls[0][0];
      expect(forwardedReq.body.entry[0].changes[0].value.messages[0].text.body)
        .toBe(testCase.registrationText);
    },
  );
});
