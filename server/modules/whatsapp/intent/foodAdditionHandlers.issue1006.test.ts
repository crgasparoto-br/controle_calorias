import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  findMealByLabel: vi.fn(),
  resolveCanonicalFoodAdditionItems: vi.fn(),
  resolveDateSelection: vi.fn(),
  composeReply: vi.fn(async () => "ok"),
}));

vi.mock("../../../../shared/timeZone", () => ({ DEFAULT_APP_TIME_ZONE: "America/Sao_Paulo" }));
vi.mock("../../../nutritionEngine", () => ({
  MealInferenceError: class MealInferenceError extends Error {},
}));
vi.mock("../coffeeAdditionClarification", () => ({ createWhatsappCoffeeAdditionClarification: vi.fn() }));
vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: vi.fn(),
  requestWhatsappFoodAdditionQuantityClarification: vi.fn(),
}));
vi.mock("../replyMessages", () => ({ buildWhatsAppClarificationReplyMessage: vi.fn((value: string) => value) }));
vi.mock("../mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: mocks.composeReply }));
vi.mock("../../meals/service", () => ({ listMeals: mocks.listMeals, updateMeal: mocks.updateMeal }));
vi.mock("./dateTime", () => ({
  formatReplyDate: vi.fn(() => "24/08/2026"),
  resolveRelativeOccurredAt: vi.fn((_text: string, receivedAt: Date) => receivedAt),
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

const requestedDate = new Date("2026-08-24T15:00:00.000Z");
const olderMeal = {
  id: 22,
  mealLabel: "Café da manhã",
  occurredAt: "2026-08-22T11:00:00.000Z",
  notes: null,
  items: [],
};

const addition = {
  mealLabel: "Café da manhã",
  date: requestedDate,
  items: [{ foodName: "Pão", quantity: 1, unit: "unidade", brand: null }],
};

const resolvedBread = {
  foodName: "Pão",
  canonicalName: "Pão",
  quantity: 1,
  unit: "unidade",
  portionText: "1 unidade (50 g)",
  servings: 1,
  estimatedGrams: 50,
  calories: 100,
  protein: 5,
  carbs: 10,
  fat: 2,
  confidence: 0.8,
  source: "catalog",
};

describe("handleFoodAdditionIntent explicit date selection (#1006)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([olderMeal]);
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValue({ kind: "items", items: [resolvedBread] });
    mocks.updateMeal.mockImplementation(async (_userId, input) => ({ ...olderMeal, ...input }));
    mocks.findMealByLabel.mockImplementation((_meals, _label, _date, _tz, options) =>
      options?.allowCrossDayFallback === false ? null : olderMeal,
    );
  });

  it("não atualiza a refeição de 22/08 quando o comando diz hoje em 24/08", async () => {
    mocks.resolveDateSelection.mockReturnValue({ date: requestedDate, explicit: true });

    const result = await handleFoodAdditionIntent(7, addition as any, "America/Sao_Paulo", {
      originalText: "adiciona ao café da manhã de hoje, 1 unidade de pão",
      receivedAt: requestedDate,
    });

    expect(mocks.findMealByLabel).toHaveBeenCalledWith(
      [olderMeal],
      "Café da manhã",
      requestedDate,
      "America/Sao_Paulo",
      { allowCrossDayFallback: false },
    );
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(result.action).toBe("clarification_needed");
  });

  it("preserva o fallback contextual quando o usuário não informou data", async () => {
    mocks.resolveDateSelection.mockReturnValue({ date: requestedDate, explicit: false });

    const result = await handleFoodAdditionIntent(7, addition as any, "America/Sao_Paulo", {
      originalText: "adiciona 1 unidade de pão ao café da manhã",
      receivedAt: requestedDate,
    });

    expect(mocks.findMealByLabel).toHaveBeenCalledWith(
      [olderMeal],
      "Café da manhã",
      requestedDate,
      "America/Sao_Paulo",
      { allowCrossDayFallback: true },
    );
    expect(mocks.updateMeal).toHaveBeenCalledWith(7, expect.objectContaining({ mealId: 22 }));
    expect(result.action).toBe("meal_item_added");
  });
});
