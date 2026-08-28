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
    reply: "Informe a quantidade necessária.",
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
  requestWhatsappCaloricComplementQuantityClarification: mocks.requestClarification,
  requestWhatsappFoodAdditionQuantityClarification: mocks.requestClarification,
}));

vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
}));

vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo atualizado."),
  composeWhatsAppMealActionReplies: vi.fn(async () => "Resumo atualizado."),
}));

import { handleFoodAdditionIntent } from "./foodAdditionHandlers";
import { handleFoodReplacementIntents } from "./foodReplacementHandlers";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const coffeeItem = {
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
  source: "catalog" as const,
};
const coffeeWithSugarItem = {
  foodName: "Café com açúcar",
  canonicalName: "Café com açúcar",
  brand: null,
  quantity: 1,
  unit: "xícara",
  portionText: "1 xícara (200 ml; açúcar estimado 5 g)",
  servings: 1,
  estimatedGrams: 205,
  calories: 22,
  protein: 0,
  carbs: 5,
  fat: 0,
  confidence: 0.95,
  source: "catalog" as const,
};
const targetMeal = {
  id: 903,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [coffeeItem],
};

function draftItem(input: {
  foodName: string;
  canonicalName: string;
  calories: number;
  carbs: number;
  quantity?: number;
  unit?: string;
  estimatedGrams?: number;
  portionText?: string;
}) {
  return {
    foodName: input.foodName,
    canonicalName: input.canonicalName,
    brand: null,
    quantity: input.quantity ?? 1,
    unit: input.unit ?? "unidade",
    portionText: input.portionText ?? "1 unidade",
    servings: 1,
    estimatedGrams: input.estimatedGrams ?? 50,
    calories: input.calories,
    protein: 0,
    carbs: input.carbs,
    fat: 0,
    confidence: 0.9,
    source: "heuristic" as const,
  };
}

function mealResult(items: any[]) {
  return {
    detectedMealLabel: "Café da manhã",
    sourceText: "teste",
    confidence: 0.9,
    needsConfirmation: false,
    reasoning: "resultado canônico controlado no teste",
    items,
    totals: items.reduce(
      (totals, item) => ({
        calories: totals.calories + item.calories,
        protein: totals.protein + item.protein,
        carbs: totals.carbs + item.carbs,
        fat: totals.fat + item.fat,
      }),
      { calories: 0, protein: 0, carbs: 0, fat: 0 },
    ),
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
    mocks.processMealInput.mockResolvedValue(mealResult([coffeeWithSugarItem]));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("adiciona café simples com açúcar usando a média canônica sem abrir pendência", async () => {
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

    expect(result.action).toBe("meal_item_added");
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com açúcar",
    }));
    expect(mocks.updateMeal).toHaveBeenCalledWith(7, expect.objectContaining({
      mealId: 903,
      items: expect.arrayContaining([
        expect.objectContaining({
          canonicalName: "Café com açúcar",
          estimatedGrams: 205,
          calories: 22,
          carbs: 5,
        }),
      ]),
    }));
    expect(mocks.requestClarification).not.toHaveBeenCalled();
  });

  it("resolve adições múltiplas de forma independente e preserva o café canônico", async () => {
    const breadItem = draftItem({
      foodName: "Pão francês",
      canonicalName: "Pão francês",
      calories: 135,
      carbs: 28,
      quantity: 50,
      unit: "g",
      estimatedGrams: 50,
      portionText: "50 g",
    });
    mocks.processMealInput.mockReset();
    mocks.processMealInput
      .mockResolvedValueOnce(mealResult([breadItem]))
      .mockResolvedValueOnce(mealResult([coffeeWithSugarItem]));

    const result = await handleFoodAdditionIntent(
      7,
      {
        mealLabel: "Café da manhã",
        date: occurredAt,
        items: [
          { foodName: "Pão francês", quantity: 50, unit: "g" },
          { foodName: "Café com açúcar", quantity: 1, unit: "xícara" },
        ],
      } as any,
      "America/Sao_Paulo",
      {
        originalText: "Adicionar 50 g de pão e 1 xícara de café com açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-add-multiple-sugar",
      },
    );

    expect(result.action).toBe("meal_item_added");
    expect(mocks.processMealInput).toHaveBeenNthCalledWith(1, expect.objectContaining({
      text: "50 g de Pão francês",
    }));
    expect(mocks.processMealInput).toHaveBeenNthCalledWith(2, expect.objectContaining({
      text: "1 xícara de Café com açúcar",
    }));
    const updateInput = mocks.updateMeal.mock.calls[0][1];
    expect(updateInput.items.at(-2)).toEqual(expect.objectContaining({
      foodName: "Pão francês",
      estimatedGrams: 50,
    }));
    expect(updateInput.items.at(-1)).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));
    expect(mocks.requestClarification).not.toHaveBeenCalled();
  });

  it("substitui café sem açúcar por café com açúcar usando a mesma regra canônica", async () => {
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

    expect(result.action).toBe("meal_item_replaced");
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com açúcar",
    }));
    expect(mocks.updateMeal).toHaveBeenCalled();
    expect(mocks.requestClarification).not.toHaveBeenCalled();
  });

  it("preserva substituições companheiras quando a troca de café usa a média canônica", async () => {
    mocks.listMeals.mockResolvedValueOnce([{
      ...targetMeal,
      items: [
        draftItem({
          foodName: "Banana",
          canonicalName: "Banana",
          calories: 72,
          carbs: 19,
        }),
        coffeeItem,
      ],
    }]);

    const result = await handleFoodReplacementIntents(
      7,
      [
        { fromFood: "Banana", toFood: "Maçã" },
        { fromFood: "Café sem açúcar", toFood: "Café com açúcar" },
      ],
      "America/Sao_Paulo",
      {
        originalText: "Trocar banana por maçã e café sem açúcar por café com açúcar",
        receivedAt: occurredAt,
        messageId: "wamid-replace-batch-sugar",
      },
    );

    expect(result.action).toBe("meal_item_replaced");
    expect(mocks.updateMeal).toHaveBeenCalled();
    expect(mocks.processMealInput).toHaveBeenCalledWith(expect.objectContaining({
      text: "1 xícara de Café com açúcar",
    }));
    expect(mocks.requestClarification).not.toHaveBeenCalled();
  });
});
