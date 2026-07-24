import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHabitSnapshots: vi.fn(async () => []),
  processMealInput: vi.fn(),
  requestClarification: vi.fn(async () => ({
    handled: true,
    action: "food_clarification_requested",
    reply: "Informe somente a quantidade de açúcar.",
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pendência persistida.",
  })),
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
}));

vi.mock("../../../db", () => ({
  getHabitSnapshots: mocks.getHabitSnapshots,
}));

vi.mock("../../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    readonly code: string;

    constructor(message = "Não foi possível processar a refeição.", options: { code?: string } = {}) {
      super(message);
      this.name = "MealInferenceError";
      this.code = options.code ?? "meal_inference_unavailable";
    }
  }

  return {
    MealInferenceError,
    processMealInput: mocks.processMealInput,
  };
});

vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: mocks.requestClarification,
}));

vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
}));

vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo atualizado."),
}));

import { MealInferenceError } from "../../../nutritionEngine";
import { handleFoodAdditionIntent } from "./foodAdditionHandlers";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const targetMeal = {
  id: 903,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [],
};

describe("adição composta com café adoçado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.processMealInput.mockRejectedValue(new MealInferenceError(
      "Informe a quantidade de açúcar.",
      { code: "food_component_quantity_required" },
    ));
  });

  it("persiste na pendência o lote alimentar completo antes da pergunta", async () => {
    const result = await handleFoodAdditionIntent(
      7,
      {
        mealLabel: "Café da manhã",
        date: occurredAt,
        items: [
          { foodName: "Pão francês", quantity: 1, unit: "unidade" },
          { foodName: "Café com açúcar", quantity: 1, unit: "xícara" },
        ],
      } as any,
      "America/Sao_Paulo",
      {
        originalText: "Adicionar pão e café com açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-composite-addition",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      originalFoodText: "1 unidade de Pão francês e 1 xícara de Café com açúcar",
      originalText: "Adicionar pão e café com açúcar ao café da manhã",
      operation: expect.objectContaining({
        kind: "add_to_meal",
        mealId: 903,
      }),
      messageId: "wamid-composite-addition",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });
});
