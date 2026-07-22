import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const requestLatestFoodCorrectionQuantityMock = vi.fn();

vi.mock("./foodQuantityClarification", () => ({
  requestWhatsappLatestFoodCorrectionQuantity:
    requestLatestFoodCorrectionQuantityMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const { executeWhatsappContextualFoodReplacementIntent } = await import(
  "./contextualFoodReplacementIntent"
);

function item(
  input: Partial<MealDraftItem> & Pick<MealDraftItem, "foodName">
): MealDraftItem {
  return {
    foodName: input.foodName,
    canonicalName: input.foodName,
    portionText: "100 g",
    servings: 1,
    estimatedGrams: 100,
    calories: 200,
    protein: 10,
    carbs: 20,
    fat: 5,
    confidence: 0.9,
    source: "heuristic",
    ...input,
  };
}

describe("executeWhatsappContextualFoodReplacementIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    requestLatestFoodCorrectionQuantityMock.mockReset();
    requestLatestFoodCorrectionQuantityMock.mockResolvedValue({
      handled: true,
      action: "food_clarification_requested",
      reply: "Qual é o tamanho, peso ou volume de queijo parmesão polenghi?",
      eventType: "whatsapp.food_clarification.requested",
      detail:
        "Correção do último alimento aguardando quantidade em pendência persistente.",
      data: { pendingKind: "quantity" },
    });
    updateMealMock.mockImplementation(
      async (_userId: number, input: Record<string, unknown>) => ({
        id: input.mealId,
        ...input,
      })
    );
  });

  it("substitui alimento encontrado em refeição recente que não é a última e envia resumo", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 2,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-20T23:10:00.000Z").getTime(),
        items: [item({ foodName: "Arroz branco" })],
      },
      {
        id: 1,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-20T23:00:00.000Z").getTime(),
        notes: "Primeira imagem",
        items: [
          item({
            foodName: "Salsicha",
            portionText: "80 g",
            estimatedGrams: 80,
          }),
        ],
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é salsicha, é calabresa acebolada",
      receivedAt: new Date("2026-06-20T23:15:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealId: 1,
        mealLabel: "Lanche",
        items: [
          expect.objectContaining({
            foodName: "calabresa acebolada",
            canonicalName: "calabresa acebolada",
            estimatedGrams: 80,
            portionText: "80 g",
            source: "heuristic",
          }),
        ],
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: "meal_item_replaced",
        eventType: "whatsapp.intent.meal_item_replaced",
        data: expect.objectContaining({ mealId: 1 }),
      })
    );
    expect(result?.reply).toContain("Alimento substituído");
    expect(result?.reply).toContain("Salsicha → calabresa acebolada");
    expect(result?.reply).toContain("calabresa acebolada");
    expect(result?.reply).toContain("Total da refeição:");
    expect(result?.reply).toContain("120 kcal");
  });

  it("usa referência textual de primeira imagem para escolher a refeição correta", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 12,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-20T23:10:00.000Z").getTime(),
        items: [item({ foodName: "Salsicha" })],
      },
      {
        id: 11,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-20T23:00:00.000Z").getTime(),
        items: [item({ foodName: "Salsicha" })],
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é salsicha, é calabresa acebolada na primeira imagem",
      receivedAt: new Date("2026-06-20T23:15:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({ mealId: 11 })
    );
    expect(result?.action).toBe("meal_item_replaced");
  });

  it("pede confirmação quando o alimento aparece em mais de uma refeição recente", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 22,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-20T23:10:00.000Z").getTime(),
        items: [item({ foodName: "Salsicha" })],
      },
      {
        id: 21,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-20T23:00:00.000Z").getTime(),
        items: [item({ foodName: "Salsicha" })],
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é salsicha, é calabresa acebolada",
      receivedAt: new Date("2026-06-20T23:15:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.intent.meal_item_selection_requested",
        reply: expect.stringContaining("mais de um"),
      })
    );
    expect(result?.reply).toContain("Jantar");
    expect(result?.reply).toContain("Lanche");
    expect(result?.interactiveReply).toEqual(
      expect.objectContaining({ kind: "functional" })
    );
  });

  it("substitui o último alimento quando o usuário diz 'o último alimento é ...'", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 31,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Lanche",
        occurredAt: new Date("2026-07-22T15:00:00.000Z").getTime(),
        items: [
          item({
            foodName: "30G",
            canonicalName: "1 porção",
            portionText: "30 g",
            estimatedGrams: 30,
          }),
        ],
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "O último alimento é queijo parmesão polenghi",
      receivedAt: new Date("2026-07-22T15:05:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(requestLatestFoodCorrectionQuantityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 42,
        mealId: 31,
        itemIndex: 0,
        originalFoodName: "30G",
        replacementFoodName: "queijo parmesão polenghi",
      })
    );
    expect(result).toEqual(
      expect.objectContaining({
        action: "clarification_needed",
        eventType: "whatsapp.food_clarification.requested",
        data: expect.objectContaining({ pendingKind: "quantity" }),
      })
    );
    expect(result?.reply).toMatch(/peso|volume|tamanho/i);
  });

  it("substitui o último alimento e aplica quantidade na mesma mensagem", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 32,
        userId: 42,
        source: "whatsapp",
        mealLabel: "Lanche",
        occurredAt: new Date("2026-07-22T15:00:00.000Z").getTime(),
        items: [
          item({
            foodName: "Alimento",
            canonicalName: "Alimento",
            portionText: "100 g",
            estimatedGrams: 100,
          }),
        ],
      },
    ]);

    await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "O último alimento é 30g queijo parmesão polenghi, substituir",
      receivedAt: new Date("2026-07-22T15:05:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        mealId: 32,
        items: [
          expect.objectContaining({
            foodName: "queijo parmesão polenghi",
            quantity: 30,
            unit: "g",
            estimatedGrams: 30,
            portionText: "30 g",
          }),
        ],
      })
    );
  });

  it("ignora textos que não são substituição de alimento", async () => {
    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "listar alimentos do almoço de hoje",
      receivedAt: new Date("2026-06-20T23:15:00.000Z"),
    });

    expect(result).toBeNull();
    expect(listMealsMock).not.toHaveBeenCalled();
  });
});
