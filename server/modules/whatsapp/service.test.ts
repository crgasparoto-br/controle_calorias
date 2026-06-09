import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: getAdminWhatsAppTokenStatusMock,
  getUserWhatsappConnection: getUserWhatsappConnectionMock,
  logInferenceEvent: logInferenceEventMock,
  upsertUserWhatsappConnection: upsertUserWhatsappConnectionMock,
}));

vi.mock("../meals/service", () => ({
  processMealDraft: processMealDraftMock,
}));

vi.mock("./intentActions", () => ({
  executeWhatsappTextIntent: executeWhatsappTextIntentMock,
}));

vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock,
}));

const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound", () => {
  beforeEach(() => {
    getAdminWhatsAppTokenStatusMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-1",
      processed: {
        items: [
          {
            foodName: "pão de cenoura",
            canonicalName: "pão de cenoura",
          },
        ],
      },
      media: [],
    });
  });

  it("trata correção 'não é água é pão de cenoura' como alimento corrigido antes da intenção de água", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "Não é água é pão de cenoura",
    });

    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "pão de cenoura",
    });
    expect(logInferenceEventMock).toHaveBeenCalledWith(expect.objectContaining({
      userId: 42,
      origin: "whatsapp",
      eventType: "whatsapp.intent.food_correction_text_detected",
    }));
    expect(result).toEqual(expect.objectContaining({
      draftId: "draft-1",
    }));
  });
});
