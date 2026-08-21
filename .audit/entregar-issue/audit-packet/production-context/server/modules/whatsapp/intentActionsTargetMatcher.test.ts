import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createWaterLogMock = vi.fn();
const getUserNutritionGoalMock = vi.fn();

vi.mock("../../db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getUserNutritionGoal: getUserNutritionGoalMock,
  };
});

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
      items: [item("Pao frances", 50), item("Queijo Minas Padrao Fatiado", 80)],
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
        adjustments: [expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 60 })],
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
      items: [item("Pao frances", 50), item("Queijo Minas Padrao Fatiado", 80)],
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
      data: expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 60 }),
    }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 62,
      items: [
        expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 }),
        expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 60 }),
      ],
    }));
  });

  it("pede esclarecimento com opcoes quando alvo generico de gramas e ambiguo", async () => {
    const meal = {
      id: 63,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [item("Queijo Minas Padrao Fatiado", 80), item("Queijo mussarela", 70)],
    };
    listMealsMock.mockResolvedValue([meal]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Aumentar 20g do queijo",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "clarification_needed", reply: expect.stringContaining("Queijo Minas Padrao Fatiado") }));
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("mantem item claro pendente quando outro alvo do ajuste multiplo e ambiguo", async () => {
    const meal = {
      id: 73,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [item("Banana prata", 100), item("Queijo Minas Padrao Fatiado", 80), item("Queijo mussarela", 70)],
    };
    listMealsMock.mockResolvedValue([meal]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Diminuir 10g da banana e 10g do queijo",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      data: expect.objectContaining({ targetFood: "queijo", candidateCount: 2 }),
    }));
    expect(result?.reply).toContain("Queijo Minas Padrao Fatiado");
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("procura incremento em outra refeicao do mesmo dia quando nao encontra na ultima", async () => {
    const latestMeal = { id: 67, userId: 42, mealLabel: "Jantar", occurredAt: new Date("2026-06-09T21:00:00.000Z").getTime(), notes: null, items: [item("Pao frances", 50)] };
    const lunchMeal = { id: 68, userId: 42, mealLabel: "Almoco", occurredAt: new Date("2026-06-09T15:00:00.000Z").getTime(), notes: null, items: [item("Queijo Minas Padrao Fatiado", 80)] };
    listMealsMock.mockResolvedValue([latestMeal, lunchMeal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 20g ao queijo Minas",
      receivedAt: new Date("2026-06-09T21:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "meal_item_grams_adjusted" }));
    expect(result?.detail).toContain("Escopo da busca: nas refeições do dia");
    expect(updateMealMock).toHaveBeenCalledTimes(1);
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 68,
      items: [expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 100 })],
    }));
  });

  it("mantem ambiguidade da ultima refeicao antes de procurar no restante do dia", async () => {
    const latestMeal = {
      id: 69,
      userId: 42,
      mealLabel: "Jantar",
      occurredAt: new Date("2026-06-09T21:00:00.000Z").getTime(),
      notes: null,
      items: [item("Queijo Minas Padrao Fatiado", 80), item("Queijo mussarela", 70)],
    };
    const lunchMeal = { id: 70, userId: 42, mealLabel: "Almoco", occurredAt: new Date("2026-06-09T15:00:00.000Z").getTime(), notes: null, items: [item("Queijo coalho", 60)] };
    listMealsMock.mockResolvedValue([latestMeal, lunchMeal]);

    const result = await executeWhatsappTextIntent(42, { text: "Diminuir 10g do queijo", receivedAt: new Date("2026-06-09T21:30:00.000Z") });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "clarification_needed", reply: expect.stringContaining("Queijo Minas Padrao Fatiado") }));
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("substitui alimento usando alvo parcial do item salvo com nome completo", async () => {
    const meal = { id: 64, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(), notes: null, items: [item("Pao frances", 50), item("Queijo Minas Padrao Fatiado", 80)] };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, { text: "não é queijo minas é ricota", receivedAt: new Date("2026-06-09T16:30:00.000Z") });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "meal_item_replaced", data: expect.objectContaining({ previousFoodName: "Queijo Minas Padrao Fatiado", nextFoodName: "ricota" }) }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 64,
      items: [expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 }), expect.objectContaining({ foodName: "ricota", estimatedGrams: 80 })],
    }));
  });

  it("substitui alimento usando alvo com pequeno erro de digitacao", async () => {
    const meal = { id: 65, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(), notes: null, items: [item("Pao frances", 50), item("Queijo Minas Padrao Fatiado", 80)] };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, { text: "trocar quejo minas por ricota", receivedAt: new Date("2026-06-09T16:30:00.000Z") });
    expect(result).toEqual(expect.objectContaining({ handled: true, action: "meal_item_replaced", data: expect.objectContaining({ previousFoodName: "Queijo Minas Padrao Fatiado", nextFoodName: "ricota" }) }));
  });

  it("mantem troca clara pendente quando outra troca da mesma mensagem e ambigua", async () => {
    const meal = {
      id: 74,
      userId: 42,
      mealLabel: "Lanche",
      occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(),
      notes: null,
      items: [item("Banana prata", 100), item("Queijo Minas Padrao Fatiado", 80), item("Queijo mussarela", 70)],
    };
    listMealsMock.mockResolvedValue([meal]);

    const result = await executeWhatsappTextIntent(42, {
      text: "não é banana é pera e não é queijo é ricota",
      receivedAt: new Date("2026-06-09T16:30:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      data: expect.objectContaining({ targetFood: "queijo", candidateCount: 2 }),
    }));
    expect(result?.reply).toContain("Queijo Minas Padrao Fatiado");
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("pede esclarecimento com opcoes quando substituicao tem alvo generico ambiguo", async () => {
    const meal = { id: 66, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(), notes: null, items: [item("Queijo Minas Padrao Fatiado", 80), item("Queijo mussarela", 70)] };
    listMealsMock.mockResolvedValue([meal]);

    const result = await executeWhatsappTextIntent(42, { text: "não é queijo é ricota", receivedAt: new Date("2026-06-09T16:30:00.000Z") });
    expect(result).toEqual(expect.objectContaining({ handled: true, action: "clarification_needed", reply: expect.stringContaining("Queijo Minas Padrao Fatiado") }));
    expect(result?.reply).toContain("Queijo mussarela");
    expect(result?.interactiveReply).toEqual(expect.objectContaining({ kind: "functional" }));
    expect(updateMealMock).not.toHaveBeenCalled();
  });

  it("substitui alimento em outra refeicao do mesmo dia quando nao encontra na ultima", async () => {
    const latestMeal = { id: 71, userId: 42, mealLabel: "Jantar", occurredAt: new Date("2026-06-09T21:00:00.000Z").getTime(), notes: null, items: [item("Pao frances", 50)] };
    const lunchMeal = { id: 72, userId: 42, mealLabel: "Almoco", occurredAt: new Date("2026-06-09T15:00:00.000Z").getTime(), notes: null, items: [item("Queijo Minas Padrao Fatiado", 80)] };
    listMealsMock.mockResolvedValue([latestMeal, lunchMeal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, { text: "não é queijo minas é ricota", receivedAt: new Date("2026-06-09T21:30:00.000Z") });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_replaced",
      data: expect.objectContaining({ mealId: 72, previousFoodName: "Queijo Minas Padrao Fatiado", nextFoodName: "ricota" }),
    }));
    expect(result?.reply).toContain("nas refeições do dia");
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({ mealId: 72, items: [expect.objectContaining({ foodName: "ricota", estimatedGrams: 80 })] }));
  });

  it("encontra pera sem acento quando o item salvo usa acento", async () => {
    const meal = { id: 75, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(), notes: null, items: [item("Pêra William", 100), item("Pao frances", 50)] };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, { text: "Diminuir 15g da pera", receivedAt: new Date("2026-06-09T16:30:00.000Z") });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "meal_item_grams_adjusted", data: expect.objectContaining({ adjustments: [expect.objectContaining({ foodName: "Pêra William", previousGrams: 100, nextGrams: 85 })] }) }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 75,
      items: [expect.objectContaining({ foodName: "Pêra William", estimatedGrams: 85 }), expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 })],
    }));
  });

  it("ajusta alvo generico quando existe apenas um candidato compativel", async () => {
    const meal = { id: 76, userId: 42, mealLabel: "Lanche", occurredAt: new Date("2026-06-09T16:00:00.000Z").getTime(), notes: null, items: [item("Queijo Minas Padrao Fatiado", 80), item("Pao frances", 50)] };
    listMealsMock.mockResolvedValue([meal]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({ id: input.mealId, ...input }));

    const result = await executeWhatsappTextIntent(42, { text: "Diminuir 10g do queijo", receivedAt: new Date("2026-06-09T16:30:00.000Z") });

    expect(result).toEqual(expect.objectContaining({ handled: true, action: "meal_item_grams_adjusted", data: expect.objectContaining({ adjustments: [expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", previousGrams: 80, nextGrams: 70 })] }) }));
    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 76,
      items: [expect.objectContaining({ foodName: "Queijo Minas Padrao Fatiado", estimatedGrams: 70 }), expect.objectContaining({ foodName: "Pao frances", estimatedGrams: 50 })],
    }));
  });
});
