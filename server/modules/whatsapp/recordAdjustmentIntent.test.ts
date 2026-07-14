import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const handleQuantityCorrectionIntentMock = vi.hoisted(() => vi.fn());
const handleFoodReplacementIntentsMock = vi.hoisted(() => vi.fn());
const executeWhatsappDeleteIntentMock = vi.hoisted(() => vi.fn());
const createPendingMealItemSelectionMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({ listMeals: listMealsMock }));
vi.mock("./intent/gramsAdjustmentHandlers", () => ({ handleQuantityCorrectionIntent: handleQuantityCorrectionIntentMock }));
vi.mock("./intent/foodReplacementHandlers", () => ({ handleFoodReplacementIntents: handleFoodReplacementIntentsMock }));
vi.mock("./deleteIntent", () => ({ executeWhatsappDeleteIntent: executeWhatsappDeleteIntentMock }));
vi.mock("./mealItemSelectionCallback", () => ({ createPendingMealItemSelection: createPendingMealItemSelectionMock }));

import { contextUsage, executeWhatsappRecordAdjustmentIntent } from "./recordAdjustmentIntent";

function item(foodName: string) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    calories: 130,
    protein: 2.7,
    carbs: 28,
    fat: 0.3,
    confidence: 0.9,
    source: "catalog",
  };
}

function meal(items = [item("Arroz branco")]) {
  return { id: 10, mealLabel: "Almoço", occurredAt: "2026-06-14T14:00:00.000Z", notes: null, items };
}

describe("executeWhatsappRecordAdjustmentIntent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleQuantityCorrectionIntentMock.mockResolvedValue({ handled: true, action: "meal_item_grams_adjusted", reply: "refeição completa", eventType: "whatsapp.intent.meal_item_grams_adjusted", detail: "ok" });
    handleFoodReplacementIntentsMock.mockResolvedValue({ handled: true, action: "meal_item_replaced", reply: "refeição completa", eventType: "whatsapp.intent.meal_item_replaced", detail: "ok" });
    executeWhatsappDeleteIntentMock.mockResolvedValue({ handled: true, action: "clarification_needed", reply: "Confirmar ou Cancelar", eventType: "whatsapp.intent.delete_confirmation_needed", detail: "ok", data: {}, interactiveReply: { kind: "functional" } });
    createPendingMealItemSelectionMock.mockResolvedValue({ handled: true, action: "clarification_needed", reply: "selecione", eventType: "whatsapp.intent.meal_item_selection_requested", detail: "ok", data: {}, interactiveReply: { kind: "functional" } });
  });

  it("aplica quantidade clara diretamente pelo handler canônico", async () => {
    listMealsMock.mockResolvedValue([meal()]);
    const result = await executeWhatsappRecordAdjustmentIntent(42, { text: "era 150g", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    expect(handleQuantityCorrectionIntentMock).toHaveBeenCalledWith(42, {
      previousQuantity: null,
      previousUnit: null,
      nextQuantity: 150,
      nextUnit: "g",
    });
    expect(result?.action).toBe("meal_item_grams_adjusted");
  });

  it("aplica substituição clara diretamente pelo handler canônico", async () => {
    const result = await executeWhatsappRecordAdjustmentIntent(42, { text: "troca arroz branco por arroz integral" });

    expect(handleFoodReplacementIntentsMock).toHaveBeenCalledWith(42, [{ fromFood: "arroz branco", toFood: "arroz integral" }]);
    expect(result?.action).toBe("meal_item_replaced");
  });

  it("usa seleção interativa quando quantidade sem alvo encontra vários itens", async () => {
    listMealsMock.mockResolvedValue([meal([item("Arroz branco"), item("Feijão carioca")])]);
    const result = await executeWhatsappRecordAdjustmentIntent(42, { text: "era 150g", receivedAt: new Date("2026-06-14T15:00:00.000Z") });

    expect(createPendingMealItemSelectionMock).toHaveBeenCalledWith(42, expect.objectContaining({
      action: { kind: "quantity_absolute", quantity: 150, unit: "g" },
      candidates: [
        expect.objectContaining({ mealId: 10, itemIndex: 0, itemName: "Arroz branco" }),
        expect.objectContaining({ mealId: 10, itemIndex: 1, itemName: "Feijão carioca" }),
      ],
    }));
    expect(result?.interactiveReply).toBeDefined();
  });

  it("delega exclusão ao fluxo com confirmação interativa", async () => {
    const result = await executeWhatsappRecordAdjustmentIntent(42, { text: "remove frango" });

    expect(executeWhatsappDeleteIntentMock).toHaveBeenCalledWith(42, { text: "remove frango" });
    expect(result?.reply).toContain("Confirmar");
    expect(result?.interactiveReply).toBeDefined();
  });

  it("declara corretamente uso de janela recente e pendência", () => {
    expect(contextUsage).toEqual(expect.objectContaining({ usesRecentWindow: true, usesPendingOperation: true, requiresFreshDbQuery: true }));
  });
});
