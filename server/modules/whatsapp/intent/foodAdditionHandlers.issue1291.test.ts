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
vi.mock("./mealItemHelpers", async () => ({
  ...(await vi.importActual<typeof import("./mealItemHelpers")>("./mealItemHelpers")),
  findMealByLabel: mocks.findMealByLabel,
  formatAddedItemsList: vi.fn(),
  formatTotalsLine: vi.fn(() => "100 kcal | P 5 g | C 10 g | G 2 g"),
}));
import { handleFoodAdditionIntent } from "./foodAdditionHandlers";
import { defaultMealSchedules } from "../../mealSchedules/service";

// 01/10/2026 21:45 em America/Sao_Paulo.
const receivedAt = new Date("2026-10-02T00:45:00.000Z");
const addition = {
  mealLabel: "lanche da tarde",
  date: receivedAt,
  items: [
    { foodName: "pêra packans", quantity: 1, unit: "unidade", brand: null },
    { foodName: "maçã fugi", quantity: 1, unit: "unidade", brand: null },
  ],
};
const resolvedPear = {
  foodName: "pêra packans",
  canonicalName: "Pêra",
  quantity: 1,
  unit: "unidade",
  portionText: "1 unidade (aprox. 178 g)",
  servings: 1,
  estimatedGrams: 178,
  calories: 96,
  protein: 0.6,
  carbs: 25,
  fat: 0.2,
  confidence: 0.7,
  source: "catalog",
};
const resolvedApple = {
  foodName: "maçã fugi",
  canonicalName: "Maçã",
  quantity: 1,
  unit: "unidade",
  portionText: "1 unidade (130 g)",
  servings: 1,
  estimatedGrams: 130,
  calories: 68,
  protein: 0.3,
  carbs: 18,
  fat: 0.2,
  confidence: 0.8,
  source: "catalog",
};

function enabledSchedule(mealLabel: string) {
  const schedule = defaultMealSchedules.find(item => item.mealLabel === mealLabel);
  return { ...(schedule ?? { mealLabel, startTime: "15:00", endTime: "17:29", enabled: true }), enabled: true };
}

describe("handleFoodAdditionIntent sem data explícita (#1291)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([]);
    mocks.listMealSchedules.mockResolvedValue([enabledSchedule("lanche da tarde")]);
    mocks.findMealByLabel.mockReturnValue(null);
    mocks.resolveDateSelection.mockReturnValue({ date: receivedAt, explicit: false });
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValue({
      kind: "items",
      items: [resolvedPear, resolvedApple],
    });
    mocks.createManualMeal.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 1291,
      ...input,
    }));
  });

  it("cria a refeição configurada no dia do recebimento em vez de escrever em outro dia", async () => {
    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar 1 pêra packans e 1 maçã fugi ao lanche da tarde",
      receivedAt,
    });

    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(mocks.createManualMeal).toHaveBeenCalledWith(42, expect.objectContaining({
      mealLabel: "lanche da tarde",
      // 01/10/2026 15:00 em America/Sao_Paulo, o horário configurado.
      occurredAt: "2026-10-01T18:00:00.000Z",
      items: [resolvedPear, resolvedApple],
    }));
    expect(result.action).toBe("meal_item_added");
  });

  it("mantém a clarificação quando o rótulo não é uma refeição configurada", async () => {
    mocks.listMealSchedules.mockResolvedValue([]);

    const result = await handleFoodAdditionIntent(42, addition as never, "America/Sao_Paulo", {
      originalText: "Adicionar 1 pêra packans e 1 maçã fugi ao lanche da tarde",
      receivedAt,
    });

    expect(mocks.createManualMeal).not.toHaveBeenCalled();
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
  });
});