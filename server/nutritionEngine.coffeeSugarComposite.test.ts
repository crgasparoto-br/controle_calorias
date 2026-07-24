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

describe("nutritionEngine preserva refeições compostas com café adoçado", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("mantém café com açúcar e café sem açúcar como dois itens distintos", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 xícara de café com 5 g de açúcar e 1 xícara de café sem açúcar",
    });

    expect(result.items).toHaveLength(2);
    const sweetened = result.items.find(item => item.canonicalName === "Café com açúcar");
    const unsweetened = result.items.find(item => /sem açúcar/i.test(item.canonicalName));

    expect(sweetened).toEqual(expect.objectContaining({
      estimatedGrams: 205,
      calories: 22,
      carbs: 5,
    }));
    expect(unsweetened).toEqual(expect.objectContaining({
      calories: expect.any(Number),
      carbs: 0,
    }));
    expect(unsweetened!.calories).toBeLessThanOrEqual(2);
  });

  it("não descarta alimentos companheiros quando o açúcar está explícito", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "1 pão francês e 1 xícara de café com 5 g de açúcar",
    });

    expect(result.items).toHaveLength(2);
    expect(result.items.some(item => /pão francês/i.test(item.foodName))).toBe(true);
    expect(result.items.find(item => item.canonicalName === "Café com açúcar")).toEqual(
      expect.objectContaining({ calories: 22, carbs: 5 }),
    );
  });

  it("não atribui ao café o açúcar explicitado somente em outro alimento", async () => {
    const { processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      text: "1 xícara de café com açúcar e 1 fatia de bolo com 10 g de açúcar",
    })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ component: "açúcar" }),
    });
  });

  it("não usa a estimativa do café com leite para satisfazer o café adoçado", async () => {
    createTextResponseMock.mockResolvedValueOnce({
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.9,
        reasoning: "Somente o café com leite foi estimado.",
        items: [{
          foodName: "Café com leite",
          brand: null,
          quantity: 1,
          unit: "xícara",
          portionText: "1 xícara",
          servings: 1,
          estimatedGrams: 200,
          estimatedCalories: 60,
          estimatedMacros: {
            protein: 2,
            carbs: 5,
            fat: 2,
          },
          confidence: 0.9,
          foodClassification: {
            processingLevel: "natural_or_minimally_processed",
            isFruit: false,
            isVegetable: false,
            fiberGrams: 0,
          },
        }],
      }),
    });

    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({
      text: "1 xícara de café com açúcar e 1 xícara de café com leite",
    })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ component: "açúcar" }),
    });
  });
});
