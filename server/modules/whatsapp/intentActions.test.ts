import { beforeEach, describe, expect, it, vi } from "vitest";

const listMealsMock = vi.fn();
const updateMealMock = vi.fn();
const createWaterLogMock = vi.fn();

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

const beansItem = {
  foodName: "Feijão carioca",
  canonicalName: "Feijão carioca cozido",
  portionText: "100 g",
  servings: 1,
  estimatedGrams: 100,
  calories: 76,
  protein: 4.8,
  carbs: 13.6,
  fat: 0.5,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("executeWhatsappTextIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
  });

  it("registra água na data relativa indicada pelo texto", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "registra 500 ml de água ontem",
      receivedAt: new Date("2026-06-03T12:33:00.000Z"),
    });

    expect(createWaterLogMock).toHaveBeenCalledWith(42, {
      amountMl: 500,
      occurredAt: expect.stringMatching(/^2026-06-02T/),
    });
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "water_logged",
      eventType: "whatsapp.intent.water_logged",
    }));
  });

  it("pede quantidade quando entende água sem valor explícito", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "adicionar água ontem",
      receivedAt: new Date("2026-06-03T12:33:00.000Z"),
    });

    expect(createWaterLogMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: expect.stringContaining("preciso da quantidade"),
    }));
  });

  it("reduz gramas do alimento informado na última refeição", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 10,
        userId: 42,
        mealLabel: "Almoço",
        occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(),
        notes: "Registro pelo WhatsApp",
        items: [riceItem, beansItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 10,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "reduzir 50 gramas do arroz",
      receivedAt: new Date("2026-06-03T16:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 10,
      mealLabel: "Almoço",
      items: [
        expect.objectContaining({
          foodName: "Arroz branco",
          estimatedGrams: 100,
          portionText: "100 g",
          calories: 130,
        }),
        beansItem,
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: expect.stringContaining("de 150 g para 100 g"),
    }));
  });

  it("usa o último item da última refeição quando o alimento não é citado", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 11,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-03T22:00:00.000Z").getTime(),
        items: [riceItem, beansItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 11,
      ...input,
    }));

    await executeWhatsappTextIntent(42, {
      text: "diminuir 30g",
      receivedAt: new Date("2026-06-03T22:30:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 11,
      items: [
        riceItem,
        expect.objectContaining({
          foodName: "Feijão carioca",
          estimatedGrams: 70,
          portionText: "70 g",
        }),
      ],
    }));
  });

  it("retorna null quando o texto não é uma ação conhecida", async () => {
    await expect(executeWhatsappTextIntent(42, {
      text: "almocei arroz, feijão e frango",
      receivedAt: new Date("2026-06-03T16:00:00.000Z"),
    })).resolves.toBeNull();
  });
});
