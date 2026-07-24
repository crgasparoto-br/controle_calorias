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

function aiMealItem(input: {
  foodName: string;
  calories: number;
  carbs: number;
  protein: number;
  fat: number;
}) {
  return {
    mealLabel: "Café da manhã",
    confidence: 0.91,
    reasoning: "A preparação completa foi estimada.",
    items: [{
      foodName: input.foodName,
      brand: null,
      quantity: 1,
      unit: "xícara",
      portionText: "1 xícara",
      servings: 1,
      estimatedGrams: 205,
      estimatedCalories: input.calories,
      estimatedMacros: {
        protein: input.protein,
        carbs: input.carbs,
        fat: input.fat,
      },
      confidence: 0.9,
      foodClassification: {
        processingLevel: "natural_or_minimally_processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 0,
      },
    }],
  };
}

describe("nutritionEngine preserva café adoçado composto", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("preserva nome e macros da estimativa completa com leite", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiMealItem({
        foodName: "Café adoçado com leite",
        calories: 82,
        carbs: 13,
        protein: 3,
        fat: 2,
      })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café adoçado com leite",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expect.stringMatching(/café.*leite/i),
      canonicalName: expect.stringMatching(/café.*leite/i),
      calories: 82,
      protein: 3,
      carbs: 13,
      fat: 2,
    }));
  });

  it("não substitui preparação com leite e açúcar explícito pela heurística de 22 kcal", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiMealItem({
        foodName: "Café adoçado com leite",
        calories: 82,
        carbs: 13,
        protein: 3,
        fat: 2,
      })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café adoçado com leite com 5 g de açúcar",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expect.stringMatching(/café.*leite/i),
      canonicalName: expect.stringMatching(/café.*leite/i),
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

  it("recusa composição omitida pela IA e mantém o segmento completo no fallback", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify(aiMealItem({
        foodName: "Café com açúcar",
        calories: 22,
        carbs: 5,
        protein: 0,
        fat: 0,
      })),
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café adoçado com leite com 5 g de açúcar",
    });

    expect(`${result.items[0].foodName} ${result.items[0].canonicalName}`).toMatch(/leite/i);
    expect(result.items[0]).not.toEqual(expect.objectContaining({
      calories: 22,
      protein: 0,
      carbs: 5,
      fat: 0,
    }));
  });
});
