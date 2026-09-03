import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  countableGate: vi.fn(),
  executeTextIntent: vi.fn(),
  executeLlmIntent: vi.fn(),
  handleBaseWebhook: vi.fn(),
  sendLogicalReply: vi.fn(),
  splitWaterFood: vi.fn(),
  parseMealCommand: vi.fn(),
}));

vi.mock("./catalogRuntime", () => ({ getCatalogCache: () => [] }));
vi.mock("./modules/whatsapp/foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: () => null }));
vi.mock("./modules/whatsapp/intentActions", () => ({ executeWhatsappTextIntent: mocks.executeTextIntent }));
vi.mock("./modules/whatsapp/contextualFoodReplacementIntent", () => ({ executeWhatsappContextualFoodReplacementIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/deleteIntent", () => ({ executeWhatsappDeleteIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/gramsAdjustmentIntent", () => ({ executeWhatsappGramsAdjustmentIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/gramsIncrementIntent", () => ({ executeWhatsappGramsIncrementIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/countableFoodRegistrationGate", () => ({ prepareWhatsappCountableFoodRegistration: mocks.countableGate }));
vi.mock("./modules/whatsapp/mealCommandParser", () => ({ parseMealCommandFromWhatsApp: mocks.parseMealCommand }));
vi.mock("./modules/whatsapp/mealItemSelectionCallback", () => ({ resolveTextMealItemSelection: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/mealListIntent", () => ({ executeWhatsappMealListIntent: vi.fn(async () => null) }));
vi.mock("./modules/whatsapp/llmIntentActions", () => ({ executeWhatsappLlmIntent: mocks.executeLlmIntent }));
vi.mock("./modules/whatsapp/intentResult", () => ({ getWhatsAppIntentLogStatus: () => "success" }));
vi.mock("./modules/whatsapp/promptInjectionGuard", () => ({
  inspectWhatsAppUserContentSafety: () => ({ safe: true, categories: [] }),
  buildSuspiciousWhatsAppContentReply: () => "bloqueado",
}));
vi.mock("./modules/whatsapp/waterFoodText", () => ({ splitWhatsAppWaterAndFoodText: mocks.splitWaterFood }));
vi.mock("./db", () => ({
  getDb: vi.fn(),
  getUserIdByWhatsappPhone: vi.fn(async () => 42),
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
}));
vi.mock("./repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    getActivePendingOperation: vi.fn(async () => null),
    createPendingOperation: vi.fn(async () => null),
    cancelPendingOperation: vi.fn(async () => undefined),
  }),
}));
vi.mock("./modules/whatsapp/messageRouter", () => ({ resolveWhatsAppPrecedenceGate: vi.fn(async () => ({ step: "continue_pipeline" })) }));
vi.mock("./modules/whatsapp/webhookUtils", () => ({
  collapseWhitespace: (value: string) => value.replace(/\s+/g, " ").trim(),
  stripDiacritics: (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
  getWhatsAppInteractiveReplyId: () => null,
  isWhatsAppMessageForConfiguredChannel: () => true,
  resolveWhatsAppMessageOccurredAt: (message: any) => new Date(Number(message.timestamp ?? 0) * 1000),
  getExtractedWhatsAppMessageKey: (message: any) => `${message.entryIndex}:${message.changeIndex}:${message.messageIndex}`,
  extractWhatsAppWebhookMessages: (payload: any) => (payload?.entry ?? []).flatMap((entry: any, entryIndex: number) =>
    (entry?.changes ?? []).flatMap((change: any, changeIndex: number) =>
      (change?.value?.messages ?? []).map((message: any, messageIndex: number) => ({
        ...message,
        entryIndex,
        changeIndex,
        messageIndex,
        channelPhoneNumberId: change?.value?.metadata?.phone_number_id,
      })))),
}));
vi.mock("./modules/whatsapp/logicalReplyDelivery", () => ({ sendWhatsAppLogicalDomainReply: mocks.sendLogicalReply }));
vi.mock("./modules/whatsapp/periodReportClarification", () => ({ buildWhatsappPeriodReportClarificationListReply: vi.fn(), PENDING_PERIOD_REPORT_TYPE: "period_report_clarification" }));
vi.mock("./modules/whatsapp/weightIdempotency", () => ({ ensureWhatsAppWeightEntry: vi.fn() }));
vi.mock("./modules/whatsapp/userMeasurementReplyContext", () => ({ getWhatsAppWeightVariation: vi.fn() }));
vi.mock("./modules/whatsapp/timeZoneContext", () => ({ resolveWhatsAppOperationTimeZone: vi.fn(async () => ({ timeZone: "America/Sao_Paulo" })) }));
vi.mock("./whatsappAnnotatedImageWebhook", () => ({ handleWhatsAppWebhookWithAnnotatedImages: mocks.handleBaseWebhook }));
vi.mock("./modules/whatsapp/conversationHistory", () => ({ recordConversationTurn: vi.fn(), __resetConversationHistoryForTests: vi.fn() }));
vi.mock("./modules/whatsapp/messageLifecycle", () => ({
  beginInboundMessage: vi.fn(async () => ({ conversationId: 1, messageId: 1 })),
  isExternalMessageClaimedInCurrentScope: vi.fn(() => false),
  markMessageProcessed: vi.fn(),
  recordDomainLink: vi.fn(),
  wasMessageAlreadyProcessed: vi.fn(async () => false),
}));
vi.mock("./modules/professionals/messageService", () => ({ tryAssociateProfessionalWhatsappResponse: vi.fn(async () => null) }));

const { handleWhatsAppWebhookWithTextIntent } = await import("./whatsappIntentWebhook");

function request(text: string, id: string) {
  return { body: { entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-number-test" }, messages: [{ id, from: "5511999999999", timestamp: "1788374400", type: "text", text: { body: text } }] } }] }] } };
}

function response() {
  return { statusCode: 200, body: undefined as unknown, status(code: number) { this.statusCode = code; return this; }, json(payload: unknown) { this.body = payload; return this; } };
}

const presunto = {
  segmentIndex: 0,
  request: { segment: "3 fatias de presunto", foodName: "presunto", count: 3, requestedUnit: "fatia" },
  resolution: { kind: "researched_exact" as const, grams: 60, requestedQuantity: 3, requestedUnit: "fatia", evidence: "60 g", sourceUrls: ["https://example.com/presunto"], referenceCount: 1 },
};
const mussarela = {
  segmentIndex: 1,
  request: { segment: "2 fatias de mussarela", foodName: "mussarela", count: 2, requestedUnit: "fatia" },
  resolution: { kind: "usual_average" as const, grams: 41, requestedQuantity: 2, requestedUnit: "fatia", evidence: "média usual", sourceUrls: ["https://example.com/a", "https://example.org/b"], referenceCount: 2 },
};

describe("issue #1037 — controles adicionais do passthrough", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeLlmIntent.mockResolvedValue(null);
    mocks.splitWaterFood.mockReturnValue(null);
    mocks.parseMealCommand.mockReturnValue({ intent: "unknown", mealType: null, items: [] });
    mocks.sendLogicalReply.mockResolvedValue({ result: { ok: true, primaryOk: true } });
    mocks.handleBaseWebhook.mockImplementation(async (_req: any, res: any) => res.status(200).json({ ok: true, processed: 1 }));
  });

  it("resolve vários segmentos contáveis com uma única chamada do gate", async () => {
    mocks.countableGate.mockResolvedValue({ kind: "ready", registrationText: "60 g de presunto\n41 g de mussarela", resolutions: [presunto, mussarela] });
    mocks.executeTextIntent.mockResolvedValue(null);

    await handleWhatsAppWebhookWithTextIntent(request("3 fatias de presunto\n2 fatias de mussarela", "wamid-1037-multi") as never, response() as never);

    expect(mocks.countableGate).toHaveBeenCalledTimes(1);
    expect(mocks.executeTextIntent).toHaveBeenCalledWith(42, expect.objectContaining({ text: "60 g de presunto\n41 g de mussarela" }));
    const forwarded = mocks.handleBaseWebhook.mock.calls[0][0];
    expect(forwarded.body.entry[0].changes[0].value.messages[0].text.body).toBe("60 g de presunto\n41 g de mussarela");
  });

  it("mantém Adicionar no handler canônico e fora do passthrough normal", async () => {
    const text = "Adicionar 3 fatias de presunto ao café da manhã";
    mocks.parseMealCommand.mockReturnValue({ intent: "add_items_to_meal", mealType: "breakfast", items: [{ foodName: "presunto", quantity: 3, unit: "fatia" }] });
    mocks.executeTextIntent.mockResolvedValue({ action: "meal_item_added", reply: "Presunto adicionado.", eventType: "whatsapp.intent.meal_item_added", detail: "Adição canônica." });

    await handleWhatsAppWebhookWithTextIntent(request(text, "wamid-1037-add") as never, response() as never);

    expect(mocks.countableGate).not.toHaveBeenCalled();
    expect(mocks.executeTextIntent).toHaveBeenCalledWith(42, expect.objectContaining({ text }));
    expect(mocks.handleBaseWebhook).not.toHaveBeenCalled();
  });
});
