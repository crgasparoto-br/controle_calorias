import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

const { executeWhatsappGramsAdjustmentIntent } = await import("./gramsAdjustmentIntent");

const macaItem = {
  foodName: "Maçã Fuji",
  canonicalName: "Maçã Fuji",
  portionText: "100 g",
  servings: 1,
  estimatedGrams: 100,
  calories: 52,
  protein: 0.3,
  carbs: 14,
  fat: 0.2,
  confidence: 0.9,
  source: "catalog" as const,
};

const peraItem = {
  foodName: "Pêra William",
  canonicalName: "Pêra William",
  portionText: "120 g",
  servings: 1,
  estimatedGrams: 120,
  calories: 72,
  protein: 0.4,
  carbs: 18.6,
  fat: 0.2,
  confidence: 0.9,
  source: "catalog" as const,
};

const ultimoItem = {
  foodName: "Iogurte natural",
  canonicalName: "Iogurte natural",
  portionText: "170 g",
  servings: 1,
  estimatedGrams: 170,
  calories: 102,
  protein: 9,
  carbs: 12,
  fat: 2,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("executeWhatsappGramsAdjustmentIntent issue #578", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
  });

  it("reduz maçã e pêra sem aplicar fallback no último alimento", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 578,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-07-01T00:30:00.000Z").getTime(),
        items: [macaItem, peraItem, ultimoItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 578,
      ...input,
    }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 21g da maçã e 16g da pêra",
      receivedAt: new Date("2026-07-01T01:13:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledOnce();
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 578,
      items: [
        expect.objectContaining({ foodName: "Maçã Fuji", estimatedGrams: 79, portionText: "79 g" }),
        expect.objectContaining({ foodName: "Pêra William", estimatedGrams: 104, portionText: "104 g" }),
        expect.objectContaining({ foodName: "Iogurte natural", estimatedGrams: 170, portionText: "170 g" }),
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      eventType: "whatsapp.intent.meal_item_grams_adjusted",
    }));
    expect(result?.reply).toContain("Maçã Fuji");
    expect(result?.reply).toContain("Pêra William");
    expect(result?.reply).toContain("Iogurte natural");
    expect(result?.reply).toContain("Total da refeição:");
    expect(result?.data).toEqual(expect.objectContaining({
      adjustments: [
        expect.objectContaining({ foodName: "Maçã Fuji", nextGrams: 79 }),
        expect.objectContaining({ foodName: "Pêra William", nextGrams: 104 }),
      ],
    }));
  });

  it("mantem fallback para o último item apenas quando o comando simples não informa alimento", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 579,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-07-01T00:30:00.000Z").getTime(),
        items: [macaItem, peraItem, ultimoItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 579,
      ...input,
    }));

    await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 21g",
      receivedAt: new Date("2026-07-01T01:13:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 579,
      items: [
        expect.objectContaining({ foodName: "Maçã Fuji", estimatedGrams: 100 }),
        expect.objectContaining({ foodName: "Pêra William", estimatedGrams: 120 }),
        expect.objectContaining({ foodName: "Iogurte natural", estimatedGrams: 149 }),
      ],
    }));
  });
});
