import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const { getWhatsAppDeferredLogicalReply } = await import("./modules/whatsapp/deferredLogicalReply");

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

const usualAverageResolution = {
  segmentIndex: 0,
  request: {
    segment: "2 fatias de mussarela",
    foodName: "mussarela",
    count: 2,
    requestedUnit: "fatia",
  },
  resolution: {
    kind: "usual_average" as const,
    grams: 41,
    requestedQuantity: 2,
    requestedUnit: "fatia",
    evidence: "média usual verificável",
    sourceUrls: ["https://example.com/a", "https://example.org/b"],
    referenceCount: 2,
  },
};

describe("issue #1037 — passthrough de medidas contáveis no WhatsApp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeLlmIntent.mockResolvedValue(null);
    mocks.splitWaterFood.mockReturnValue(null);
    mocks.parseMealCommand.mockReturnValue({ intent: "unknown", mealType: null, items: [] });
    mocks.sendLogicalReply.mockResolvedValue({ result: { ok: true, primaryOk: true } });
    mocks.handleBaseWebhook.mockImplementation(async (_req: any, res: any) => res.status(200).json({ ok: true, processed: 1 }));
  });

  it("entrega o texto reescrito em gramas ao webhook nutricional e preserva a proveniência", async () => {
    mocks.countableGate.mockResolvedValue({
      kind: "ready",
      registrationText: "41 g de mussarela",
      resolutions: [usualAverageResolution],
    });
    mocks.executeTextIntent.mockResolvedValue(null);

    const req = createRequest("2 fatias de mussarela", "wamid-1037-normal");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(mocks.countableGate).toHaveBeenCalledTimes(1);
    expect(mocks.countableGate).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      text: "2 fatias de mussarela",
    }));
    expect(mocks.executeTextIntent).toHaveBeenCalledWith(42, expect.objectContaining({
      text: "41 g de mussarela",
    }));
    expect(mocks.handleBaseWebhook).toHaveBeenCalledTimes(1);
    const forwardedReq = mocks.handleBaseWebhook.mock.calls[0][0];
    expect(forwardedReq.body.entry[0].changes[0].value.messages[0].text.body).toBe("41 g de mussarela");

    const deferred = getWhatsAppDeferredLogicalReply(forwardedReq, "wamid-1037-normal");
    expect(deferred?.prefixBlocks.join("\n")).toContain("2 fatia → aprox. 41 g");
    expect(deferred?.prefixBlocks.join("\n")).toContain("média usual estimada");
  });

  it("resolve somente o fragmento alimentar em água + alimento e não duplica o preflight", async () => {
    mocks.splitWaterFood.mockReturnValue({
      waterLines: [{ text: "300 ml de água" }],
      foodText: "2 fatias de mussarela",
    });
    mocks.countableGate.mockResolvedValue({
      kind: "ready",
      registrationText: "41 g de mussarela",
      resolutions: [usualAverageResolution],
    });
    mocks.executeTextIntent.mockImplementation(async (_userId: number, input: { text: string }) => {
      if (input.text === "300 ml de água") {
        return {
          action: "water_logged",
          reply: "*Água registrada*",
          eventType: "whatsapp.intent.water_logged",
          detail: "Água registrada.",
          data: { waterLogId: 91 },
        };
      }
      return null;
    });

    const req = createRequest("300 ml de água\n2 fatias de mussarela", "wamid-1037-water-food");
    const res = createResponse();

    await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

    expect(mocks.countableGate).toHaveBeenCalledTimes(1);
    expect(mocks.countableGate).toHaveBeenCalledWith(expect.objectContaining({
      text: "2 fatias de mussarela",
    }));
    expect(mocks.handleBaseWebhook).toHaveBeenCalledTimes(1);
    const forwardedReq = mocks.handleBaseWebhook.mock.calls[0][0];
    expect(forwardedReq.body.entry[0].changes[0].value.messages[0].text.body).toBe("41 g de mussarela");
    const deferred = getWhatsAppDeferredLogicalReply(forwardedReq, "wamid-1037-water-food");
    expect(deferred?.prefixBlocks.join("\n")).toContain("Água registrada");
    expect(deferred?.prefixBlocks.join("\n")).toContain("média usual estimada");
    expect(deferred?.domainLinks).toEqual([{ waterLogId: 91 }]);
  });

  describe("issue #1047 — decisão final do gate contável", () => {
    it("não deixa o classificador contextual rebaixar 1 banana nanica para ambiguidade", async () => {
      mocks.countableGate.mockResolvedValue({
        kind: "ready",
        registrationText: "80 g de banana nanica",
        resolutions: [{
          segmentIndex: 0,
          request: {
            segment: "1 banana nanica",
            foodName: "banana nanica",
            count: 1,
            requestedUnit: "un",
          },
          resolution: { kind: "canonical_portion", grams: 80 },
        }],
      });
      mocks.executeTextIntent.mockResolvedValue(null);
      mocks.executeLlmIntent.mockResolvedValue({
        handled: true,
        action: "clarification_needed",
        reply: "resposta genérica que não deve ser usada",
        eventType: "whatsapp.llm_intent.clarification_needed",
        detail: "ambiguous",
      });

      const req = createRequest("1 banana nanica", "wamid-1047-banana");
      const res = createResponse();
      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(mocks.countableGate).toHaveBeenCalledTimes(1);
      expect(mocks.executeTextIntent).toHaveBeenCalledWith(42, expect.objectContaining({
        text: "80 g de banana nanica",
      }));
      expect(mocks.executeLlmIntent).not.toHaveBeenCalled();
      expect(mocks.handleBaseWebhook).toHaveBeenCalledTimes(1);
      const forwardedReq = mocks.handleBaseWebhook.mock.calls[0][0];
      expect(forwardedReq.body.entry[0].changes[0].value.messages[0].text.body).toBe("80 g de banana nanica");
    });

    it("preserva o passthrough de vários itens resolvidos sem uma segunda decisão de intenção", async () => {
      mocks.countableGate.mockResolvedValue({
        kind: "ready",
        registrationText: "80 g de banana nanica, 100 g de ovos cozidos",
        resolutions: [
          {
            segmentIndex: 0,
            request: { segment: "1 banana nanica", foodName: "banana nanica", count: 1, requestedUnit: "un" },
            resolution: { kind: "canonical_portion", grams: 80 },
          },
          {
            segmentIndex: 1,
            request: { segment: "2 ovos cozidos", foodName: "ovos cozidos", count: 2, requestedUnit: "un" },
            resolution: { kind: "canonical_portion", grams: 100 },
          },
        ],
      });
      mocks.executeTextIntent.mockResolvedValue(null);

      const req = createRequest("1 banana nanica, 2 ovos cozidos", "wamid-1047-multi");
      const res = createResponse();
      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(mocks.executeLlmIntent).not.toHaveBeenCalled();
      expect(mocks.handleBaseWebhook).toHaveBeenCalledTimes(1);
      const forwardedReq = mocks.handleBaseWebhook.mock.calls[0][0];
      expect(forwardedReq.body.entry[0].changes[0].value.messages[0].text.body)
        .toBe("80 g de banana nanica, 100 g de ovos cozidos");
    });

    it.each([
      "quantas calorias tem 1 banana nanica?",
      "1 banana nanica tem muita caloria?",
    ])("mantém pergunta nutricional fora do gate contável: %s", async text => {
      mocks.executeTextIntent.mockResolvedValue(null);
      mocks.executeLlmIntent.mockResolvedValue({
        handled: true,
        action: "clarification_needed",
        reply: "consulta preservada",
        eventType: "whatsapp.llm_intent.query",
        detail: "Pergunta nutricional encaminhada ao classificador contextual.",
      });

      const req = createRequest(text, `wamid-1047-question-${text.length}`);
      const res = createResponse();
      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(mocks.countableGate).not.toHaveBeenCalled();
      expect(mocks.executeLlmIntent).toHaveBeenCalledTimes(1);
      expect(mocks.handleBaseWebhook).not.toHaveBeenCalled();
    });

    it("mantém alimento desconhecido em esclarecimento específico sem menu genérico", async () => {
      mocks.countableGate.mockResolvedValue({
        kind: "clarification",
        result: {
          handled: true,
          action: "food_clarification_requested",
          reply: "Não consegui resolver a porção desse alimento. Informe o peso em g.",
          eventType: "whatsapp.food_clarification.requested",
          detail: "Quantidade alimentar não resolvida.",
        },
      });

      const req = createRequest("1 alimento totalmente inexistente xyz", "wamid-1047-unknown");
      const res = createResponse();
      await handleWhatsAppWebhookWithTextIntent(req as never, res as never);

      expect(mocks.executeLlmIntent).not.toHaveBeenCalled();
      expect(mocks.sendLogicalReply).toHaveBeenCalledWith(expect.objectContaining({
        replyText: expect.stringContaining("porção desse alimento"),
      }));
      expect(mocks.handleBaseWebhook).not.toHaveBeenCalled();
    });
  });

  it("mantém o preflight de consumidores diretos de executeWhatsappTextIntent", () => {
    const source = readFileSync(new URL("./modules/whatsapp/intentActions.ts", import.meta.url), "utf8");
    expect(source).toContain("prepareWhatsappCountableFoodRegistration");
    expect(source).toContain("resolveUnsafeKnownCountableFoodRegistration");
    expect(source).toMatch(
      /const countableClarification = await resolveUnsafeKnownCountableFoodRegistration\([\s\S]*?if \(countableClarification\) return countableClarification;/,
    );
  });
});
