import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.hoisted(() => vi.fn());
const logInferenceEventMock = vi.hoisted(() => vi.fn());
const processMealDraftMock = vi.hoisted(() => vi.fn());
const executeWhatsappContextualFoodReplacementIntentMock = vi.hoisted(() =>
  vi.fn()
);
const executeWhatsappDatedFoodAdditionIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsappLlmIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsappTextIntentMock = vi.hoisted(() => vi.fn());
const executeWhatsAppFoodAssistantIntentMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: vi.fn(),
  getDb: getDbMock,
  getUserWhatsappConnection: vi.fn(),
  logInferenceEvent: logInferenceEventMock,
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  processMealDraft: processMealDraftMock,
}));

vi.mock("./contextualFoodReplacementIntent", () => ({
  executeWhatsappContextualFoodReplacementIntent:
    executeWhatsappContextualFoodReplacementIntentMock,
}));
vi.mock("./datedFoodAdditionIntent", () => ({
  executeWhatsappDatedFoodAdditionIntent:
    executeWhatsappDatedFoodAdditionIntentMock,
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

describe("simulateWhatsappInbound com substituições multiline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearWhatsappConversationContext();
    getDbMock.mockResolvedValue(null);
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappContextualFoodReplacementIntentMock.mockResolvedValue({
      action: "meal_item_replaced",
      reply:
        "Requeijão → maionese\nPresunto → mortadela defumada\n\nResumo atualizado",
      eventType: "whatsapp.intent.meal_item_replaced",
      detail: "2 alimento(s) substituído(s) com estado atual recarregado.",
      data: { mealId: 10, mealIds: [10] },
    });
  });

  it("alcança o handler contextual e não segue para fallback", async () => {
    const text =
      "Não é requeijão, é maionese.\nNão é presunto, é mortadela defumada";
    const receivedAt = new Date("2026-07-26T12:05:00.000Z");

    const result = await simulateWhatsappInbound(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
      messageId: "issue-918-simulator",
    });

    expect(
      executeWhatsappContextualFoodReplacementIntentMock
    ).toHaveBeenCalledOnce();
    expect(
      executeWhatsappContextualFoodReplacementIntentMock
    ).toHaveBeenCalledWith(42, {
      text,
      receivedAt,
      userTimezone: "America/Sao_Paulo",
    });
    expect(result).toEqual(
      expect.objectContaining({
        handled: true,
        action: "meal_item_replaced",
        data: expect.objectContaining({ mealIds: [10] }),
      })
    );
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });
});
