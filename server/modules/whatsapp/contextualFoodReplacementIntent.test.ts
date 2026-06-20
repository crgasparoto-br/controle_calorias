import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MealDraftItem } from "../../nutritionEngine";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const { executeWhatsappContextualFoodReplacementIntent } = await import("./contextualFoodReplacementIntent");

function item(input: Partial<MealDraftItem> & Pick<MealDraftItem, "foodName">): MealDraftItem {
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
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));
  });

  it("substitui alimento encontrado em refeição recente que não é a última", async () => {
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
        items: [item({ foodName: "Salsicha", portionText: "80 g", estimatedGrams: 80 })],
      },
    ]);

    const result = await executeWhatsappContextualFoodReplacementIntent(42, {
      text: "não é salsicha, é calabresa acebolada",
      receivedAt: new Date("2026-06-20T23:15:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
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
    }));
    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_replaced",
      eventType: "whatsapp.intent.meal_item_replaced",
      data: expect.objectContaining({ mealId: 1 }),
    }));
    expect(result?.reply).toContain("Troquei Salsicha por calabresa acebolada");
    expect(result?.reply).toContain("Lanche");
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
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({ mealId: 11 }));
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
    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      eventType: "whatsapp.intent.clarification_needed",
      reply: expect.stringContaining("mais de uma refeição recente"),
    }));
    expect(result?.reply).toContain("Jantar");
    expect(result?.reply).toContain("Lanche");
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