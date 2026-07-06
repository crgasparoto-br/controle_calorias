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

function item(foodName: string, estimatedGrams: number, overrides: Partial<{ canonicalName: string; brand: string }> = {}) {
  return {
    foodName,
    canonicalName: overrides.canonicalName ?? foodName,
    brand: overrides.brand ?? null,
    portionText: `${estimatedGrams} g`,
    servings: 1,
    estimatedGrams,
    quantity: estimatedGrams,
    unit: "g",
    calories: estimatedGrams,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
  };
}

describe("executeWhatsappTextIntent meal item target matching", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    getUserNutritionGoalMock.mockResolvedValue({ today: { calories: 2200 } });
  });

  it("reduz gramas usando nome parcial do item salvo com nome completo", async () => {
    const meal = {
      id: 61,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Pao frances", 50),
        item("Queijo Minas Padrao Fatiado", 80),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Diminuir 20g do queijo Minas",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        adjustments: [
          expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 60 }),
        ],
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 61,
      items: [
        expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 }),
        expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 60 }),
      ],
    }));
  });

  it("substitui quantidade usando alvo com pequeno erro de digitacao", async () => {
    const meal = {
      id: 62,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Pao frances", 50),
        item("Queijo Minas Padrao Fatiado", 80),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Mudar quejo minas para 60g",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        foodName: "Queijo Minas Padrao Fatiado",
        previousGrams: 80,
        nextGrams: 60,
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 62,
      items: [
        expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 }),
        expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 60 }),
      ],
    }));
  });

  it("pede esclarecimento com opcoes quando alvo generico e ambiguo", async () => {
    const meal = {
      id: 63,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Aumentar 20g do queijo",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: expect.stringContaining("1. Queijo Minas Padrao Fatiado (80 g)"),
    }));
    expect(result?.reply).toContain("2. Queijo mussarela (70 g)");
    expect(updateMealMock).not.toHaveBeenCalled();
  });
});
