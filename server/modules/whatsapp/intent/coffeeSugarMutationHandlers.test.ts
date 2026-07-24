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
    estimatedGrams: 200,
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

function draftItem(input: {
  foodName: string;
  canonicalName: string;
  calories: number;
  carbs: number;
}) {
  return {
    foodName: input.foodName,
    canonicalName: input.canonicalName,
    brand: null,
    quantity: 1,
    unit: "unidade",
    portionText: "1 unidade",
    servings: 1,
    estimatedGrams: 50,
    calories: input.calories,
    protein: 0,
    carbs: input.carbs,
    fat: 0,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

describe("mutações de café com açúcar no WhatsApp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(occurredAt);
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.updateMeal.mockImplementation(async (_userId: number, input: any) => ({
      ...targetMeal,
      ...input,
      id: input.mealId,
    }));
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

  it("usa o café resolvido, e não o primeiro item retornado, em adição com vários alimentos", async () => {
    mocks.processMealInput.mockResolvedValueOnce({
      detectedMealLabel: "Café da manhã",
      sourceText: "1 xícara de Café com açúcar",
      confidence: 0.9,
      needsConfirmation: false,
      reasoning: "itens deliberadamente fora da ordem do alvo",
      items: [
        draftItem({
          foodName: "Pão francês",
          canonicalName: "Pão francês",
          calories: 135,
          carbs: 28,
        }),
        {
          ...draftItem({
            foodName: "Café com açúcar",
            canonicalName: "Café com açúcar",
            calories: 34,
            carbs: 8,
          }),
          unit: "xícara",
          portionText: "1 xícara",
          estimatedGrams: 200,
        },
      ],
      totals: { calories: 169, protein: 0, carbs: 36, fat: 0 },
    });

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
        originalText: "Adicionar pão e 1 xícara de café com açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-add-multiple-sugar",
      },
    );

    expect(result.action).toBe("meal_item_added");
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com açúcar",
    }));
    const updateInput = mocks.updateMeal.mock.calls[0][1];
    expect(updateInput.items.at(-2).foodName).toBe("Pão francês");
    expect(updateInput.items.at(-1)).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 34,
      carbs: 8,
    }));
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
