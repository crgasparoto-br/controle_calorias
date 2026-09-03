import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const persistLearnedMock = vi.hoisted(() => vi.fn(async () => true));
const createPendingMock = vi.hoisted(() => vi.fn(async () => ({
  reply: "Escolha o item",
  eventType: "whatsapp.intent.clarification_needed",
  interactiveReply: undefined,
  data: {},
})));

vi.mock("../../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));
vi.mock("../../../householdMeasureResolutionStore", () => ({
  persistUserLearnedHouseholdMeasure: persistLearnedMock,
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
    source: "ai",
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
    persistLearnedMock.mockResolvedValue(true);
  });

  it("persiste aprendizado somente depois que a mutação da refeição conclui", async () => {
    const originalMeal = meal([item()]);
    listMealsMock.mockResolvedValue([originalMeal]);
    updateMealMock.mockResolvedValue({ ...originalMeal, items: [item({ quantity: 80, unit: "g", estimatedGrams: 80 })] });

    const result = await handleQuantityCorrectionIntent(71, correction);

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(persistLearnedMock).toHaveBeenCalledWith({
      userId: 71,
      foodName: "Presunto cozido",
      brand: "Marca A",
      originalQuantity: 4,
      originalUnit: "fatia",
      correctedQuantity: 80,
      correctedUnit: "g",
    });
    expect(updateMealMock.mock.invocationCallOrder[0]).toBeLessThan(persistLearnedMock.mock.invocationCallOrder[0]);
  });

  it("não aprende quando a atualização da refeição falha", async () => {
    listMealsMock.mockResolvedValue([meal([item()])]);
    updateMealMock.mockRejectedValue(new Error("write failed"));

    await expect(handleQuantityCorrectionIntent(71, correction)).rejects.toThrow("write failed");
    expect(persistLearnedMock).not.toHaveBeenCalled();
  });

  it("não aprende quando o alvo da correção é ambíguo", async () => {
    listMealsMock.mockResolvedValue([meal([
      item({ foodName: "Presunto cozido A" }),
      item({ foodName: "Presunto cozido B" }),
    ])]);

    const result = await handleQuantityCorrectionIntent(71, correction);

    expect(result.action).toBe("clarification_needed");
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(persistLearnedMock).not.toHaveBeenCalled();
  });

  it("uma reentrega confirmada executa o mesmo upsert lógico sem alterar a identidade aprendida", async () => {
    const originalMeal = meal([item()]);
    listMealsMock.mockResolvedValue([originalMeal]);
    updateMealMock.mockResolvedValue(originalMeal);

    await handleQuantityCorrectionIntent(71, correction);
    await handleQuantityCorrectionIntent(71, correction);

    expect(persistLearnedMock).toHaveBeenCalledTimes(2);
    expect(persistLearnedMock.mock.calls[0][0]).toEqual(persistLearnedMock.mock.calls[1][0]);
  });
});
