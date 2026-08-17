import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getHabitSnapshots: vi.fn(async () => []),
  getUserWhatsappConnection: vi.fn(),
  logPersistenceWarning: vi.fn(),
  normalizeWhatsAppPhoneNumber: vi.fn((value: string) => value),
  processMealInput: vi.fn(),
  requestClarification: vi.fn(async () => ({
    handled: true,
    action: "food_clarification_requested",
    reply: "Informe somente a quantidade de açúcar em gramas.",
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pendência persistida.",
  })),
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
}));

vi.mock("../../../db", () => ({
  getDb: mocks.getDb,
  getHabitSnapshots: mocks.getHabitSnapshots,
  getUserWhatsappConnection: mocks.getUserWhatsappConnection,
  logPersistenceWarning: mocks.logPersistenceWarning,
  normalizeWhatsAppPhoneNumber: mocks.normalizeWhatsAppPhoneNumber,
}));

vi.mock("../../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    readonly code: string;
    readonly context?: Record<string, unknown>;

    constructor(
      message = "Não foi possível processar a refeição.",
      options: { code?: string; context?: Record<string, unknown> } = {},
    ) {
      super(message);
      this.name = "MealInferenceError";
      this.code = options.code ?? "meal_inference_unavailable";
      this.context = options.context;
    }
  }

  return {
    MealInferenceError,
    processMealInput: mocks.processMealInput,
  };
});

vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification:
    mocks.requestClarification,
}));

vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
}));

vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo atualizado."),
  composeWhatsAppMealActionReplies: vi.fn(async () => "Resumo atualizado."),
}));

import { MealInferenceError } from "../../../nutritionEngine";
import { handleFoodAdditionIntent } from "./foodAdditionHandlers";
import { handleFoodReplacementIntents } from "./foodReplacementHandlers";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const coffeeItem = {
  foodName: "Café sem açúcar",
  canonicalName: "Café sem açúcar",
  brand: null,
  quantity: 1,
  unit: "xícara",
  portionText: "1 xícara",
  servings: 1,
  estimatedGrams: 200,
  calories: 2,
  protein: 0,
  carbs: 0,
  fat: 0,
  confidence: 0.95,
  source: "catalog",
};
const targetMeal = {
  id: 903,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [coffeeItem],
};

function missingSugarError() {
  return new MealInferenceError("Informe a quantidade de açúcar.", {
    code: "food_component_quantity_required",
    context: { component: "açúcar" },
  });
}

describe("mutações com café e açúcar coordenados", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(occurredAt);
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.processMealInput.mockRejectedValue(missingSugarError());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("abre pendência antes de adicionar café com leite e açúcar", async () => {
    const result = await handleFoodAdditionIntent(
      7,
      {
        mealLabel: "Café da manhã",
        date: occurredAt,
        items: [{
          foodName: "Café com leite e açúcar",
          quantity: 1,
          unit: "xícara",
        }],
      } as any,
      "America/Sao_Paulo",
      {
        originalText: "Adicionar 1 xícara de café com leite e açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-add-coordinated-sugar",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com leite e açúcar",
    }));
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      originalFoodText: "1 xícara de Café com leite e açúcar",
      operation: expect.objectContaining({
        kind: "add_to_meal",
        mealId: 903,
      }),
      messageId: "wamid-add-coordinated-sugar",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });

  it("abre pendência antes de substituir por café com leite e açúcar", async () => {
    const result = await handleFoodReplacementIntents(
      7,
      [{
        fromFood: "Café sem açúcar",
        toFood: "Café com leite e açúcar",
      }],
      "America/Sao_Paulo",
      {
        originalText: "Trocar café sem açúcar por café com leite e açúcar",
        receivedAt: occurredAt,
        messageId: "wamid-replace-coordinated-sugar",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com leite e açúcar",
    }));
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      originalFoodText: "1 xícara de Café com leite e açúcar",
      operation: expect.objectContaining({
        kind: "replace_item",
        mealId: 903,
        itemIndex: 0,
        originalFoodName: "Café sem açúcar",
      }),
      messageId: "wamid-replace-coordinated-sugar",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });
});
