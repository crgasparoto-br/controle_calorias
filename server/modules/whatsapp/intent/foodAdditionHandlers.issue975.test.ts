import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  findMealByLabel: vi.fn(),
  resolveCanonicalFoodAdditionItems: vi.fn(),
  composeWhatsAppMealActionReply: vi.fn(async (input: any) => input.options.actionLines.join("\n")),
}));

vi.mock("../../../../shared/timeZone", () => ({
  DEFAULT_APP_TIME_ZONE: "America/Sao_Paulo",
}));

vi.mock("../../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    readonly code = "meal_inference_unavailable";
  }
  return { MealInferenceError };
});

vi.mock("../coffeeAdditionClarification", () => ({
  createWhatsappCoffeeAdditionClarification: vi.fn(),
}));

vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: vi.fn(),
  requestWhatsappFoodAdditionQuantityClarification: vi.fn(),
}));

vi.mock("../replyMessages", () => ({
  buildWhatsAppClarificationReplyMessage: vi.fn((value: string) => value),
}));

vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: mocks.composeWhatsAppMealActionReply,
}));

vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
}));

vi.mock("./dateTime", () => ({
  formatReplyDate: vi.fn(() => "13/08/2026"),
  resolveRelativeOccurredAt: vi.fn((_text: string, receivedAt: Date) => receivedAt),
}));

vi.mock("./explicitMealDate", () => ({
  resolveWhatsappRelativeMealDateSelection: vi.fn((input: any) => ({ date: input.fallbackDate, explicit: false })),
}));

vi.mock("./canonicalFoodAdditionResolution", () => ({
  resolveCanonicalFoodAdditionItems: mocks.resolveCanonicalFoodAdditionItems,
}));

vi.mock("./mealItemHelpers", () => ({
  buildCoffeeLorCapsuleItem: vi.fn(),
  buildUnsweetenedCoffeeItem: vi.fn(),
  findMealByLabel: mocks.findMealByLabel,
  formatAddedItemsList: vi.fn(),
  formatTotalsLine: vi.fn((item: any) => `${item.calories} kcal | P ${item.protein} g | C ${item.carbs} g | G ${item.fat} g`),
}));

import { handleFoodAdditionIntent } from "./foodAdditionHandlers";

const occurredAt = new Date("2026-08-13T15:00:00.000Z");
const targetMeal = {
  id: 975,
  mealLabel: "Almoço",
  occurredAt,
  notes: null,
  items: [],
};

function buildResolvedItem(foodName: string, quantity: number, unit: string) {
  return {
    foodName,
    canonicalName: foodName,
    quantity,
    unit,
    portionText: `${quantity} ${unit}`,
    servings: 1,
    estimatedGrams: quantity,
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 2,
    confidence: 0.8,
    source: foodName === "Arroz catalogado" ? "catalog" : "heuristic",
  };
}

async function executeAddition(foodName: string) {
  mocks.resolveCanonicalFoodAdditionItems.mockResolvedValueOnce({
    kind: "items",
    items: [buildResolvedItem(foodName, 100, "g")],
  });
  return handleFoodAdditionIntent(
    7,
    {
      mealLabel: "Almoço",
      date: occurredAt,
      items: [{ foodName, quantity: 100, unit: "g" }],
    } as any,
    "America/Sao_Paulo",
  );
}

describe("handleFoodAdditionIntent — origem nutricional do item único (#975)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.findMealByLabel.mockReturnValue(targetMeal);
    mocks.updateMeal.mockImplementation(async (_userId: number, input: any) => ({
      ...targetMeal,
      ...input,
    }));
  });

  it("preserva 'Estimativa com base no catálogo' para source catalog", async () => {
    const result = await executeAddition("Arroz catalogado");
    const expectedActionLine = "Adicionei 100 g de Arroz catalogado à refeição Almoço de 13/08/2026. Estimativa com base no catálogo: 100 kcal | P 5 g | C 10 g | G 2 g.";
    expect(result.reply).toBe(expectedActionLine);
  });

  it("usa somente 'Estimativa:' para source não catálogo e elimina a duplicação", async () => {
    const result = await executeAddition("Alimento estimado");
    const expectedActionLine = "Adicionei 100 g de Alimento estimado à refeição Almoço de 13/08/2026. Estimativa: 100 kcal | P 5 g | C 10 g | G 2 g.";
    expect(result.reply).toBe(expectedActionLine);
    expect(result.reply).not.toContain("Estimativa por estimativa:");
  });
});
