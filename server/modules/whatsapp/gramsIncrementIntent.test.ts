import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

import { executeWhatsappGramsIncrementIntent } from "./gramsIncrementIntent";

function item(foodName: string, estimatedGrams: number) {
  return {
    foodName,
    canonicalName: foodName,
    portionText: `${estimatedGrams} g`,
    quantity: estimatedGrams,
    unit: "g",
    servings: 1,
    estimatedGrams,
    calories: estimatedGrams,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: 0.9,
    source: "catalog",
  };
}

describe("executeWhatsappGramsIncrementIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
  });

  it("soma gramas ao alimento citado com artigo antes do nome", async () => {
    const meal = {
      id: 36,
      mealLabel: "Jantar",
      occurredAt: "2026-06-29T23:00:00.000Z",
      notes: null,
      items: [
        item("Arroz branco", 80),
        item("Mandioca cozida", 100),
        item("Feijao carioca", 90),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsIncrementIntent(42, {
      text: "Adicionar 37g a mandioca",
      receivedAt: new Date("2026-06-29T23:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        increments: [
          expect.objectContaining({ foodName: "Mandioca cozida", previousGrams: 100, nextGrams: 137 }),
        ],
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 36,
      items: [
        expect.objectContaining({ foodName: "Arroz branco", estimatedGrams: 80 }),
        expect.objectContaining({ foodName: "Mandioca cozida", estimatedGrams: 137, portionText: "137 g" }),
        expect.objectContaining({ foodName: "Feijao carioca", estimatedGrams: 90 }),
      ],
    }));
  });
});
