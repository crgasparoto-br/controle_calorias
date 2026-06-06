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

function drinkItem(foodName: string, portionText = "330 ml") {
  return {
    foodName,
    canonicalName: foodName,
    portionText,
    servings: 1,
    estimatedGrams: 330,
    calories: 150,
    protein: 1,
    carbs: 12,
    fat: 0,
    confidence: 0.8,
    source: "heuristic" as const,
  };
}

describe("executeWhatsappTextIntent short quantity correction", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
  });

  it("corrige item unico de 330ml para 600ml", async () => {
    const beerItem = drinkItem("Cerveja Budweiser");
    listMealsMock.mockResolvedValue([
      {
        id: 21,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        notes: "Jantar pelo WhatsApp",
        items: [beerItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Trocar 330ml por 600ml",
      receivedAt: new Date("2026-06-04T15:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 21,
      items: [expect.objectContaining({
        foodName: "Cerveja Budweiser",
        portionText: "600 ml",
        estimatedGrams: 600,
      })],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: "Atualizei de 330ml para 600ml.",
    }));
  });

  it("corrige ultimo item compativel com frase nao e", async () => {
    const beerItem = drinkItem("Cerveja Budweiser");
    listMealsMock.mockResolvedValue([
      {
        id: 22,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        items: [beerItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: input.mealId,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Não é 330ml é 600ml",
      receivedAt: new Date("2026-06-04T15:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 22,
      items: [expect.objectContaining({
        foodName: "Cerveja Budweiser",
        portionText: "600 ml",
        estimatedGrams: 600,
      })],
    }));
    expect(result?.reply).toBe("Atualizei de 330ml para 600ml.");
  });

  it("pede confirmacao quando dois itens possuem 330ml", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 23,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        items: [
          drinkItem("Cerveja Budweiser"),
          drinkItem("Coca-Cola"),
        ],
      },
    ]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Trocar 330ml por 600ml",
      receivedAt: new Date("2026-06-04T15:00:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: "Encontrei mais de um item com 330ml. Qual deseja alterar? 1. Cerveja Budweiser 2. Coca-Cola",
    }));
  });

  it("pede esclarecimento quando nao encontra item recente com 330ml", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 24,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        items: [{
          ...drinkItem("Cerveja Budweiser", "250 ml"),
          estimatedGrams: 250,
        }],
      },
    ]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Trocar 330ml por 600ml",
      receivedAt: new Date("2026-06-04T15:00:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: "Não encontrei um item recente com 330ml. Qual item devo corrigir?",
    }));
  });
});
