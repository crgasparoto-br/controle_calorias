import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.hoisted(() => vi.fn());
const updateMealMock = vi.hoisted(() => vi.fn());

vi.mock("../meals/service", () => ({
  listMeals: listMealsMock,
  updateMeal: updateMealMock,
}));

import { executeWhatsappGramsAdjustmentIntent } from "./gramsAdjustmentIntent";

function item(foodName: string, estimatedGrams: number, overrides: Partial<{ canonicalName: string; brand: string }> = {}) {
  return {
    foodName,
    canonicalName: overrides.canonicalName ?? foodName,
    brand: overrides.brand ?? null,
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

  it("reduz gramas por nome parcial em item salvo com nome mais completo e responde com a refeição completa", async () => {
    const meal = {
      id: 10,
      mealLabel: "Lanche",
      occurredAt: "2026-06-29T18:00:00.000Z",
      notes: null,
      items: [
        item("Pao frances", 50),
        item("Queijo Minas Padrao Fatiado", 80),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 20g do queijo Minas",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        adjustments: [
          expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 60 }),
        ],
      }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      items: [
        expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 }),
        expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 60, portionText: "60 g" }),
      ],
    }));
    expect(result?.reply).toContain("Alimento ajustado");
    expect(result?.reply).toContain("Refeição atualizada:");
    expect(result?.reply).toContain("Pao frances");
    expect(result?.reply).toContain("Queijo Minas Padrao Fatiado");
    expect(result?.reply).toContain("Total da refeição:");
  });

  it("tolera pequeno erro de digitacao no alvo da reducao", async () => {
    const meal = {
      id: 11,
      mealLabel: "Lanche",
      occurredAt: "2026-06-29T18:00:00.000Z",
      notes: null,
      items: [
        item("Pao frances", 50),
        item("Queijo Minas Padrao Fatiado", 80),
      ],
    };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Reduzir 20g do quejo minas",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "meal_item_grams_adjusted",
      data: expect.objectContaining({
        adjustments: [
          expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 60 }),
        ],
      }),
    }));
  });

  it("pede esclarecimento quando alvo generico encontra varios itens na ultima refeicao", async () => {
    const latestMeal = {
      id: 12,
      mealLabel: "Lanche",
      occurredAt: "2026-06-29T18:00:00.000Z",
      notes: null,
      items: [
        item("Queijo Minas Padrao Fatiado", 80),
        item("Queijo mussarela", 70),
      ],
    };
    const previousMeal = {
      id: 11,
      mealLabel: "Almoco",
      occurredAt: "2026-06-29T15:00:00.000Z",
      notes: null,
      items: [item("Queijo cottage", 60)],
    };
    listMealsMock.mockResolvedValue([latestMeal, previousMeal]);

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 20g do queijo",
      receivedAt: new Date("2026-06-29T19:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      action: "clarification_needed",
      reply: expect.stringContaining("Queijo Minas Padrao Fatiado"),
    }));
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("busca em refeicao anterior do dia quando a ultima nao tem candidato", async () => {
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

  it("reduz gramas na refeicao citada pelo nome mesmo quando nao e a ultima", async () => {
    listMealsMock.mockResolvedValue([
      { id: 21, mealLabel: "Lanche", occurredAt: "2026-06-29T18:00:00.000Z", notes: null, items: [item("Arroz branco", 90)] },
      { id: 20, mealLabel: "Almoco", occurredAt: "2026-06-29T15:00:00.000Z", notes: null, items: [item("Arroz branco", 150)] },
    ]);
    updateMealMock.mockImplementation(async (_userId, input) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappGramsAdjustmentIntent(42, {
      text: "Diminuir 30g do arroz do almoco",
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
