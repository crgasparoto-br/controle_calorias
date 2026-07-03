import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

import { executeWhatsappGramsAdjustmentIntent } from "./gramsAdjustmentIntent";

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

describe("executeWhatsappGramsAdjustmentIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
  });

  it("reduz gramas dos alimentos citados mesmo sem preposicao depois da quantidade", async () => {
    const meal = {
      id: 10,
      mealLabel: "Lanche",
      occurredAt: "2026-06-29T18:00:00.000Z",
      notes: null,
      items: [
        item("Maçã fugi", 195),
        item("Pêra William", 167),
        item("Iogurte grego light Danone", 80),
        item("Leite integral", 110),
        item("Alimento da imagem", 50),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 20g maçã e 16g da pê",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        adjustments: [
          expect.objectContaining({ foodName: "Maçã fugi", previousGrams: 195, nextGrams: 175 }),
          expect.objectContaining({ foodName: "Pêra William", previousGrams: 167, nextGrams: 151 }),
        ],
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: expect.arrayContaining([
        expect.objectContaining({ foodName: "Maçã fugi", estimatedGrams: 175 }),
        expect.objectContaining({ foodName: "Pêra William", estimatedGrams: 151 }),
        expect.objectContaining({ foodName: "Alimento da imagem", estimatedGrams: 50 }),
      ]),
    }));
  });

  it("reduz gramas de alimento registrado em refeição anterior à última", async () => {
    listMealsMock.mockResolvedValue([
      { id: 3, mealLabel: "Lanche", occurredAt: "2026-06-29T18:20:00.000Z", notes: null, items: [item("Mel", 15)] },
      { id: 2, mealLabel: "Lanche", occurredAt: "2026-06-29T18:10:00.000Z", notes: null, items: [item("Iogurte grego light Danone", 80)] },
      { id: 1, mealLabel: "Lanche", occurredAt: "2026-06-29T18:00:00.000Z", notes: null, items: [item("Banana prata", 179)] },
    ]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 70g da banana",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        mealId: 1,
        adjustments: [
          expect.objectContaining({ foodName: "Banana prata", previousGrams: 179, nextGrams: 109 }),
        ],
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 1,
      items: [expect.objectContaining({ foodName: "Banana prata", estimatedGrams: 109 })],
    }));
  });

  it("reduz gramas na refeição citada pelo nome mesmo quando não é a última", async () => {
    listMealsMock.mockResolvedValue([
      { id: 21, mealLabel: "Lanche", occurredAt: "2026-06-29T18:00:00.000Z", notes: null, items: [item("Arroz branco", 90)] },
      { id: 20, mealLabel: "Almoço", occurredAt: "2026-06-29T15:00:00.000Z", notes: null, items: [item("Arroz branco", 150)] },
    ]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 30g do arroz do almoço",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        mealId: 20,
        adjustments: [
          expect.objectContaining({ foodName: "Arroz branco", previousGrams: 150, nextGrams: 120 }),
        ],
      }),
    }));
  });
});
