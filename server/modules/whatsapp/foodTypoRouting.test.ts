import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const processMealDraftMock = vi.fn();
const processProfessionalAccessWhatsappResponseMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: processProfessionalAccessWhatsappResponseMock,
}));

vi.mock("./datedFoodAdditionIntent", () => ({
  executeWhatsappDatedFoodAdditionIntent: executeWhatsappDatedFoodAdditionIntentMock,
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

describe("simulateWhatsappInbound food typo routing", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    processMealDraftMock.mockReset();
    processProfessionalAccessWhatsappResponseMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();

    processProfessionalAccessWhatsappResponseMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-food-typo",
      processed: {
        items: [{ foodName: "Maçã Fuji", canonicalName: "Maçã Fuji" }],
      },
      media: [],
    });
  });

  it.each([
    ["1 maça fugi", "1 un maçã fuji"],
    ["1 maca fuji", "1 un maçã fuji"],
    ["uma maca", "1 un maçã"],
    ["100g maça fugi", "100 g maçã fuji"],
    ["1 banana prata", "1 un banana prata"],
    ["2 ovos cozido", "2 un ovos cozidos"],
  ])("encaminha %s para o fallback nutricional como %s", async (text, normalizedText) => {
    const result = await simulateWhatsappInbound(42, { text });

    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: normalizedText,
    });
    expect(result).toEqual(expect.objectContaining({ draftId: "draft-food-typo" }));
  });

  it.each(["olá", "bom dia", "teste"])("não cria refeição para %s", async text => {
    const result = await simulateWhatsappInbound(42, { text });

    expect(processMealDraftMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "router_safe_response",
    }));
  });
});
