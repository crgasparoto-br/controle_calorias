import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  createManualMeal: vi.fn(),
  listMealSchedules: vi.fn(),
  findMealByLabel: vi.fn(),
  resolveCanonicalFoodAdditionItems: vi.fn(),
  resolveDateSelection: vi.fn(),
  composeReply: vi.fn(async () => "resposta canônica"),
}));
vi.mock("../../../nutritionEngine", () => ({
  resolveCommercialFoodIdentity: vi.fn(),
  MealInferenceError: class MealInferenceError extends Error {},
}));
vi.mock("../coffeeAdditionClarification", () => ({ createWhatsappCoffeeAdditionClarification: vi.fn() }));
vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: vi.fn(),
  requestWhatsappFoodAdditionQuantityClarification: mocks.composeReply,
}));
vi.mock("../replyMessages", () => ({ buildWhatsAppClarificationReplyMessage: vi.fn((value: string) => value) }));
vi.mock("../mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: mocks.composeReply }));
vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
  createManualMeal: mocks.createManualMeal,
}));
vi.mock("../../mealSchedules/service", async () => ({
  ...(await vi.importActual<typeof import("../../mealSchedules/service")>("../../mealSchedules/service")),
  listMealSchedules: mocks.listMealSchedules,
}));
vi.mock("./explicitMealDate", () => ({
  resolveWhatsappRelativeMealDateSelection: mocks.resolveDateSelection,
}));
vi.mock("./canonicalFoodAdditionResolution", () => ({
  resolveCanonicalFoodAdditionItems: mocks.resolveCanonicalFoodAdditionItems,
}));
vi.mock("./mealItemHelpers", () => ({
  buildCoffeeLorCapsuleItem: vi.fn(),
  buildUnsweetenedCoffeeItem: vi.fn(),
  findMealByLabel: mocks.findMealByLabel,
  formatAddedItemsList: vi.fn(),
  formatTotalsLine: vi.fn(() => "100 kcal | P 5 g | C 10 g | G 2 g"),
}));
import { handleFoodAdditionIntent } from "./foodAdditionHandlers";
import { defaultMealSchedules } from "../../mealSchedules/service";

const receivedAt = new Date("2026-10-01T11:55:00.000Z");
const requestedDate = new Date("2026-09-30T11:55:00.000Z");
const addition = {
  mealLabel: "lanche da tarde",
  date: requestedDate,
  items: [
    { foodName: "pêra packans", quantity: 1, unit: "unidade", brand: null },
    { foodName: "banana nanica", quantity: 1, unit: "unidade", brand: null },
  ],
};
const resolvedPear = {
  foodName: "pêra packans",
  canonicalName: "Pêra",
  quantity: 1,
  unit: "unidade",
  portionText: "1 unidade (150 g)",
  servings: 1,
  estimatedGrams: 150,
  calories: 90,
  protein: 0.6,
  carbs: 23,
  fat: 0.2,
  confidence: 0.8,
  source: "catalog",
};
const resolvedBanana = {
  foodName: "banana nanica",
  canonicalName: "Banana",
  quantity: 1,
  unit: "unidade",
  portionText: "1 unidade (80 g)",
  servings: 1,
  estimatedGrams: 80,
  calories: 70,
  protein: 0.9,
  carbs: 18,
  fat: 0.2,
  confidence: 0.8,
  source: "catalog",
};

function enabledSchedule(mealLabel: string) {
  const schedule = defaultMealSchedules.find(item => item.mealLabel === mealLabel);
  return { ...(schedule ?? { mealLabel, startTime: "15:00", endTime: "17:29", enabled: true }), enabled: true };
}

describe("handleFoodAdditionIntent com refeição habitual configurada (#1271)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([]);
    mocks.listMealSchedules.mockResolvedValue([enabledSchedule("lanche da tarde")]);
    mocks.findMealByLabel.mockReturnValue(null);
    mocks.resolveDateSelection.mockReturnValue({ date: requestedDate, explicit: true });
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValue({
      kind: "items",
      items: [resolvedPear, resolvedBanana],
    });
    mocks.createManualMeal.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 1271,
      ...input,
    }));
  });

  it("cria a refeição configurada no dia pedido quando não há registro do rótulo", async () => {
    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar ao lanche da tarde de ontem, 1 pêra packans e 1 banana nanica",
      receivedAt,
    });

    expect(mocks.createManualMeal).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "lanche da tarde",
      occurredAt: "2026-09-30T18:00:00.000Z",
      items: [resolvedPear, resolvedBanana],
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
    }));
    expect(result.data).toEqual(expect.objectContaining({
      mealId: 1271,
      mealLabel: "lanche da tarde",
      occurredAt: "2026-09-30T18:00:00.000Z",
      createdFromConfiguredSchedule: true,
    }));
  });

  it("mantém o bloqueio seguro quando o rótulo não é refeição configurada", async () => {
    mocks.listMealSchedules.mockResolvedValue([enabledSchedule("jantar")]);

    const result = await handleFoodAdditionIntent(
      42,
      { ...addition, mealLabel: "colação" } as never,
      "America/Sao_Paulo",
      { originalText: "Adicionar à colação de ontem, 1 banana nanica", receivedAt },
    );

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
    expect(result.reply).toContain("Não encontrei a refeição");
  });

  it("não cria refeição configurada desativada", async () => {
    mocks.listMealSchedules.mockResolvedValue([{ ...enabledSchedule("lanche da tarde"), enabled: false }]);

    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar ao lanche da tarde de ontem, 1 pêra packans",
      receivedAt,
    });

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
  });

  it("não cria refeição vazia quando os alimentos exigem esclarecimento", async () => {
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValue({
      kind: "identity_clarification",
      itemIndex: 0,
      item: addition.items[0],
      resolvedItems: [],
      message: "Qual pêra?",
      context: {},
    });

    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar ao lanche da tarde de ontem, 1 pêra packans",
      receivedAt,
    });

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
  });

  it("não cria refeição nova quando a continuação esperava um alvo específico", async () => {
    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar ao lanche da tarde de ontem, 1 pêra packans",
      receivedAt,
      expectedMealId: 999,
      expectedMealLabel: "Lanche da tarde",
      expectedOccurredAt: "2026-09-30T18:00:00.000Z",
    });

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
  });

  it("atualiza o registro existente do dia em vez de criar uma segunda refeição", async () => {
    const existingMeal = {
      id: 55,
      mealLabel: "Lanche da tarde",
      occurredAt: "2026-09-30T18:00:00.000Z",
      items: [],
    };
    mocks.findMealByLabel.mockReturnValue(existingMeal);
    mocks.updateMeal.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 55,
      ...input,
    }));

    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar ao lanche da tarde de ontem, 1 pêra packans e 1 banana nanica",
      receivedAt,
    });

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(mocks.updateMeal).toHaveBeenCalledWith(42, expect.objectContaining({ mealId: 55 }));
    expect(result.action).toBe("meal_item_added");
  });
});