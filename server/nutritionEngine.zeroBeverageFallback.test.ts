import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

type ZeroBeverageCase = [text: string, foodName: string, brand?: string];

const ZERO_BEVERAGE_CASES: ZeroBeverageCase[] = [
  ["350 ml Água Tônica Zero Açúcar", "Água Tônica Zero Açúcar"],
  ["350 ml Schweppes Tônica Zero", "Schweppes Tônica Zero", "Schweppes"],
  ["350 ml Schweppes Água Tônica Sem Açúcar", "Schweppes Água Tônica Sem Açúcar", "Schweppes"],
  ["350 ml Refrigerante Diet", "Refrigerante Diet"],
  ["350 ml REFRIGERANTE ZERO", "REFRIGERANTE ZERO"],
  ["350 ml ZERO AÇÚCAR ÁGUA TÔNICA", "ZERO AÇÚCAR ÁGUA TÔNICA"],
  ["350 ml Sprite Zero", "Sprite Zero"],
  ["350 ml Schweppes Citrus Zero", "Schweppes Citrus Zero", "Schweppes"],
];

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
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));
vi.mock("./catalogMatching", async () => {
  const actual = await vi.importActual<typeof import("./catalogMatching")>("./catalogMatching");
  return {
    ...actual,
    findCatalogFood: vi.fn(() => undefined),
  };
});
vi.mock("./tacoLookup", () => ({
  findTacoFood: vi.fn(() => undefined),
}));

function mockZeroNutritionExtraction(foodName: string, brand?: string) {
  createTextResponseMock.mockResolvedValue({
    id: "resp_zero_beverage",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.84,
      reasoning: "Bebida identificada, mas sem informação nutricional utilizável.",
      items: [
        {
          foodName,
          ...(brand ? { brand } : {}),
          quantity: 350,
          unit: "ml",
          portionText: "350 ml",
          servings: 1,
          estimatedGrams: 350,
          estimatedCalories: 0,
          estimatedMacros: {
            protein: 0,
            carbs: 0,
            fat: 0,
          },
          confidence: 0.8,
          foodClassification: {
            processingLevel: "ultra_processed",
            isFruit: false,
            isVegetable: false,
            fiberGrams: 0,
          },
        },
      ],
    }),
    raw: { mocked: true },
  });
}

describe("nutritionEngine zero beverage fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it.each(ZERO_BEVERAGE_CASES)("zera o fallback de bebida explicitamente zero: %s", async (text, foodName, brand) => {
    mockZeroNutritionExtraction(foodName, brand);

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    if (brand) {
      expect(result.items[0].foodName).toContain(brand);
      expect(result.items[0].brand).toBe(brand);
    }
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("prioriza referência nutricional específica antes da heurística zero", async () => {
    findCatalogFoodSemanticMock.mockResolvedValue({
      slug: "agua-tonica-zero-especifica",
      name: "Água Tônica Zero Açúcar",
      aliases: [],
      servingLabel: "100 ml",
      gramsPerServing: 100,
      calories: 1,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
    mockZeroNutritionExtraction("Água Tônica Zero Açúcar");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "350 ml Água Tônica Zero Açúcar",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Água Tônica Zero Açúcar",
      calories: 3.5,
      source: "catalog",
    }));
  });

  it("não zera bebida regular sem marcador zero/diet/sem açúcar", async () => {
    mockZeroNutritionExtraction("Água Tônica");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "350 ml Água Tônica",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items[0].calories).toBe(525);
    expect(result.items[0]).toEqual(expect.objectContaining({
      protein: 21,
      carbs: 52.5,
      fat: 17.5,
      source: "heuristic",
    }));
  });

  it("não trata alimento sólido zero açúcar como bebida zero", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_zero_sugar_chocolate",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.8,
        reasoning: "Alimento sólido sem nutrição utilizável.",
        items: [
          {
            foodName: "Chocolate zero açúcar",
            quantity: 30,
            unit: "g",
            portionText: "30 g",
            servings: 1,
            estimatedGrams: 30,
            estimatedCalories: 0,
            estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
            confidence: 0.8,
            foodClassification: {
              processingLevel: "ultra_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 0,
            },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "30 g Chocolate zero açúcar",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items[0].calories).toBe(45);
    expect(result.items[0].source).toBe("heuristic");
  });

  it("mantém a bebida zero zerada quando a IA fica indisponível e preserva a descrição comercial", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "350 ml Schweppes Água Tônica Zero Açúcar",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Schweppes Água Tônica Zero Açúcar",
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("preserva quantidade pós-nome separada por vírgula quando a IA fica indisponível", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "Água Tônica Zero Açúcar, 350 ml",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Água Tônica Zero Açúcar",
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it.each([
    "30 g Biscoito tipo soda zero açúcar",
    "30 g Bala de cola zero açúcar",
    "100 g Sobremesa de guaraná zero açúcar",
    "30 g Geleia de guaraná zero açúcar",
    "10 g Pastilha de cola zero açúcar",
    "60 g Picolé de guaraná zero açúcar",
    "30 g Guaraná zero em pó",
    "20 ml Xarope sabor guaraná zero açúcar",
    "60 g Picolé de refrigerante zero açúcar",
    "170 g Iogurte sabor refrigerante zero açúcar",
    "5 g Chiclete sabor refrigerante zero açúcar",
    "100 g Gelatina sabor tônica zero açúcar",
    "30 g Bala de refri zero açúcar",
    "60 g Schweppes Picolé Zero",
    "60 g Sprite Picolé Zero",
  ])("não zera alimento sólido que contém termo também usado por bebida: %s", async text => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].calories).toBeGreaterThan(0);
    expect(result.totals.calories).toBeGreaterThan(0);
  });

  it.each([
    "350 ml Sprite Zero",
    "350 ml Schweppes Citrus Zero",
  ])("mantém bebida gaseificada equivalente zerada quando a IA fica indisponível: %s", async text => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });


  it.each([
    "Sprite Zero",
    "Schweppes Tônica Zero",
    "Schweppes Citrus Zero",
    "ZERO AÇÚCAR ÁGUA TÔNICA",
    "Refrigerante Diet",
  ])("reconhece núcleo positivo de bebida zero mesmo sem quantidade explícita: %s", async text => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("propaga os valores corrigidos para item e total na resposta do WhatsApp", async () => {
    mockZeroNutritionExtraction("Schweppes Tônica Zero", "Schweppes");

    const { processMealInput } = await import("./nutritionEngine");
    const { buildWhatsAppMealReplyMessage } = await import("./modules/whatsapp/replyMessages");
    const result = await processMealInput({
      text: "350 ml Schweppes Tônica Zero",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });
    const reply = buildWhatsAppMealReplyMessage(result);

    expect(reply).toContain("Schweppes Tônica Zero");
    expect(reply).toContain("0 kcal | P 0 g | C 0 g | G 0 g");
    expect(reply).toContain("*Total da refeição:*");
    expect(reply).toContain("*0 kcal | P 0 g | C 0 g | G 0 g*");
  });
});
