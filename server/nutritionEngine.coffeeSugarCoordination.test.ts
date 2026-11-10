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

  it.each([
    "5 gramas",
    "cinco gramas",
    "1 pacote",
    "um pacote",
    "2 sachês",
    "dois sachês",
    "3 kg",
    "três quilos",
    "4 mg",
    "quatro miligramas",
  ])("A-005: rejects competing sugar amount before inference: %s", async extra => {
    const text = `café com uma colher de chá de açúcar e ${extra} de açúcar`;
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});

describe("PR #1339 A-006/A-007: nutrition processing", () => {
  it.each([
    "café com 1/2 colher de chá de açúcar",
    "café com 3/4 colher de chá de açúcar",
    "café com 1+2 colheres de chá de açúcar",
    "café com -2 colheres de chá de açúcar",
    "café com uma colher de chá de açúcar e cinco gramas adicionais de açúcar",
    "café com uma colher de chá de açúcar e 5 g extras de açúcar",
    "café com −2 colheres de chá de açúcar",
    "café com 3×2 colheres de chá de açúcar",
    "café com 1−2 colheres de chá de açúcar",
    "café com 1:2 colheres de chá de açúcar",
    "café com 1 : 2 colheres de chá de açúcar",
    "café com 3x2 colheres de chá de açúcar",
    "café com 1⁄2 colher de chá de açúcar",
    "café com 2·3 colheres de chá de açúcar",
    "café com 1—2 colheres de chá de açúcar",
    "café com 1÷2 colheres de chá de açúcar",
    "café com +2 colheres de chá de açúcar",
    "café com uma colher de chá de açúcar e um grama adicional de açúcar",
    "café com uma colher de chá de açúcar e 1 grama adicional de açúcar",
    "café com uma colher de chá de açúcar e 1 g adicional de açúcar",
    "café com uma colher de chá de açúcar e um sachê adicional de açúcar",
    "café com uma colher de chá de açúcar e 2 sachês adicionais de açúcar",
    "café com uma colher de chá de açúcar e 1 g extra de açúcar",
    "café com uma colher de chá de açúcar e dois gramas a mais de açúcar",
  ])("requires clarification before AI for %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});

describe("PR #1339 A-008: block unknown and elided sugar quantities before AI", () => {
  it.each([
    "café com uma colher de chá de açúcar e 1 pitada de açúcar",
    "café com uma colher de chá de açúcar e cinco gramas adicionais",
    "café com uma colher de chá de açúcar e mais 5 g",
    "café com uma colher de chá de açúcar e 1 pitada",
    "café com uma colher de chá de açúcar e meio sachê de açúcar",
    "café com uma colher de chá de açúcar e +3g a mais",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 sachê de açúcar",
    "café com uma colher de chá de açúcar e ½ g de açúcar",
    "café com uma colher de chá de açúcar e 1⁄2 g de açúcar",
    "café com uma colher de chá de açúcar e 1∕2 g de açúcar",
    "café com uma colher de chá de açúcar e 2½ g de açúcar",
    "café com uma colher de chá de açúcar e 1/2g de açúcar",
    "café com uma colher de chá de açúcar e +1/2g de açúcar",
    "café com uma colher de chá de açúcar e 1/2 g adicionais",
    "café com uma colher de chá de açúcar e 1/2 g de açúcar.",
    "café com uma colher de chá de açúcar e 1/2 g a mais de açúcar",
    "café com uma colher de chá de açúcar e ½ sachê a mais",
    "café com uma colher de chá de açúcar e 1/2 g",
    "café com uma colher de chá de açúcar e mais meia de açúcar",
    "café com uma colher de chá de açúcar e duas de açúcar",
    "café com uma colher de chá de açúcar e 5 de açúcar",
    "café com uma colher de chá de açúcar e 1/2 de açúcar",
    "café com uma colher de chá de açúcar e meia a mais",
    "café com uma colher de chá de açúcar e mais 2",
    "café com uma colher de chá de açúcar e meia a mais de açúcar",
    "café com uma colher de chá de açúcar e mais duas de açúcar",
    "café com uma colher de chá de açúcar e 0,5 de açúcar",
    "café com uma colher de chá de açúcar e duas adicionais",
    "café com uma colher de chá de açúcar e meia extra",
    "café com uma colher de chá de açúcar e meia pequena porção de açúcar",
    "café com uma colher de chá de açúcar e uma medida adicional de açúcar",
    "café com uma colher de chá de açúcar e duas porções adicionais de açúcar",
  ])("requests clarification without an AI call for %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});


describe("PR #1339 A-008: alternatives require clarification before AI", () => {
  it.each([
    "caf\u00e9 com 1 ou 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com uma ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 e 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 a 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou talvez 2 colheres de ch\u00e1 de a\u00e7\u00facar",
  ])("rejects an ambiguous spoon quantity without provider inference: %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});
