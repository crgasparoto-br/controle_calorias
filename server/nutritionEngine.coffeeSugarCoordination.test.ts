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


describe("PR #1339 A-008/A-1339: ambiguous amounts require clarification before AI", () => {
  it.each([
    "caf\u00e9 com 1 ou 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com uma ou duas colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 e 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "caf\u00e9 com 1 a 2 colheres de sopa de a\u00e7\u00facar",
    "caf\u00e9 com 1 ou talvez 2 colheres de ch\u00e1 de a\u00e7\u00facar",
    "café com 1 e/ou 2 colheres de chá de açúcar",
    "café com uma e/ou duas colheres de chá de açúcar",
    "café com 1 ou/e 2 colheres de sopa de açúcar",
    "café com 1 e-ou 2 colheres de sopa de açúcar",
    "café com 1 colher de chá de açúcar e mais açúcar",
    "café com 1 colher de chá de açúcar e açúcar adicional",
    "café com 1 colher de chá de açúcar ou mais",
    "café com 1 colher de chá de açúcar ou menos",
    "café com 1 colher de chá de açúcar e mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouco",
    "café com 1 colher de chá de açúcar, mais um pouco",
    "café com 1 colher de chá de açúcar; mais um pouco",
    "café com 1 colher de chá de açúcar mais um pouquinho",
    "café com 1 colher de chá de açúcar, mais um tanto",
    "café com 1 colher de chá de açúcar mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar outra",
    "café com 1 colher de chá de açúcar e outra",
    "café com 1 colher de chá de açúcar e outras",
    "café com 1 colher de chá de açúcar e mais um pouquinho",
    "café com 1 colher de chá de açúcar e mais um tanto",
    "café com 1 colher de chá de açúcar ou ainda menos",
    "café com 1 colher de chá de açúcar e também outra",
    "café com 1 colher de chá de açúcar ou um pouco",
    "café com 1 colher de chá de açúcar e mais uma medida",
    "café com 1 colher de chá de açúcar e mais um pouco de açúcar",
    "café com 1 colher de chá de açúcar e outra porção de açúcar",
    "café com 1 colher de chá de açúcar ou outra de açúcar",
    "café com 1 colher de chá de açúcar ou mais ainda",
    "café com 1 colher de chá de açúcar e só mais um tanto",
    "café com 1 colher de chá de açúcar ou menos de açúcar",
    "café com 1 colher de chá de açúcar e mais um pouco extra",
    "café com 1 colher de chá de açúcar e uma dose",
    "café com 1 colher de chá de açúcar e mais outra dose",
    "café com 1 colher de chá de açúcar e mais alguma coisa",
    "café com 1 colher de chá de açúcar e mais algo",
    "café com 1 colher de chá de açúcar e mais uma quantidade",
    "café com 1 colher de chá de açúcar e mais leite e mais um pouco",
    "café com 1 colher de chá de açúcar e outra porção de leite e outra",
    "café com 1 colher de chá de açúcar e uma dose de leite ou menos",
    "café com 1 colher de chá de açúcar e/ou mais",
    "café com 1 colher de chá de açúcar e mais leite e mais alguma coisa",
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


describe("PR #1339 A-001/A-002: unresolved extra spoons fail before AI", () => {
  it.each([
    "café com 1 colher de chá de açúcar e mais uma colher",
    "café com 1 colher de chá de açúcar e mais uma colher de açúcar",
    "café com 1 colher de chá de açúcar e outra colher de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de açúcar",
    "café com 1 colher de chá de açúcar e duas colheres de leite e mais um pouco",
    "café com 1 colher de chá de açúcar e 2 g de leite a mais e mais um pouco",
    "café com 1 colher de chá de açúcar e um pouco mais de açúcar",
    "café com 1 colher de chá de açúcar e um pouco de açúcar a mais",
    "café com 1 colher de chá de açúcar e mais um pouco do açúcar",
    "café com 1 colher de chá de açúcar e mais uma colher de leite e outra",
  ])("requires a component quantity without calling the provider: %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});

describe("A-1339-BIND-01: unbound continuations still fail before AI", () => {
  it.each([
    "café com 1 colher de chá de açúcar e leite e mais um pouco",
    "café com 1 colher de chá de açúcar e leite com mais um pouco e mais um pouco",
    "café com 1 colher de chá de açúcar e leite com mais um pouco de açúcar",
  ])("does not infer nutrition for unresolved sugar/ingredient binding: %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});

describe("A-1339-BIND-02: unbound connector ellipses fail before AI", () => {
  it.each([
    "café com 1 colher de chá de açúcar e com mais um pouco",
    "café com 1 colher de chá de açúcar mas com mais um pouco",
    "café com 1 colher de chá de açúcar e com só um pouco mais",
    "café com 1 colher de chá de açúcar e leite com mais um pouco e com mais um pouco",
  ])("clarifies instead of estimating an unbound extra amount: %s", async text => {
    createTextResponseMock.mockReset();
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});

// Integration contract: these new ambiguities cannot reach the AI provider.
describe("A-133903/A-133904: ambiguous coffee sugar does not reach AI", () => {
  it.each([
    "e depois com mais um pouco",
    "e infelizmente com mais um pouco",
    "e eventualmente com mais um pouco",
    "e provavelmente com mais um pouco",
    "e depois disso com mais um pouco",
    "e isso com mais um pouco",
    "e aquilo com mais um pouco",
    "e nada com mais um pouco",
    "e cuidadosamente com mais um pouco",
    "e um açúcar",
    "e várias pitadas de açúcar",
    "e então com mais um pouco",
    "e talvez com mais um pouco",
    "e agora com mais um pouco",
    "e aqui com mais um pouco",
    "e daí com mais um pouco",
    "e logo com mais um pouco",
    "e novamente com mais um pouco",
    "e por fim com mais um pouco",
    "e de novo com mais um pouco",
    "e em seguida com mais um pouco",
    "e ontem com só um pouco mais",
    "e umas gotas de açúcar",
    "e umas pitadas de açúcar",
    "e uns gramas de açúcar",
    "e vários gramas de açúcar",
    "e algum açúcar",
    "e um pouco de açúcar",
    "e algumas gotas de açúcar",
    "e muitas gotas de açúcar",
    "e poucas pitadas de açúcar",
    "e um açúcar extra",
  ])("requires clarification before inference: %s", async tail => {
    createTextResponseMock.mockReset();
    const text = `café com 1 colher de chá de açúcar ${tail}`;
    const { processMealInput } = await import("./nutritionEngine");
    await expect(processMealInput({ text, userId: 17 })).rejects.toMatchObject({
      code: "food_component_quantity_required",
      context: expect.objectContaining({ originalText: text }),
    });
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});
