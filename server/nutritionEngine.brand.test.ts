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

describe("nutritionEngine branded catalog selection", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));
  });

  it("reconhece marca no meio da frase e prioriza produto especifico", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "comi um iogurte Nestlé natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Comi Um Iogurte Nestlé Natural",
      canonicalName: "Iogurte Natural Nestlé",
      brand: "Nestlé",
      portionText: "170 g",
      estimatedGrams: 170,
      calories: 108,
      source: "catalog",
    }));
  });

  it("preserva variacao zero e nao troca por produto tradicional", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "Coca-Cola zero lata",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Coca-Cola Zero Lata",
      brand: "Coca-Cola",
      portionText: "1 lata",
      calories: 0,
      carbs: 0,
      source: "catalog",
    }));
  });

  it("usa generico como aproximacao quando a marca nao existe no catalogo", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "iogurte Danone natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Iogurte Natural Integral",
      brand: "Danone",
      portionText: "170 g",
      source: "heuristic",
    }));
    expect(result.items[0].confidence).toBeLessThanOrEqual(0.62);
  });

  it("mantem fluxo generico para alimento sem marca", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "iogurte natural 170g",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Iogurte Natural Integral",
      brand: null,
      portionText: "170 g",
      source: "catalog",
    }));
  });

  it("propaga marca nova extraida pela IA em campo estruturado", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_structured_brand_growth",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.86,
        reasoning: "Usuário informou marca Growth explicitamente no texto.",
        items: [
          {
            foodName: "whey proten doce de leite",
            brand: "growth",
            quantity: 18,
            unit: "g",
            portionText: "18 g",
            servings: 1,
            estimatedGrams: 18,
            estimatedCalories: 72,
            estimatedMacros: { protein: 14, carbs: 2, fat: 1 },
            confidence: 0.82,
            foodClassification: { processingLevel: "ultra_processed", isFruit: false, isVegetable: false, fiberGrams: 0 },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "18g whey proten doce de leite Growth",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Whey Proten Doce de Leite",
      canonicalName: "Whey Proten Doce de Leite",
      brand: "Growth",
      quantity: 18,
      unit: "g",
      portionText: "18 g",
      estimatedGrams: 18,
      calories: 72,
      source: "hybrid",
    }));
  });

  it("nao inventa marca quando a IA retorna brand nulo", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_no_brand",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.8,
        reasoning: "Alimento informado sem marca explícita.",
        items: [
          {
            foodName: "pão com mel",
            brand: null,
            quantity: 100,
            unit: "g",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 260,
            estimatedMacros: { protein: 7, carbs: 48, fat: 4 },
            confidence: 0.78,
            foodClassification: { processingLevel: "processed", isFruit: false, isVegetable: false, fiberGrams: 2 },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "100g pão com mel",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Pão com Mel",
      canonicalName: "Pão com Mel",
      brand: null,
      quantity: 100,
      unit: "g",
      source: "hybrid",
    }));
  });

  it("preserva marca conhecida no fallback heuristico quando o provider esta indisponivel", async () => {
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "18g whey proten doce de leite Growth",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Whey Proten Doce de Leite Growth",
      brand: "Growth",
      quantity: 18,
      unit: "g",
      portionText: "18 g",
      estimatedGrams: 18,
      source: "heuristic",
    }));
  });
});
