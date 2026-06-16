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

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getDb: getDbMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
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
    getDbMock.mockResolvedValue(null);
    listMealsMock.mockResolvedValue([]);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
  });

  it("detecta multiplas trocas sem acionar LLM, texto ou parser nutricional", async () => {
    const result = await simulateWhatsappInbound(4220, {
      text: "Não é peixe é frango, não é mandioquinha é batata doce",
      messageId: "multi-action-1",
    });

    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "multi_action_confirmation_needed",
      data: expect.objectContaining({ actionCount: 2 }),
    }));
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 4220,
      origin: "whatsapp",
      eventType: "whatsapp.multi_action.confirmation_needed",
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
