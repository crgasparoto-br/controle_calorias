import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());
const createPendingOperationMock = vi.hoisted(() => vi.fn());

vi.mock("../../db", () => ({ getDb: vi.fn(), logPersistenceWarning: vi.fn() }));
vi.mock("../meals/service", () => ({ listMeals: listMealsMock, updateMeal: updateMealMock }));
vi.mock("../../repositories/whatsappPendingOperationRepository", () => ({
  createDrizzleWhatsAppPendingOperationRepository: () => ({
    createPendingOperation: createPendingOperationMock,
    getActivePendingOperation: vi.fn(),
    claimPendingOperation: vi.fn(),
    cancelPendingOperation: vi.fn(),
  }),
}));

import { completeMealItemSelectionInteractiveCallback, type PendingMealItemSelection } from "./mealItemSelectionCallback";

function item(foodName: string) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "50 g",
    quantity: 50,
    unit: "g",
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

describe("meal item selection — ambiguidades encadeadas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createPendingOperationMock.mockResolvedValue({ id: 999 });
    const meals = [
      { id: 1, mealLabel: "Jantar", occurredAt: "2026-07-12T22:00:00.000Z", notes: null, items: [item("Queijo minas"), item("Pão francês")] },
      { id: 2, mealLabel: "Lanche", occurredAt: "2026-07-12T21:00:00.000Z", notes: null, items: [item("Queijo mussarela"), item("Pão integral")] },
    ];
    listMealsMock.mockResolvedValue(meals);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));
  });

  it("não escreve na primeira escolha e aplica todas as ações somente após a última", async () => {
    const firstPending: PendingMealItemSelection = {
      targetFood: "queijo",
      action: { kind: "replace_food", targetFood: "ricota" },
      contextLabel: "nas refeições recentes",
      resultTitle: "Alimentos substituídos",
      candidates: [
        { mealId: 1, mealLabel: "Jantar", itemIndex: 0, itemName: "Queijo minas" },
        { mealId: 2, mealLabel: "Lanche", itemIndex: 0, itemName: "Queijo mussarela" },
      ],
      remainingSelections: [{
        targetFood: "pão",
        action: { kind: "replace_food", targetFood: "tapioca" },
        contextLabel: "nas refeições recentes",
        candidates: [
          { mealId: 1, mealLabel: "Jantar", itemIndex: 1, itemName: "Pão francês" },
          { mealId: 2, mealLabel: "Lanche", itemIndex: 1, itemName: "Pão integral" },
        ],
      }],
    };

    const firstResult = await completeMealItemSelectionInteractiveCallback(42, { target: firstPending }, "select:0");

    expect(firstResult.action).toBe("clarification_needed");
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(createPendingOperationMock).toHaveBeenCalledOnce();
    const secondPending = createPendingOperationMock.mock.calls[0][0].target as PendingMealItemSelection;
    expect(secondPending.companionActions).toEqual([
      { candidate: firstPending.candidates[0], action: { kind: "replace_food", targetFood: "ricota" } },
    ]);
    expect(secondPending.action).toEqual({ kind: "replace_food", targetFood: "tapioca" });

    const finalResult = await completeMealItemSelectionInteractiveCallback(42, { target: secondPending }, "select:1");

    expect(updateMealMock).toHaveBeenCalledTimes(2);
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 1,
      items: expect.arrayContaining([expect.objectContaining({ foodName: "ricota" })]),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 2,
      items: expect.arrayContaining([expect.objectContaining({ foodName: "tapioca" })]),
    }));
    expect(finalResult.action).toBe("meal_item_replaced");
    expect(finalResult.data).toEqual(expect.objectContaining({ actionCount: 2, affectedMealIds: expect.arrayContaining([1, 2]) }));
    expect(finalResult.reply.match(/Total da refeição:/g)).toHaveLength(2);
  });
});
