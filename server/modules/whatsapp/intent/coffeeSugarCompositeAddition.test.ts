import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMeals: vi.fn(),
  updateMeal: vi.fn(),
  findMealByLabel: vi.fn(),
  resolveCanonicalFoodAdditionItems: vi.fn(),
  requestClarification: vi.fn(async () => ({
    handled: true,
    action: "food_clarification_requested",
    reply: "Informe somente a quantidade de açúcar.",
    eventType: "whatsapp.food_clarification.requested",
    detail: "Pendência persistida.",
  })),
}));

vi.mock("../../../nutritionEngine", () => {
  class MealInferenceError extends Error {
    readonly code: string;

    constructor(message = "Não foi possível processar a refeição.", options: { code?: string } = {}) {
      super(message);
      this.name = "MealInferenceError";
      this.code = options.code ?? "meal_inference_unavailable";
    }
  }

  return { MealInferenceError };
});

vi.mock("../coffeeAdditionClarification", () => ({
  createWhatsappCoffeeAdditionClarification: vi.fn(),
}));

vi.mock("../foodQuantityClarification", () => ({
  requestWhatsappCaloricComplementQuantityClarification: mocks.requestClarification,
  requestWhatsappFoodAdditionQuantityClarification: vi.fn(),
}));

vi.mock("../replyMessages", () => ({
  buildWhatsAppClarificationReplyMessage: vi.fn((value: string) => value),
}));

vi.mock("../mealActionReplyComposer", () => ({
  composeWhatsAppMealActionReply: vi.fn(async () => "Resumo atualizado."),
}));

vi.mock("../../meals/service", () => ({
  listMeals: mocks.listMeals,
  updateMeal: mocks.updateMeal,
}));

vi.mock("./dateTime", () => ({
  formatReplyDate: vi.fn(() => "24/07/2026"),
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
  formatTotalsLine: vi.fn(),
}));

import { MealInferenceError } from "../../../nutritionEngine";
import { handleFoodAdditionIntent } from "./foodAdditionHandlers";

const occurredAt = new Date("2026-07-24T10:00:00.000Z");
const targetMeal = {
  id: 903,
  mealLabel: "Café da manhã",
  occurredAt,
  notes: null,
  items: [],
};

describe("adição composta com café adoçado", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listMeals.mockResolvedValue([targetMeal]);
    mocks.findMealByLabel.mockReturnValue(targetMeal);
    mocks.resolveCanonicalFoodAdditionItems.mockRejectedValue(new MealInferenceError(
      "Informe a quantidade do complemento.",
      { code: "food_component_quantity_required" },
    ));
  });

  it("persiste o lote completo antes de perguntar por complemento calórico não coberto pela regra simples", async () => {
    const result = await handleFoodAdditionIntent(
      7,
      {
        mealLabel: "Café da manhã",
        date: occurredAt,
        items: [
          { foodName: "Pão francês", quantity: 1, unit: "unidade" },
          { foodName: "Café com leite e açúcar", quantity: 1, unit: "xícara" },
        ],
      } as any,
      "America/Sao_Paulo",
      {
        originalText: "Adicionar pão e café com leite e açúcar ao café da manhã",
        receivedAt: occurredAt,
        messageId: "wamid-composite-addition",
      },
    );

    expect(result.action).toBe("food_clarification_requested");
    expect(mocks.requestClarification).toHaveBeenCalledWith(expect.objectContaining({
      userId: 7,
      originalFoodText: "1 unidade de Pão francês e 1 xícara de Café com leite e açúcar",
      originalText: "Adicionar pão e café com leite e açúcar ao café da manhã",
      operation: expect.objectContaining({
        kind: "add_to_meal",
        mealId: 903,
      }),
      messageId: "wamid-composite-addition",
    }));
    expect(mocks.updateMeal).not.toHaveBeenCalled();
  });
});
