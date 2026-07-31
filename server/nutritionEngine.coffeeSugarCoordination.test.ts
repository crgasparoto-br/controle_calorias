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

function aiResponse(items: unknown[]) {
  return {
    outputText: JSON.stringify({
      mealLabel: "Café da manhã",
      confidence: 0.91,
      reasoning: "Estimativa deliberada para o cenário coordenado.",
      items,
    }),
  };
}

function coordinatedCoffeeItem() {
  return {
    foodName: "Café com leite e açúcar",
    brand: null,
    quantity: 1,
    unit: "xícara",
    portionText: "1 xícara",
    servings: 1,
    estimatedGrams: 205,
    estimatedCalories: 82,
    estimatedMacros: {
      protein: 3,
      carbs: 13,
      fat: 2,
    },
    confidence: 0.9,
    foodClassification: {
      processingLevel: "natural_or_minimally_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
    },
  };
}

describe("nutritionEngine com complementos coordenados", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("solicita a quantidade do açúcar quando a IA não fornece nutrição utilizável", async () => {
    createTextResponseMock.mockResolvedValueOnce(aiResponse([]));
    const { processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      text: "1 xícara de café com leite e açúcar",
    })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({
        component: "açúcar",
        originalText: "1 xícara de café com leite e açúcar",
      }),
    });
  });

  it("preserva a preparação completa quando a IA fornece estimativa utilizável", async () => {
    createTextResponseMock.mockResolvedValueOnce(aiResponse([coordinatedCoffeeItem()]));
    const { processMealInput } = await import("./nutritionEngine");

    const result = await processMealInput({
      text: "1 xícara de café com leite e açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expect.stringMatching(/café.*leite.*açúcar/i),
      canonicalName: expect.stringMatching(/café.*leite.*açúcar/i),
      calories: 82,
      protein: 3,
      carbs: 13,
      fat: 2,
    }));
  });

  it("não reduz leite com açúcar explícito à heurística de 22 kcal", async () => {
    createTextResponseMock.mockResolvedValueOnce(aiResponse([coordinatedCoffeeItem()]));
    const { processMealInput } = await import("./nutritionEngine");

    const result = await processMealInput({
      text: "1 xícara de café com leite e 5 g de açúcar",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expect.stringMatching(/café.*leite/i),
      calories: 82,
      protein: 3,
      carbs: 13,
      fat: 2,
    }));
    expect(result.items[0]).not.toEqual(expect.objectContaining({
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });
});
