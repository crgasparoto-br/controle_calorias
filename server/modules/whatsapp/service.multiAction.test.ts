import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getDbMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const listMealsMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();
const executeWhatsappContextualFoodReplacementIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  processMealDraft: processMealDraftMock,
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

vi.mock("./contextualFoodReplacementIntent", () => ({
  executeWhatsappContextualFoodReplacementIntent:
    executeWhatsappContextualFoodReplacementIntentMock,
}));

const { clearWhatsappConversationContext } = await import("./conversationContext");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound multi-action routing", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getDbMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    listMealsMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    executeWhatsappContextualFoodReplacementIntentMock.mockReset();
    getDbMock.mockResolvedValue(null);
    listMealsMock.mockResolvedValue([]);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValue(null);
  });

  it("detecta multiplas trocas pelo handler contextual sem acionar fallback", async () => {
    const text = "Não é peixe é frango, não é mandioquinha é batata doce";
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValueOnce({
      action: "meal_item_replaced",
      reply: "substituições aplicadas",
      eventType: "whatsapp.intent.meal_item_replaced",
      detail: "2 alimento(s) substituído(s) com estado atual recarregado.",
      data: { mealIds: [10] },
    });

    const result = await simulateWhatsappInbound(4220, {
      text,
      messageId: "multi-action-1",
    });

    expect(executeWhatsappContextualFoodReplacementIntentMock).toHaveBeenCalledWith(
      4220,
      expect.objectContaining({ text })
    );
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_replaced",
      data: expect.objectContaining({ mealIds: [10] }),
    }));
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 4220,
      origin: "whatsapp",
      eventType: "whatsapp.intent.meal_item_replaced",
    }));
  });

  it("mantem todas as acoes em mistura de adicionar trocar e remover", async () => {
    const result = await simulateWhatsappInbound(4221, {
      text: "adiciona arroz, troca o frango por peixe e remove a cerveja",
      messageId: "multi-action-2",
    });

    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "multi_action_clarification_needed",
      data: expect.objectContaining({ actionCount: 3 }),
    }));
    expect(result.data.extractedActions.map((action: { actionType: string }) => action.actionType)).toEqual([
      "adicionar_alimento",
      "trocar_alimento",
      "excluir_alimento",
    ]);
  });

  it("preserva lista alimentar com remocao posterior sem criar rascunho", async () => {
    const result = await simulateWhatsappInbound(4222, {
      text: "no almoço foi arroz, feijão, frango; tira o feijão",
      messageId: "multi-action-3",
    });

    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "multi_action_clarification_needed",
      data: expect.objectContaining({ actionCount: 2 }),
    }));
    expect(result.data.extractedActions[0]).toEqual(expect.objectContaining({
      actionType: "adicionar_alimento",
      itemNames: ["arroz", "feijão", "frango"],
    }));
  });
});
