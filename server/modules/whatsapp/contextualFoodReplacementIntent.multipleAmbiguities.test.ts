import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const createPendingMealItemSelectionMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({ listMeals: listMealsMock, updateMeal: updateMealMock }));
vi.mock("./mealItemSelectionCallback", () => ({
  createPendingMealItemSelection: createPendingMealItemSelectionMock,
}));

import { executeWhatsappContextualFoodReplacementIntent } from "./contextualFoodReplacementIntent";

function item(foodName: string) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "50 g",
    servings: 1,
    estimatedGrams: 50,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 4,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

describe("substituições contextuais com múltiplas ambiguidades", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingMealItemSelectionMock.mockResolvedValue({
      handled: true,
      action: "clarification_needed",
      reply: "selecione",
      eventType: "whatsapp.intent.meal_item_selection_requested",
      detail: "pendente",
      data: { remainingSelectionCount: 1 },
    });
  });

  it("preserva cada alimento substituto e não grava antes de todas as escolhas", async () => {
    listMealsMock.mockResolvedValue([
      { id: 1, source: "whatsapp", mealLabel: "Jantar", occurredAt: "2026-07-12T22:00:00.000Z", items: [item("Queijo minas"), item("Pão francês")] },
      { id: 2, source: "whatsapp", mealLabel: "Lanche", occurredAt: "2026-07-12T21:50:00.000Z", items: [item("Queijo mussarela"), item("Pão integral")] },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é queijo, é ricota e não é pão, é tapioca",
      receivedAt: new Date("2026-07-12T22:10:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(createPendingMealItemSelectionMock).toHaveBeenCalledWith(42, expect.objectContaining({
      targetFood: "queijo",
      action: { kind: "replace_food", targetFood: "ricota" },
      remainingSelections: [expect.objectContaining({
        targetFood: "pão",
        action: { kind: "replace_food", targetFood: "tapioca" },
        candidates: expect.arrayContaining([
          expect.objectContaining({ mealId: 1, itemName: "Pão francês" }),
          expect.objectContaining({ mealId: 2, itemName: "Pão integral" }),
        ]),
      })],
    }));
    expect(result?.action).toBe("clarification_needed");
  });
});
