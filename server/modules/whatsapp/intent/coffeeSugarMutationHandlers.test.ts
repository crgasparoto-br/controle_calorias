import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getHabitSnapshots: vi.fn(async () => []),
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
  getHabitSnapshots: mocks.getHabitSnapshots,
}));

vi.mock("../../../nutritionEngine", async importOriginal => {
  const actual = await importOriginal<typeof import("../../../nutritionEngine")>();
  return {
    ...actual,
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
const targetMeal = {
  id: 903,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [{
    foodName: "Café sem açúcar",
    canonicalName: "Café Sem Açúcar",
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 50,
    calories: 2,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.95,
    source: "catalog",
  }],
};

function missingSugarError() {
  return new MealInferenceError(
    "Informe a quantidade de açúcar.",
    {
      code: "food_component_quantity_required",
      context: { component: "açúcar" },
    },
  );
}

describe("mutações de café com açúcar no WhatsApp", () => {
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

  it("abre pendência antes de adicionar à refeição", async () => {
    const result = await handleFoodAdditionIntent(
      7,
      {
        mealLabel: "Café da manhã",
        date: occurredAt,
        items: [{
          foodName: "Café com açúcar",
          quantity: 1,
          unit: "xícara",
        }],
      } as any,
      "America/Sao_Paulo",
      {
        originalText: "Adicionar 1 xícara de café com açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-add-sugar",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      originalFoodText: "1 xícara de Café com açúcar",
      operation: expect.objectContaining({
        kind: "add_to_meal",
        mealId: 903,
      }),
      messageId: "wamid-add-sugar",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });

  it("abre pendência antes de substituir o item", async () => {
    const result = await handleFoodReplacementIntents(
      7,
      [{
        fromFood: "Café sem açúcar",
        toFood: "Café com açúcar",
      }],
      "America/Sao_Paulo",
      {
        originalText: "Trocar café sem açúcar por café com açúcar",
        receivedAt: occurredAt,
        messageId: "wamid-replace-sugar",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      originalFoodText: "1 xícara de Café com açúcar",
      operation: {
        kind: "replace_item",
        mealId: 903,
        itemIndex: 0,
        originalFoodName: "Café sem açúcar",
      },
      messageId: "wamid-replace-sugar",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });
});
