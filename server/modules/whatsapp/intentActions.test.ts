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

const bananaItem = {
  foodName: "Banana",
  canonicalName: "Banana prata",
  portionText: "120 g",
  servings: 1,
  estimatedGrams: 120,
  calories: 106,
  protein: 1.3,
  carbs: 27.6,
  fat: 0.4,
  confidence: 0.9,
  source: "catalog" as const,
};

const mayonnaiseItem = {
  foodName: "Maionese",
  canonicalName: "Maionese",
  portionText: "30 g",
  servings: 1,
  estimatedGrams: 30,
  calories: 198,
  protein: 0.3,
  carbs: 0.4,
  fat: 21,
  confidence: 0.9,
  source: "catalog" as const,
};

describe("executeWhatsappTextIntent", () => {
  beforeEach(() => {
    listMealsMock.mockReset();
    updateMealMock.mockReset();
    createWaterLogMock.mockReset();
    getUserNutritionGoalMock.mockReset();
    createWaterLogMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 91,
      userId: 42,
      ...input,
    }));
    getUserNutritionGoalMock.mockResolvedValue({
      today: {
        calories: 2200,
      },
    });
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

  it("substitui a quantidade anterior pelo peso informado para o alimento", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 13,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-03T18:00:00.000Z").getTime(),
        notes: "Registro pelo WhatsApp",
        items: [bananaItem, riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 13,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Mudar banana para 79g",
      receivedAt: new Date("2026-06-03T18:10:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 13,
      mealLabel: "Lanche",
      items: [
        expect.objectContaining({
          foodName: "Banana",
          estimatedGrams: 79,
          portionText: "79 g",
          calories: 69.8,
          protein: 0.9,
          carbs: 18.2,
          fat: 0.3,
        }),
        riceItem,
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_grams_adjusted",
      reply: expect.stringContaining("de 120 g para 79 g"),
    }));
  });

  it("substitui o alimento identificado por outro informado pelo usuário e recalcula os macros", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 14,
        userId: 42,
        mealLabel: "Lanche",
        occurredAt: new Date("2026-06-03T18:00:00.000Z").getTime(),
        notes: "Registro por imagem",
        items: [mayonnaiseItem, riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 14,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "não é maionese é requeijão",
      receivedAt: new Date("2026-06-03T18:10:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 14,
      mealLabel: "Lanche",
      items: [
        expect.objectContaining({
          foodName: "requeijão",
          canonicalName: "requeijão",
          estimatedGrams: 30,
          portionText: "30 g",
          calories: 45,
          protein: 1.8,
          carbs: 4.5,
          fat: 1.5,
          source: "heuristic",
        }),
        riceItem,
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_replaced",
      eventType: "whatsapp.intent.meal_item_replaced",
      reply: expect.stringContaining("recalculei os macros"),
    }));
    expect(result?.reply).toContain("45 kcal");
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

  it("adiciona café sem açúcar à refeição indicada", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 12,
        userId: 42,
        mealLabel: "Café da manhã",
        occurredAt: new Date("2026-06-03T10:00:00.000Z").getTime(),
        notes: "Registro pelo WhatsApp",
        items: [riceItem],
      },
    ]);
    updateMealMock.mockImplementation(async (_userId: number, input: Record<string, unknown>) => ({
      id: 12,
      ...input,
    }));

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar a refeição café da manhã",
      receivedAt: new Date("2026-06-03T12:00:00.000Z"),
    });

    expect(updateMealMock).toHaveBeenCalledWith(42, expect.objectContaining({
      mealId: 12,
      mealLabel: "Café da manhã",
      items: [
        riceItem,
        expect.objectContaining({
          foodName: "Café sem açúcar",
          canonicalName: "Café preto sem açúcar",
          portionText: "3 xícaras (150 ml)",
          estimatedGrams: 150,
          calories: 6,
          protein: 0,
          carbs: 0,
          fat: 0,
          source: "heuristic",
        }),
      ],
    }));
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_item_added",
      eventType: "whatsapp.intent.meal_item_added",
      reply: expect.stringContaining("Adicionei 3 xícaras (150 ml) de café sem açúcar"),
    }));
  });

  it("pede esclarecimento quando não encontra a refeição para adicionar café", async () => {
    listMealsMock.mockResolvedValue([]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Adicionar 3 xícaras de café sem açúcar a refeição café da manhã",
      receivedAt: new Date("2026-06-03T12:00:00.000Z"),
    });

    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: expect.stringContaining("Não encontrei a refeição"),
    }));
  });

  it("envia sugestão de lanche quando o usuário pede uma ideia", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "Me dê uma sugestão para o lanche da tarde",
      receivedAt: new Date("2026-06-03T18:00:00.000Z"),
    });

    expect(listMealsMock).not.toHaveBeenCalled();
    expect(updateMealMock).not.toHaveBeenCalled();
    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "meal_suggestion",
      eventType: "whatsapp.intent.meal_suggestion",
      reply: expect.stringContaining("Sugestão para o lanche da tarde"),
    }));
  });

  it("envia relatório do período solicitado", async () => {
    listMealsMock.mockResolvedValue([
      {
        id: 20,
        userId: 42,
        mealLabel: "Almoço",
        occurredAt: new Date("2026-06-03T15:00:00.000Z").getTime(),
        items: [riceItem, beansItem],
      },
      {
        id: 21,
        userId: 42,
        mealLabel: "Jantar",
        occurredAt: new Date("2026-06-02T22:00:00.000Z").getTime(),
        items: [
          {
            ...riceItem,
            foodName: "Frango grelhado",
            canonicalName: "Frango grelhado",
            portionText: "120 g",
            estimatedGrams: 120,
            calories: 198,
            protein: 37,
            carbs: 0,
            fat: 4,
          },
        ],
      },
    ]);

    const result = await executeWhatsappTextIntent(42, {
      text: "Me envie um resumo da semana",
      receivedAt: new Date("2026-06-03T18:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "period_report",
      eventType: "whatsapp.intent.period_report",
      reply: expect.stringContaining("Resumo de semana"),
    }));
    expect(result?.reply).toContain("Refeições registradas: 2");
    expect(result?.reply).toContain("Total consumido: 469 kcal");
    expect(result?.reply).toContain("Meta estimada: 15.400 kcal");
  });

  it("pede período quando o usuário solicita relatório sem período", async () => {
    const result = await executeWhatsappTextIntent(42, {
      text: "Me mande um relatório",
      receivedAt: new Date("2026-06-03T18:00:00.000Z"),
    });

    expect(result).toEqual(expect.objectContaining({
      handled: true,
      action: "clarification_needed",
      reply: expect.stringContaining("Me diga o período"),
    }));
  });

  it("retorna null quando o texto não é uma ação conhecida", async () => {
    await expect(executeWhatsappTextIntent(42, {
      text: "almocei arroz, feijão e frango",
      receivedAt: new Date("2026-06-03T16:00:00.000Z"),
    })).resolves.toBeNull();
  });
});
