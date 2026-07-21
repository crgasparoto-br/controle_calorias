import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const listMealsMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();

vi.mock("../../db", () => ({
  getAdminWhatsAppTokenStatus: vi.fn(async () => ({ configured: true, source: "test" })),
  getDb: getDbMock,
  getUserWhatsappConnection: vi.fn(),
  logInferenceEvent: vi.fn(),
  logPersistenceWarning: vi.fn(),
  upsertUserWhatsappConnection: vi.fn(),
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: vi.fn(),
  removeMeal: vi.fn(),
  processMealDraft: processMealDraftMock,
}));

vi.mock("./datedFoodAdditionIntent", () => ({ executeWhatsappDatedFoodAdditionIntent: executeWhatsappDatedFoodAdditionIntentMock }));
vi.mock("./llmIntentActions", () => ({ executeWhatsappLlmIntent: executeWhatsappLlmIntentMock }));
vi.mock("./intentActions", () => ({ executeWhatsappTextIntent: executeWhatsappTextIntentMock }));
vi.mock("./foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock }));

const {
  clearWhatsappConversationContext,
  getWhatsappConversationPendingContext,
  registerWhatsappConversationPendingContext,
} = await import("./conversationContext");
const { simulateWhatsappInbound } = await import("./service");

describe("simulateWhatsappInbound destructive precedence #856", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getDbMock.mockReset();
    getDbMock.mockResolvedValue(null);
    listMealsMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
  });

  it("não deixa uma seleção alimentar real capturar Excluir o Registrar", async () => {
    registerWhatsappConversationPendingContext(91, {
      action: "record_adjustment_selection_needed",
      reply: "Escolha o alimento.",
      data: {
        options: [{ id: "registrar", label: "Registrar", value: { mealId: 30, itemIndex: 0 } }],
      },
    });
    listMealsMock.mockResolvedValue([{
      id: 30,
      mealLabel: "Almoço",
      occurredAt: "2026-07-20T15:00:00.000Z",
      notes: null,
      items: [{
        foodName: "Registrar",
        canonicalName: "Registrar",
        portionText: "1 unidade",
        servings: 1,
        estimatedGrams: 0,
        calories: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        confidence: 0.1,
        source: "legacy",
      }],
    }]);

    const result = await simulateWhatsappInbound(91, {
      text: "Excluir o Registrar",
      receivedAt: new Date("2026-07-20T15:10:00.000Z"),
      messageId: "delete-over-context-1",
    });

    expect(result).toEqual(expect.objectContaining({
      eventType: "whatsapp.intent.delete_food_confirmation_requested",
      data: expect.objectContaining({ fallbackBlocked: true }),
    }));
    expect(getWhatsappConversationPendingContext(91)).toBeNull();
    expect(executeWhatsappDatedFoodAdditionIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });
});
