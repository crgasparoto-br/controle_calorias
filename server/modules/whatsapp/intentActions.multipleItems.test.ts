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
  portionText: "150 g",
  servings: 1,
  estimatedGrams: 150,
  calories: 195,
  protein: 4.1,
  carbs: 42,
  fat: 0.5,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("executeWhatsappTextIntent multiple food additions", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
  });

  it("adiciona dois itens distintos com marcas ao jantar de ontem", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 16,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        notes: "Jantar de ontem",
        items: [riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar ao jantar de ontem 300g amendoim japonês Elma Chips, 330ml de cerveja Budweiser",
      receivedAt: new Date("2026-06-04T15:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 16,
      mealLabel: "Jantar",
      items: [
        riceItem,
        expect.objectContaining({
          foodName: "amendoim japonês Elma Chips",
          canonicalName: "amendoim japonês Elma Chips",
          portionText: "300 g",
          estimatedGrams: 300,
          calories: 450,
          protein: 18,
          carbs: 45,
          fat: 15,
          source: "heuristic",
        }),
        expect.objectContaining({
          foodName: "cerveja Budweiser",
          canonicalName: "cerveja Budweiser",
          portionText: "330 ml",
          estimatedGrams: 330,
          calories: 495,
          protein: 19.8,
          carbs: 49.5,
          fat: 16.5,
          source: "heuristic",
        }),
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
      reply: expect.stringContaining("300 g de amendoim japonês Elma Chips"),
    }));
    expect(result?.reply).toContain("330 ml de cerveja Budweiser");
  });
});
