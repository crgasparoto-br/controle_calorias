import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createWaterLogMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();

vi.mock("../../db", () => ({
  getUserNutritionGoal: getUserNutritionGoalMock,
}));

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

vi.mock("../water/service", () => ({
  createWaterLog: createWaterLogMock,
}));

const { executeWhatsappTextIntent } = await import("./intentActions");

const riceItem = {
  foodName: "Arroz branco",
  canonicalName: "Arroz branco cozido",
  portionText: "100 g",
  servings: 1,
  estimatedGrams: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("executeWhatsappTextIntent com quantidade liquida", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
  });

  it("registra alimento com conta de gramas sem cair no fallback nutricional", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 44,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-04T18:00:00.000Z").getTime(),
        notes: "Lanche de hoje",
        items: [riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 160g - 23g de maça fugi ao lanche",
      receivedAt: new Date("2026-06-04T18:30:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 44,
      mealLabel: "Lanche",
      items: [
        riceItem,
        expect.objectContaining({
          foodName: "maça fugi",
          quantity: 137,
          unit: "g",
          portionText: "137 g",
          estimatedGrams: 137,
        }),
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
      reply: expect.stringContaining("137 g de maça fugi"),
    }));
  });

  it("pede esclarecimento quando a conta resulta em zero ou negativo", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 45,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-04T18:00:00.000Z").getTime(),
        items: [riceItem],
      },
    ]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 160g - 200g de maçã ao lanche",
      receivedAt: new Date("2026-06-04T18:30:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });
});
