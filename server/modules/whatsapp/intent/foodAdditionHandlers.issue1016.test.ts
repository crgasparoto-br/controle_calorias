import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  findMealByLabel: vi.fn(),
  resolveCanonicalFoodAdditionItems: vi.fn(),
  requestFoodQuantity: vi.fn(async () => ({
    handled: true,
    action: "food_clarification_requested",
    reply: "Informe o peso ou volume.",
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pendência persistida.",
  })),
  composeReply: vi.fn(async (input: any) => input.options.actionLines.join("\n")),
}));

vi.mock("../../../../shared/timeZone", () => ({ DEFAULT_APP_TIME_ZONE: "America/Sao_Paulo" }));
vi.mock("../../../nutritionEngine", () => ({
  MealInferenceError: class MealInferenceError extends Error {
    readonly code = "meal_inference_unavailable";
  },
}));
vi.mock("../coffeeAdditionClarification", () => ({ createWhatsappCoffeeAdditionClarification: vi.fn() }));
vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: vi.fn(),
  requestWhatsappFoodAdditionQuantityClarification: mocks.requestFoodQuantity,
}));
vi.mock("../replyMessages", () => ({ buildWhatsAppClarificationReplyMessage: vi.fn((value: string) => value) }));
vi.mock("../mealActionReplyComposer", () => ({ composeWhatsAppMealActionReply: mocks.composeReply }));
vi.mock("../../meals/service", () => ({ listMeals: mocks.listMeals, updateMeal: mocks.updateMeal }));
vi.mock("./dateTime", () => ({
  formatReplyDate: vi.fn(() => "25/08/2026"),
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
  formatAddedItemsList: vi.fn((items: any[]) => items.map(item => item.foodName).join(" e ")),
  formatTotalsLine: vi.fn((item: any) => `${item.calories} kcal | P ${item.protein} g | C ${item.carbs} g | G ${item.fat} g`),
}));

import { handleFoodAdditionIntent } from "./foodAdditionHandlers";

const occurredAt = new Date("2026-08-25T12:00:00.000Z");
const targetMeal = {
  id: 1016,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [],
};

function item(foodName: string, overrides: Record<string, unknown> = {}) {
  return {
    foodName,
    canonicalName: foodName,
    quantity: 1,
    unit: "fatia",
    portionText: "1 fatia (20 g)",
    servings: 1,
    estimatedGrams: 20,
    calories: 50,
    protein: 3,
    carbs: 1,
    fat: 4,
    confidence: 0.9,
    source: "catalog",
    ...overrides,
  };
}

describe("handleFoodAdditionIntent canonical flow (#1016)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.findMealByLabel.mockReturnValue(targetMeal);
    mocks.updateMeal.mockImplementation(async (_userId: number, input: any) => ({ ...targetMeal, ...input }));
  });

  it("não persiste nenhum item quando uma medida permanece irresolvida", async () => {
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValueOnce({
      kind: "quantity_clarification",
      itemIndex: 1,
      item: { foodName: "Requeijão cremoso", quantity: 1, unit: "fatia", brand: null },
      resolvedItems: [item("Presunto cozido")],
    });

    const addition = {
      mealLabel: "Café da manhã",
      date: occurredAt,
      items: [
        { foodName: "Presunto cozido", quantity: 1, unit: "fatia", brand: null },
        { foodName: "Requeijão cremoso", quantity: 1, unit: "fatia", brand: null },
      ],
    };
    const result = await handleFoodAdditionIntent(7, addition, "America/Sao_Paulo", {
      originalText: "adicionar uma fatia de presunto e uma fatia de requeijão",
      receivedAt: occurredAt,
      messageId: "wamid-1016",
    });

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.updateMeal).not.toHaveBeenCalled();
    expect(mocks.requestFoodQuantity).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      itemIndex: 1,
      addition,
      expectedMealId: 1016,
      messageId: "wamid-1016",
    }));
  });

  it("grava o lote inteiro em uma única atualização depois que todos os itens estão resolvidos", async () => {
    const ham = item("Presunto cozido", { estimatedGrams: 18 });
    const cheese = item("Queijo mussarela", { estimatedGrams: 22, calories: 70 });
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValueOnce({ kind: "items", items: [ham, cheese] });

    const result = await handleFoodAdditionIntent(7, {
      mealLabel: "Café da manhã",
      date: occurredAt,
      items: [
        { foodName: "Presunto cozido", quantity: 1, unit: "fatia", brand: null },
        { foodName: "Queijo mussarela", quantity: 1, unit: "fatia", brand: null },
      ],
    }, "America/Sao_Paulo");

    expect(result.action).toBe("meal_item_added");
    expect(mocks.updateMeal).toHaveBeenCalledTimes(1);
    expect(mocks.updateMeal).toHaveBeenCalledWith(7, expect.objectContaining({
      mealId: 1016,
      items: [ham, cheese],
    }));
  });

  it("expõe quando a gramatura veio de média usual e permite correção posterior", async () => {
    mocks.resolveCanonicalFoodAdditionItems.mockResolvedValueOnce({
      kind: "items",
      items: [item("Queijo mussarela", {
        estimatedGrams: 21,
        portionText: "1 fatia (aprox. 21 g)",
        quantityResolution: {
          kind: "usual_average",
          grams: 21,
          evidence: "média de referências coerentes",
          sourceUrls: ["https://example.com/a", "https://example.org/b"],
          referenceCount: 2,
        },
      })],
    });

    const result = await handleFoodAdditionIntent(7, {
      mealLabel: "Café da manhã",
      date: occurredAt,
      items: [{ foodName: "Queijo mussarela", quantity: 1, unit: "fatia", brand: null }],
    }, "America/Sao_Paulo");

    expect(result.reply).toMatch(/média usual/i);
    expect(result.reply).toMatch(/pode corrigir depois/i);
    expect(result.data?.quantityResolution).toEqual(expect.objectContaining({
      kind: "usual_average",
      grams: 21,
    }));
  });

  it("mantém o handler sem provedor, busca web ou fallback nutricional paralelo", () => {
    const source = readFileSync(new URL("./foodAdditionHandlers.ts", import.meta.url), "utf8");
    expect(source).not.toContain("buildFoodAdditionItem");
    expect(source).not.toContain("brandedNutritionSearch");
    expect(source).not.toContain("_core/ai");
    expect(source).not.toMatch(/150\s*,\s*protein:\s*6\s*,\s*carbs:\s*15\s*,\s*fat:\s*5/s);
    expect(source).toContain("resolveCanonicalFoodAdditionItems");
  });
});
