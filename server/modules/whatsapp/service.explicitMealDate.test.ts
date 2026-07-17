import { beforeEach, describe, expect, it, vi } from "vitest";

const getAdminWhatsAppTokenStatusMock = vi.fn();
const getUserWhatsappConnectionMock = vi.fn();
const logInferenceEventMock = vi.fn();
const upsertUserWhatsappConnectionMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsappMultiActionIntentMock = vi.fn();
const executeWhatsappRecordAdjustmentIntentMock = vi.fn();
const executeWhatsappGramsAdjustmentIntentMock = vi.fn();
const executeWhatsappGramsIncrementIntentMock = vi.fn();
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

vi.mock("../professionals/service", () => ({
  processProfessionalAccessWhatsappResponse: vi.fn().mockResolvedValue(null),
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

vi.mock("./multiActionIntent", () => ({
  executeWhatsappMultiActionIntent: executeWhatsappMultiActionIntentMock,
}));

vi.mock("./recordAdjustmentIntent", () => ({
  executeWhatsappRecordAdjustmentIntent: executeWhatsappRecordAdjustmentIntentMock,
}));

vi.mock("./gramsAdjustmentIntent", () => ({
  executeWhatsappGramsAdjustmentIntent: executeWhatsappGramsAdjustmentIntentMock,
}));

vi.mock("./gramsIncrementIntent", () => ({
  executeWhatsappGramsIncrementIntent: executeWhatsappGramsIncrementIntentMock,
}));

vi.mock("./foodAssistant", () => ({
  executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock,
}));

const { clearWhatsappConversationContext } = await import("./conversationContext");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound explicit meal dates", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getAdminWhatsAppTokenStatusMock.mockReset();
    getUserWhatsappConnectionMock.mockReset();
    logInferenceEventMock.mockReset();
    upsertUserWhatsappConnectionMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsappMultiActionIntentMock.mockReset();
    executeWhatsappRecordAdjustmentIntentMock.mockReset();
    executeWhatsappGramsAdjustmentIntentMock.mockReset();
    executeWhatsappGramsIncrementIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();

    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue({
      handled: true,
      action: "meal_item_added",
      reply: "Adicionei na refeição de hoje.",
      eventType: "whatsapp.intent.meal_item_added",
      detail: "Handler textual genérico chamado indevidamente.",
    });
    executeWhatsappMultiActionIntentMock.mockReturnValue(null);
    executeWhatsappRecordAdjustmentIntentMock.mockResolvedValue(null);
    executeWhatsappGramsAdjustmentIntentMock.mockResolvedValue(null);
    executeWhatsappGramsIncrementIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    processMealDraftMock.mockResolvedValue({
      draftId: "draft-cafe-ontem",
      processed: { items: [] },
      media: [],
    });
  });

  it("nao deixa o handler textual salvar em hoje quando a mensagem menciona cafe da manha de ontem", async () => {
    const result = await simulateWhatsappInbound(42, {
      text: "Adicionar 3 xícara de café sem açúcar à refeição Café da manhã de ontem",
      receivedAt: new Date("2026-06-30T21:23:00.000Z"),
      userTimezone: "America/Sao_Paulo",
      messageId: "cafe-ontem-1",
    });

    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).toHaveBeenCalledWith(42, {
      source: "whatsapp",
      text: "Adicionar 3 xícara de café sem açúcar à refeição Café da manhã de ontem",
    }, "America/Sao_Paulo");
    expect(result).toEqual(expect.objectContaining({
      draftId: "draft-cafe-ontem",
      temporalContext: expect.objectContaining({
        temporalExpression: "ontem",
        resolvedDate: "2026-06-29",
        mealSlot: "cafe_da_manha",
      }),
    }));
  });
});
