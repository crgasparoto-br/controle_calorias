import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const updateMealWithLearningMock = vi.hoisted(() => vi.fn());
const createPendingMock = vi.hoisted(() => vi.fn(async () => ({
  reply: "Escolha o item",
  eventType: "whatsapp.intent.clarification_needed",
  interactiveReply: undefined,
  data: {},
})));

vi.mock("../../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
  updateMealWithHouseholdMeasureLearning: updateMealWithLearningMock,
}));
vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Quantidade corrigida"),
  composeWhatsAppMealActionReplies: vi.fn(async () => "Quantidades corrigidas"),
}));
vi.mock("../mealItemSelectionCallback", () => ({
  createPendingMealItemSelection: createPendingMock,
}));

import { handleQuantityCorrectionIntent } from "./gramsAdjustmentHandlers";

function item(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "Presunto cozido",
    canonicalName: "presunto cozido",
    brand: "Marca A",
    portionText: "4 fatias (aprox. 72 g)",
    quantity: 4,
    unit: "fatia",
    servings: 4,
    estimatedGrams: 72,
    calories: 120,
    protein: 18,
    carbs: 2,
    fat: 4,
    confidence: 0.8,
    source: "hybrid",
    ...overrides,
  };
}

function meal(items: unknown[]) {
  return {
    id: 901,
    userId: 71,
    mealLabel: "almoço",
    occurredAt: new Date("2026-09-03T15:00:00.000Z"),
    notes: null,
    items,
  };
}

const correction = {
  previousQuantity: 4,
  previousUnit: "fatia",
  nextQuantity: 80,
  nextUnit: "g",
} as any;

describe("handleQuantityCorrectionIntent learning (#1043)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("envia mutação e aprendizado juntos com o snapshot original", async () => {
    const originalItem = item();
    const originalMeal = meal([originalItem]);
    listMealsMock.mockResolvedValue([originalMeal]);
    updateMealWithLearningMock.mockResolvedValue({
      ...originalMeal,
      items: [item({ quantity: 80, unit: "g", estimatedGrams: 80 })],
    });

    const result = await handleQuantityCorrectionIntent(71, correction);

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(updateMealWithLearningMock).toHaveBeenCalledTimes(1);
    expect(updateMealWithLearningMock).toHaveBeenCalledWith(
      71,
      expect.objectContaining({ mealId: 901 }),
      {
        expectedOriginalItem: expect.objectContaining({
          foodName: "Presunto cozido",
          quantity: 4,
          unit: "fatia",
          estimatedGrams: 72,
        }),
        relation: {
          userId: 71,
          foodName: "Presunto cozido",
          brand: "Marca A",
          originalQuantity: 4,
          originalUnit: "fatia",
          correctedQuantity: 80,
          correctedUnit: "g",
        },
      },
    );
  });

  it("propaga falha do boundary atômico sem executar fallback não transacional", async () => {
    listMealsMock.mockResolvedValue([meal([item()])]);
    updateMealWithLearningMock.mockRejectedValue(new Error("stale correction"));

    await expect(handleQuantityCorrectionIntent(71, correction)).rejects.toThrow("stale correction");
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("não tenta aprender quando o alvo da correção é ambíguo", async () => {
    listMealsMock.mockResolvedValue([meal([
      item({ foodName: "Presunto cozido A", canonicalName: "presunto cozido a" }),
      item({ foodName: "Presunto cozido B", canonicalName: "presunto cozido b" }),
    ])]);

    const result = await handleQuantityCorrectionIntent(71, correction);

    expect(result.action).toBe("clarification_needed");
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(updateMealWithLearningMock).not.toHaveBeenCalled();
  });

  it("retry envia a mesma identidade lógica para o upsert idempotente", async () => {
    const originalMeal = meal([item()]);
    listMealsMock.mockResolvedValue([originalMeal]);
    updateMealWithLearningMock.mockResolvedValue(originalMeal);

    await handleQuantityCorrectionIntent(71, correction);
    await handleQuantityCorrectionIntent(71, correction);

    expect(updateMealWithLearningMock).toHaveBeenCalledTimes(2);
    expect(updateMealWithLearningMock.mock.calls[0][2].relation)
      .toEqual(updateMealWithLearningMock.mock.calls[1][2].relation);
    expect(updateMealWithLearningMock.mock.calls[0][2].expectedOriginalItem)
      .toEqual(updateMealWithLearningMock.mock.calls[1][2].expectedOriginalItem);
  });
});
