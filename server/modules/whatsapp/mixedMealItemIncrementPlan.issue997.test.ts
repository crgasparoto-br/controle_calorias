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

function item(
  foodName: string,
  grams: number,
  foodId?: number,
  overrides: Partial<{
    canonicalName: string;
    brand: string;
    foodCatalogId: number;
    portionId: number;
    portionQuantity: number;
  }> = {},
) {
  return {
    ...(foodId ? { foodId } : {}),
    ...(overrides.foodCatalogId ? { foodCatalogId: overrides.foodCatalogId } : {}),
    ...(overrides.portionId ? { portionId: overrides.portionId } : {}),
    ...(overrides.portionQuantity ? { portionQuantity: overrides.portionQuantity } : {}),
    foodName,
    canonicalName: overrides.canonicalName ?? foodName,
    ...(overrides.brand ? { brand: overrides.brand } : {}),
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
    mocks.listMeals.mockResolvedValue([meal([
      item("Requeijão Catupiry Light", 45, 1),
      item("Presunto", 20),
      item("Mussarela", 20),
    ])]);

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
    mocks.listMeals.mockResolvedValue([initial]);
    mocks.getFood.mockImplementation(async (_userId: number, foodId: number) => ({
      id: foodId,
      portions: [{ id: foodId * 10, label: "1 fatia", unit: "fatia", quantity: 1, grams: foodId === 2 ? 20 : 30 }],
    }));
    mocks.convert.mockImplementation(async (_userId: number, input: { foodId: number }) => ({
      grams: input.foodId === 2 ? 20 : 30,
    }));
    mocks.updateBatch.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, basePlan);

    expect(result.action).toBe("meal_item_grams_adjusted");
    expect(mocks.convert).toHaveBeenCalledTimes(2);
    expect(mocks.updateBatch).toHaveBeenCalledTimes(1);
    expect(mocks.requestQuantity).not.toHaveBeenCalled();
  });

  it("revalida o alvo imediatamente antes da escrita e bloqueia plano stale", async () => {
    const initial = meal([item("Requeijão Catupiry Light", 45)]);
    const changed = meal([item("Outro alimento", 45)]);
    mocks.listMeals.mockResolvedValueOnce([initial]).mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "requeijao", quantity: 48, unit: "g" }],
    });

    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_plan_stale");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("bloqueia substituição no mesmo índice quando o nome permanece igual mas o foodId mudou", async () => {
    const initial = meal([item("Presunto", 20, 101)]);
    const changed = meal([item("Presunto", 20, 202)]);
    mocks.listMeals.mockResolvedValueOnce([initial]).mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_plan_stale");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("reidentifica o item selecionado quando homônimos com foodId distintos trocam de posição", async () => {
    const initial = meal([
      item("Presunto", 20, 101),
      item("Presunto", 20, 202),
    ]);
    mocks.listMeals.mockResolvedValue([initial]);

    await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    const pendingSelection = mocks.createSelection.mock.calls[0][1];
    const selected = pendingSelection.candidates[0];
    expect(selected.itemFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const changed = meal([
      item("Presunto", 20, 202),
      item("Presunto", 20, 101),
    ]);
    mocks.listMeals.mockReset();
    mocks.listMeals.mockResolvedValue([changed]);
    mocks.updateBatch.mockResolvedValue([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{
        targetFood: "presunto",
        quantity: 10,
        unit: "g",
        target: selected,
        gramsDelta: 10,
        resolvedBy: "explicit_mass_or_volume",
      }],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].foodId).toBe(202);
    expect(changes[0].after.items[0].estimatedGrams).toBe(20);
    expect(changes[0].after.items[1].foodId).toBe(101);
    expect(changes[0].after.items[1].estimatedGrams).toBe(30);
  });

  it("usa identidade semântica para itens sem foodId e bloqueia troca de marca com o mesmo nome", async () => {
    const initial = meal([item("Presunto", 20, undefined, { brand: "Sadia" })]);
    const changed = meal([item("Presunto", 20, undefined, { brand: "Perdigão" })]);
    mocks.listMeals.mockResolvedValueOnce([initial]).mockResolvedValueOnce([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_plan_stale");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("permite que um item sem foodId mude de índice quando a identidade permanece inequívoca", async () => {
    const initial = meal([
      item("Presunto", 20, undefined, { brand: "Sadia" }),
      item("Queijo minas", 30, undefined, { brand: "Marca B" }),
    ]);
    const changed = meal([
      item("Queijo minas", 30, undefined, { brand: "Marca B" }),
      item("Presunto", 20, undefined, { brand: "Sadia" }),
    ]);
    mocks.listMeals.mockResolvedValueOnce([initial]).mockResolvedValueOnce([changed]);
    mocks.updateBatch.mockResolvedValue([changed]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].foodName).toBe("Queijo minas");
    expect(changes[0].after.items[0].estimatedGrams).toBe(30);
    expect(changes[0].after.items[1].foodName).toBe("Presunto");
    expect(changes[0].after.items[1].estimatedGrams).toBe(30);
  });

  it("falha fechado quando dois itens sem identificador possuem fingerprint indistinguível", async () => {
    const initial = meal([
      item("Presunto", 20),
      item("Presunto", 20),
    ]);
    mocks.listMeals.mockResolvedValue([initial]);

    await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{ targetFood: "presunto", quantity: 10, unit: "g" }],
    });

    const selected = mocks.createSelection.mock.calls[0][1].candidates[0];
    mocks.listMeals.mockReset();
    mocks.listMeals.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [{
        targetFood: "presunto",
        quantity: 10,
        unit: "g",
        target: selected,
        gramsDelta: 10,
        resolvedBy: "explicit_mass_or_volume",
      }],
    });

    expect(result.eventType).toBe("whatsapp.intent.meal_item_increment_plan_stale");
    expect(mocks.updateBatch).not.toHaveBeenCalled();
  });

  it("pré-valida todos os alvos antes de aplicar duas operações ao mesmo item", async () => {
    const initial = meal([item("Requeijão Catupiry Light", 45, 1)]);
    mocks.listMeals.mockResolvedValue([initial]);
    mocks.updateBatch.mockResolvedValue([initial]);

    const result = await continueMixedMealItemIncrementPlan(42, {
      ...basePlan,
      operations: [
        { targetFood: "requeijao", quantity: 10, unit: "g" },
        { targetFood: "requeijao", quantity: 5, unit: "g" },
      ],
    });

    expect(result.action).toBe("meal_item_grams_adjusted");
    const changes = mocks.updateBatch.mock.calls[0][1];
    expect(changes[0].after.items[0].estimatedGrams).toBe(60);
  });
});
