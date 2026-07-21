import { beforeEach, describe, expect, it, vi } from "vitest";

const getDbMock = vi.fn();
const listMealsMock = vi.fn();
const removeMealMock = vi.fn();
const processMealDraftMock = vi.fn();
const executeWhatsappDatedFoodAdditionIntentMock = vi.fn();
const executeWhatsappLlmIntentMock = vi.fn();
const executeWhatsappTextIntentMock = vi.fn();
const executeWhatsAppFoodAssistantIntentMock = vi.fn();
const executeWhatsappMultiActionIntentMock = vi.fn();

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
  removeMeal: removeMealMock,
  processMealDraft: processMealDraftMock,
}));

vi.mock("./datedFoodAdditionIntent", () => ({ executeWhatsappDatedFoodAdditionIntent: executeWhatsappDatedFoodAdditionIntentMock }));
vi.mock("./llmIntentActions", () => ({ executeWhatsappLlmIntent: executeWhatsappLlmIntentMock }));
vi.mock("./intentActions", () => ({ executeWhatsappTextIntent: executeWhatsappTextIntentMock }));
vi.mock("./foodAssistant", () => ({ executeWhatsAppFoodAssistantIntent: executeWhatsAppFoodAssistantIntentMock }));
vi.mock("./multiActionIntent", () => ({ executeWhatsappMultiActionIntent: executeWhatsappMultiActionIntentMock }));

const {
  clearWhatsappConversationContext,
  getWhatsappConversationPendingContext,
  registerWhatsappConversationPendingContext,
} = await import("./conversationContext");
const { simulateWhatsappInbound } = await import("./service");

const legacyRegistrarMeal = {
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
};

function compoundResult() {
  return {
    handled: true,
    action: "multi_action_clarification_needed",
    reply: "Revise as ações antes de continuar.",
    eventType: "whatsapp.multi_action.clarification_needed",
    detail: "Comando composto mantido em modo seguro.",
    data: {
      actionCount: 2,
      extractedActions: [
        { actionType: "excluir_alimento" },
        { actionType: "adicionar_alimento" },
      ],
    },
  };
}

describe("simulateWhatsappInbound destructive precedence #856", () => {
  beforeEach(() => {
    clearWhatsappConversationContext();
    getDbMock.mockReset();
    getDbMock.mockResolvedValue(null);
    listMealsMock.mockReset();
    removeMealMock.mockReset();
    processMealDraftMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockReset();
    executeWhatsappLlmIntentMock.mockReset();
    executeWhatsappTextIntentMock.mockReset();
    executeWhatsAppFoodAssistantIntentMock.mockReset();
    executeWhatsappMultiActionIntentMock.mockReset();
    executeWhatsappDatedFoodAdditionIntentMock.mockResolvedValue(null);
    executeWhatsappLlmIntentMock.mockResolvedValue(null);
    executeWhatsappTextIntentMock.mockResolvedValue(null);
    executeWhatsAppFoodAssistantIntentMock.mockReturnValue(null);
    executeWhatsappMultiActionIntentMock.mockReturnValue(null);
  });

  it("não deixa uma seleção alimentar real capturar Excluir o Registrar", async () => {
    registerWhatsappConversationPendingContext(91, {
      action: "record_adjustment_selection_needed",
      reply: "Escolha o alimento.",
      data: {
        options: [{ id: "registrar", label: "Registrar", value: { mealId: 30, itemIndex: 0 } }],
      },
    });
    listMealsMock.mockResolvedValue([legacyRegistrarMeal]);

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
    expect(executeWhatsappMultiActionIntentMock).toHaveBeenCalledOnce();
    expect(executeWhatsappDatedFoodAdditionIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });

  it("mantém comando composto no coordenador all-or-nothing sem fallback nutricional", async () => {
    executeWhatsappMultiActionIntentMock.mockReturnValue(compoundResult());

    const result = await simulateWhatsappInbound(92, {
      text: "Excluir o Registrar e adicionar 100 g de arroz",
      receivedAt: new Date("2026-07-20T15:10:00.000Z"),
      messageId: "compound-destructive-1",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "multi_action_clarification_needed",
      data: expect.objectContaining({ actionCount: 2 }),
    }));
    expect(executeWhatsappMultiActionIntentMock).toHaveBeenCalledTimes(2);
    expect(listMealsMock).not.toHaveBeenCalled();
    expect(executeWhatsappDatedFoodAdditionIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappTextIntentMock).not.toHaveBeenCalled();
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });

  it("substitui exclusão antiga antes de pedir data para um novo comando composto", async () => {
    listMealsMock.mockResolvedValue([legacyRegistrarMeal]);
    await simulateWhatsappInbound(93, {
      text: "Excluir o Registrar",
      receivedAt: new Date("2026-07-20T15:00:00.000Z"),
      messageId: "old-delete-1",
    });

    executeWhatsappMultiActionIntentMock.mockReturnValue(compoundResult());
    const clarification = await simulateWhatsappInbound(93, {
      text: "Adicionar arroz no sábado e excluir o Registrar",
      receivedAt: new Date("2026-07-20T15:10:00.000Z"),
      messageId: "compound-temporal-1",
    });

    expect(clarification).toEqual(expect.objectContaining({
      action: "temporal_context_clarification_needed",
    }));

    executeWhatsappMultiActionIntentMock.mockReturnValue(null);
    const staleConfirmation = await simulateWhatsappInbound(93, {
      text: "sim",
      receivedAt: new Date("2026-07-20T15:11:00.000Z"),
      messageId: "stale-confirmation-1",
    });

    expect(staleConfirmation).not.toEqual(expect.objectContaining({ action: "meal_deleted" }));
    expect(removeMealMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });

  it("bloqueia fallback quando a validação final do comando composto diverge da pré-classificação", async () => {
    executeWhatsappMultiActionIntentMock
      .mockReturnValueOnce(compoundResult())
      .mockReturnValueOnce(null);

    const result = await simulateWhatsappInbound(94, {
      text: "Excluir o Registrar e adicionar arroz",
      receivedAt: new Date("2026-07-20T15:10:00.000Z"),
      messageId: "compound-validation-divergence-1",
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.multi_action.validation_blocked",
      data: expect.objectContaining({ fallbackBlocked: true }),
    }));
    expect(executeWhatsappLlmIntentMock).not.toHaveBeenCalled();
    expect(processMealDraftMock).not.toHaveBeenCalled();
  });
});
