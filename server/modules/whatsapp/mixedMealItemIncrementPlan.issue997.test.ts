import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  getFood: vi.fn(),
  convert: vi.fn(),
  updateBatch: vi.fn(),
  requestQuantity: vi.fn(),
  createSelection: vi.fn(),
  compose: vi.fn(),
}));

vi.mock("../meals/service", () => ({ listMeals: mocks.listMeals }));
vi.mock("../foods/service", () => ({
  getGlobalFoodCatalogItem: mocks.getFood,
  convertFoodPortionToGrams: mocks.convert,
}));
vi.mock("./mealBatchMutation", () => ({
  updateMealsWithCompensation: mocks.updateBatch,
  describeMealBatchMutationFailure: () => ({ userMessage: "falhou", detail: "falhou", rollbackSucceeded: true }),
}));
vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappMealItemIncrementQuantityClarification: mocks.requestQuantity,
}));
vi.mock("./mealItemSelectionCallback", () => ({ createPendingMealItemSelection: mocks.createSelection }));
vi.mock("./mealActionReplyComposer", () => ({ composeWhatsAppMealActionReplies: mocks.compose }));

import { continueMixedMealItemIncrementPlan } from "./mixedMealItemIncrementPlan";

function item(foodName: string, grams: number, foodId?: number) {
  return {
    ...(foodId ? { foodId } : {}),
    foodName,
    canonicalName: foodName,
    quantity: grams,
    unit: "g",
    portionText: `${grams} g`,
    servings: 1,
    estimatedGrams: grams,
    calories: grams,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: 0.8,
    source: "catalog" as const,
  };
}

function meal(items: ReturnType<typeof item>[]) {
  return {
    id: 10,
    mealLabel: "Café da manhã",
    occurredAt: new Date("2026-08-22T10:00:00.000Z"),
    notes: "",
    items,
  };
}

const basePlan = {
  contractVersion: 1 as const,
  originalText: "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
  mealLabel: null,
  timeZone: "America/Sao_Paulo",
  operations: [
    { targetFood: "requeijao", quantity: 48, unit: "g" as const },
    { targetFood: "presunto", quantity: 1, unit: "fatia" as const },
    { targetFood: "mussarela", quantity: 1, unit: "fatia" as const, inheritedUnit: true },
  ],
};

describe("issue #997 atomic mixed increment plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.compose.mockResolvedValue("ok");
    mocks.requestQuantity.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "informe peso",
      eventType: "whatsapp.food_clarification.requested",
      detail: "pendente",
    });
  });

  it("não persiste os 48 g enquanto uma fatia ainda precisa de clarificação", async () => {
    mocks.listMeals.mockResolvedValue(meal([
      item("Requeijão Catupiry Light", 45, 1),
      item("Presunto", 20),
      item("Mussarela", 20),
    ]));

    const result = await continueMixedMealItemIncrementPlan(42, basePlan);

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
    const persistedPlan = mocks.requestQuantity.mock.calls[0][0].plan;
    expect(persistedPlan.operations[0].gramsDelta).toBe(48);
    expect(persistedPlan.operations[1].gramsDelta).toBeUndefined();
  });

  it("usa a porção persistida do alimento e o conversor canônico antes do lote", async () => {
    const initial = meal([
      item("Requeijão Catupiry Light", 45, 1),
      item("Presunto", 20, 2),
      item("Mussarela", 20, 3),
    ]);
    mocks.listMeals.mockResolvedValue(initial);
    mocks.getFood.mockImplementation(async (_userId: number, foodId: number) => ({
      id: foodId,
      portions: [{ id: foodId * 10, label: "1 fatia", unit: "fatia", quantity: 1, grams: foodId === 2 ? 20 : 30 }],
    }));
    mocks.convert.mockImplementation(async (_userId: number, input: { foodId: number }) => ({
      grams: input.foodId === 2 ? 20 : 30,
    }));
    mocks.updateBatch.mockResolvedValue(initial);

    const result = await continueMixedMealItemIncrementPlan(42, basePlan);

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(mocks.updateBatch).toHaveBeenCalledTimes(1);
    expect(mocks.requestQuantity).not.toHaveBeenCalled();
  });

  it("revalida o alvo imediatamente antes da escrita e bloqueia plano stale", async () => {
    const initial = meal([item("Requeijão Catupiry Light", 45)]);
    const changed = meal([item("Outro alimento", 45)]);
    mocks.listMeals.mockResolvedValueOnce(initial).mockResolvedValueOnce(changed);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "requeijao", quantity: 48, unit: "g" }],
    });

    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_plan_stale");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });
});
