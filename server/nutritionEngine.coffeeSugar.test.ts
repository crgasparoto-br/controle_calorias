import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => null),
}));

function aiCoffeeItem(input: {
  calories: number;
  carbs: number;
  protein?: number;
  fat?: number;
  foodName?: string;
}) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.91,
    reasoning: "Café adoçado informado explicitamente.",
    items: [{
      foodName: input.foodName ?? "Café com açúcar",
      brand: null,
      quantity: 1,
      unit: "xícara",
      portionText: "1 xícara",
      servings: 1,
      estimatedGrams: 200,
      estimatedCalories: input.calories,
      estimatedMacros: {
        protein: input.protein ?? 0,
        carbs: input.carbs,
        fat: input.fat ?? 0,
      },
      confidence: 0.9,
      foodClassification: {
        processingLevel: "processed_culinary_ingredient",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0,
      },
    }],
  };
}

describe("nutritionEngine coffee with sugar handling", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("incorpora a quantidade explícita de açúcar uma única vez", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com 5 g de açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      quantity: 1,
      unit: "xícara",
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
      protein: 0,
      fat: 0,
    }));
    expect(result.items[0].canonicalName).not.toMatch(/sem açúcar/i);
    expect(result.totals.calories).toBe(22);
  });

  it("preserva volume explícito e usa a mesma porção canônica de uma xícara", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "200 ml de café com 5 g de açúcar",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      quantity: 200,
      unit: "ml",
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));
    expect(result.totals.calories).toBe(22);
  });

  it("usa 5 g de açúcar por xícara quando a quantidade não foi informada", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com açúcar" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      quantity: 1,
      unit: "xícara",
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));
    expect(result.items[0].portionText).toMatch(/estimado 5 g/i);
  });

  it("escala a regra canônica para 100 ml", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "100 ml de café com açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 100,
      unit: "ml",
      estimatedGrams: 102.5,
      calories: 11,
      carbs: 2.5,
    }));
    expect(result.items[0].portionText).toMatch(/estimado 2.5 g/i);
  });

  it("escala a regra canônica para duas xícaras", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "2 xícaras de café com açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 2,
      unit: "xícara",
      estimatedGrams: 410,
      calories: 44,
      carbs: 10,
    }));
  });

  it("mantém açúcar explícito com precedência sobre a regra padrão", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com 8 g de açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      estimatedGrams: 208,
      calories: 34,
      carbs: 8,
    }));
    expect(result.items[0].portionText).toMatch(/8 g de açúcar/i);
  });

  it("não deixa uma estimativa inválida da IA sobrescrever a regra canônica", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiCoffeeItem({ calories: 10, carbs: 0, protein: 1 })),
    });
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({ calories: 22, carbs: 5 }));
  });

  it("não deixa uma estimativa plausível da IA sobrescrever a regra canônica", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiCoffeeItem({ calories: 34, carbs: 8, protein: 0.1 })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
  });

  it("não deixa o nome genérico da IA apagar o qualificador nem alterar a regra", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiCoffeeItem({
        foodName: "Café",
        calories: 34,
        carbs: 8,
      })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café com açúcar" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
      calories: 22,
      carbs: 5,
    }));
  });

  it("mantém o controle sem açúcar praticamente sem calorias", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "1 xícara de café sem açúcar" });

    expect(result.items[0].canonicalName).toBe("Café Sem Açúcar");
    expect(result.items[0].calories).toBeLessThanOrEqual(2);
    expect(result.items[0].carbs).toBe(0);
  });
});
