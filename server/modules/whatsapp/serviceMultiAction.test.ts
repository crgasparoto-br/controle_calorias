import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const processProfessionalAccessWhatsappResponseMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();
const executeWhatsappRecordAdjustmentIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
}));

vi.mock("./llmIntentActions", () => ({
  executeWhatsappLlmIntent: executeWhatsappLlmIntentMock,
}));

vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock,
}));

vi.mock("./recordAdjustmentIntent", () => ({
  executeWhatsappRecordAdjustmentIntent: executeWhatsappRecordAdjustmentIntentMock,
}));

const { __resetWhatsappConversationContextsForTests, listWhatsappConversationContextsForTests } = await import("./conversationContext");
const { __resetWhatsappIdempotencyForTests } = await import("./idempotencyGuard");
const { __resetWhatsappOperationalTracesForTests, listWhatsappOperationalTraces } = await import("./operationalTrace");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound multi-action", () => {
  beforeEach(() => {
    __resetWhatsappConversationContextsForTests();
    __resetWhatsappIdempotencyForTests();
    __resetWhatsappOperationalTracesForTests();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getDbMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    processProfessionalAccessWhatsappResponseMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    executeWhatsappRecordAdjustmentIntentMock.mockReset();
    getDbMock.mockResolvedValue(null);
    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappRecordAdjustmentIntentMock.mockResolvedValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-1",
      processed: { items: [{ foodName: "arroz", canonicalName: "arroz" }] },
      media: [],
    });
  });

  it("processa mistura de adicionar, trocar e remover preservando todas as acoes", async () => {
    executeWhatsappRecordAdjustmentIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => {
      if (input.text === "troca o frango por peixe") {
        return {
          handled: true,
          action: "record_adjustment_confirmation_needed",
          reply: "Confirme antes de eu alterar: trocar frango por peixe?",
          eventType: "whatsapp.records.adjustment_confirmation_needed",
          detail: "Troca de alimento exige confirmacao antes de persistir.",
          data: { adjustmentKind: "replace_item", sourceFood: "frango", targetFood: "peixe" },
        };
      }
      if (input.text === "remove a cerveja") {
        return {
          handled: true,
          action: "record_adjustment_confirmation_needed",
          reply: "Confirme antes de eu remover: cerveja?",
          eventType: "whatsapp.records.adjustment_confirmation_needed",
          detail: "Remocao de alimento exige confirmacao antes de persistir.",
          data: { adjustmentKind: "remove_item", targetFood: "cerveja" },
        };
      }
      return null;
    });

    const result = await simulateWhatsappInbound(42, {
      text: "adiciona arroz, troca o frango por peixe e remove a cerveja",
    });

    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappRecordAdjustmentIntentMock).toHaveBeenCalledTimes(3);
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "adiciona arroz",
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "multi_action_processed",
      data: expect.objectContaining({
        actionCount: 3,
        warningCount: 2,
        pendingContextCount: 2,
        pendingContextRegistered: false,
      }),
    }));
    expect(listWhatsappConversationContextsForTests()).toHaveLength(0);

    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "multi_action")).toEqual(expect.objectContaining({
      status: "success",
      ruleVersion: "whatsapp-multi-action-v1",
    }));
  });

  it("interpreta multiplas trocas sem ignorar a segunda correcao", async () => {
    executeWhatsappRecordAdjustmentIntentMock.mockImplementation(async (_userId: number, input: { text?: string | null }) => ({
      handled: true,
      action: "record_adjustment_confirmation_needed",
      reply: `Confirme antes de eu alterar: ${input.text}`,
      eventType: "whatsapp.records.adjustment_confirmation_needed",
      detail: "Troca de alimento exige confirmacao antes de persistir.",
      data: { adjustmentKind: "replace_item", originalText: input.text ?? null },
    }));

    const result = await simulateWhatsappInbound(42, {
      text: "Não é peixe é frango, não é mandioquinha é batata doce",
    });

    expect(executeWhatsappRecordAdjustmentIntentMock).toHaveBeenCalledTimes(2);
    expect(executeWhatsappRecordAdjustmentIntentMock).toHaveBeenNthCalledWith(1, 42, expect.objectContaining({
      text: "Não é peixe é frango",
    }));
    expect(executeWhatsappRecordAdjustmentIntentMock).toHaveBeenNthCalledWith(2, 42, expect.objectContaining({
      text: "não é mandioquinha é batata doce",
    }));
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      action: "multi_action_processed",
      data: expect.objectContaining({ actionCount: 2, warningCount: 2 }),
    }));
  });

  it("nao divide lista alimentar simples em multiplas acoes", async () => {
    const result = await simulateWhatsappInbound(42, { text: "1 café, 1 pão e 200 ml leite" });

    expect(processMealDraftMock).toHaveBeenCalledTimes(1);
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "1 café, 1 pão e 200 ml leite",
    });
    expect(result).toEqual(expect.objectContaining({ draftId: "draft-1" }));

    const [trace] = listWhatsappOperationalTraces({ userId: 42 });
    expect(trace.steps.find(step => step.stage === "multi_action")).toEqual(expect.objectContaining({
      status: "skipped",
      fallbackReason: "single_action_message",
    }));
  });
});
