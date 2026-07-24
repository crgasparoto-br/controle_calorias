import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => null),
}));

function aiCoffeeItem(input: { calories: number; carbs: number; protein?: number; fat?: number }) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.91,
    reasoning: "Café adoçado informado explicitamente.",
    items: [{
      foodName: "Café com açúcar",
      brand: null,
      quantity: 1,
      unit: "xícara",
      portionText: "1 xícara",
      servings: 1,
      estimatedGrams: 55,
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
      calories: 22,
      carbs: 5,
      protein: 0,
      fat: 0,
    }));
    expect(result.items[0].canonicalName).not.toMatch(/sem açúcar/i);
    expect(result.totals.calories).toBe(22);
  });

  it("preserva volume explícito e soma o açúcar uma única vez", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "200 ml de café com 5 g de açúcar",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Café com açúcar",
      quantity: 200,
      unit: "ml",
      estimatedGrams: 205,
      calories: 28,
      carbs: 5,
    }));
    expect(result.totals.calories).toBe(28);
  });

  it("solicita somente a quantidade de açúcar quando não há estimativa utilizável", async () => {
    const { MealInferenceError, processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      text: "1 xícara de café com açúcar",
    })).rejects.toMatchObject({
      name: "MealInferenceError",
      code: "food_component_quantity_required",
      context: expect.objectContaining({ component: "açúcar" }),
    } satisfies Partial<InstanceType<typeof MealInferenceError>>);
  });

  it("rejeita estimativa que mantém açúcar com zero carboidratos", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiCoffeeItem({
        calories: 10,
        carbs: 0,
        protein: 1,
      })),
    });
    const { MealInferenceError, processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      text: "1 xícara de café com açúcar",
    })).rejects.toMatchObject({
      name: "MealInferenceError",
      code: "food_component_quantity_required",
    } satisfies Partial<InstanceType<typeof MealInferenceError>>);
  });

  it("preserva uma estimativa utilizável da IA sem substituí-la por café sem açúcar", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiCoffeeItem({
        calories: 34,
        carbs: 8,
        protein: 0.1,
      })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Café com Açúcar",
      calories: 34,
      carbs: 8,
    }));
    expect(result.items[0].canonicalName).not.toMatch(/sem açúcar/i);
  });

  it("mantém o controle sem açúcar praticamente sem calorias", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café sem açúcar",
    });

    expect(result.items[0].canonicalName).toBe("Café Sem Açúcar");
    expect(result.items[0].calories).toBeLessThanOrEqual(2);
    expect(result.items[0].carbs).toBe(0);
  });
});
