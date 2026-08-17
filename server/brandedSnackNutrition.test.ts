import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { createTextResponseMock, embeddingsCreateMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  embeddingsCreateMock: vi.fn(),
}));

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
    createEmbeddings: (request: unknown) => embeddingsCreateMock(request),
  }),
}));

vi.mock("./catalogRuntime", async () => {
  const { FOOD_CATALOG_REFERENCE } = await import("./foodCatalogReference");
  return {
    getCatalogCache: () => FOOD_CATALOG_REFERENCE,
  };
});

describe("nutritionEngine branded snack photo nutrition", () => {
  beforeEach(() => {
    vi.stubEnv("OPENAI_API_KEY", "test-openai-key");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("AI_OPENAI_COMPATIBLE_OPERATIONS", "");
    vi.stubEnv("AI_VISION_PROVIDER", "openai");
    vi.stubEnv("OPENAI_MODEL", "gpt-4.1-mini");
    vi.stubEnv("AI_NUTRITION_SEARCH_PROVIDER", "openai");
    vi.stubEnv("AI_NUTRITION_SEARCH_MODEL", "gpt-4.1-mini");
    vi.stubEnv("AI_NUTRITION_SEARCH_MAX_ATTEMPTS", "1");
    vi.stubEnv("AI_NUTRITION_SEARCH_FALLBACK_ENABLED", "false");
    vi.stubEnv("AI_EMBEDDING_PROVIDER", "openai");
    vi.stubEnv("AI_EMBEDDING_MODEL", "text-embedding-3-small");
    vi.stubEnv("AI_EMBEDDING_MAX_ATTEMPTS", "1");
    vi.stubEnv("AI_EMBEDDING_FALLBACK_ENABLED", "false");
    createTextResponseMock.mockReset();
    embeddingsCreateMock.mockReset();
    embeddingsCreateMock.mockResolvedValue({ embeddings: [], raw: {} });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("corrige chutes genéricos da IA para doces industrializados reconhecidos por embalagem", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_branded_snacks",
      outputText: JSON.stringify({
        mealLabel: "Jantar",
        confidence: 0.86,
        reasoning: "Embalagens de Kit Kat e Smash visíveis, mas sem tabela nutricional legível.",
        items: [
          {
            foodName: "Kit Kat",
            quantity: 1,
            unit: "unidade",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 0,
            estimatedCalories: 100,
            estimatedMacros: { protein: 1, carbs: 11, fat: 5 },
            confidence: 0.82,
            foodClassification: { processingLevel: "processed", isFruit: false, isVegetable: false, fiberGrams: 0 },
          },
          {
            foodName: "Smash",
            quantity: 1,
            unit: "unidade",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 0,
            estimatedCalories: 100,
            estimatedMacros: { protein: 1, carbs: 10, fat: 6 },
            confidence: 0.78,
            foodClassification: { processingLevel: "processed", isFruit: false, isVegetable: false, fiberGrams: 0 },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,Zm90by1raXRrYXQtc21hc2g=",
      occurredAt: "2026-06-20T20:10:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ foodName: "Kit Kat", canonicalName: "Kit Kat ao Leite Nestlé", brand: "Nestlé", calories: 220, protein: 3.3, carbs: 24, fat: 12, source: "catalog" }),
      expect.objectContaining({ foodName: "Smash", canonicalName: "Smash Original Nestlé", brand: "Nestlé", calories: 95, protein: 0.7, carbs: 14, fat: 4, source: "catalog" }),
    ]));
    expect(result.totals).toEqual({ calories: 315, protein: 4, carbs: 38, fat: 16 });
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });

  it("busca na internet a nutrição específica do produto embalado antes de usar fallback médio", async () => {
    createTextResponseMock
      .mockResolvedValueOnce({
        id: "resp_unknown_packaged_chocolate",
        outputText: JSON.stringify({
          mealLabel: "Lanche",
          confidence: 0.8,
          reasoning: "Embalagem Trento Chocolate Branco Dark 32 g identificada, mas sem tabela nutricional legível.",
          items: [{ foodName: "Trento Chocolate Branco Dark 32 g", quantity: 1, unit: "unidade", portionText: "1 unidade", servings: 1, estimatedGrams: 0, estimatedCalories: 100, estimatedMacros: { protein: 1, carbs: 11, fat: 5 }, confidence: 0.76, foodClassification: { processingLevel: "processed", isFruit: false, isVegetable: false, fiberGrams: 0 } }],
        }),
        raw: { mocked: true },
      })
      .mockResolvedValueOnce({
        id: "resp_web_nutrition_lookup",
        outputText: JSON.stringify({
          found: true,
          matchedProductName: "Trento Chocolate Branco Dark 32 g",
          brandName: "Peccin",
          servingLabel: "1 unidade 32 g",
          gramsPerServing: 32,
          calories: 128,
          protein: 2.1,
          carbs: 19,
          fat: 5.2,
          confidence: 0.86,
          sourceUrl: "https://example.test/trento-nutrition",
          evidence: "Fonte informa 128 kcal por unidade de 32 g, proteína 2,1 g, carboidratos 19 g e gordura 5,2 g.",
        }),
        webSearch: {
          executed: true,
          sources: [{ url: "https://example.test/trento-nutrition", supportingText: ["Fonte informa 128 kcal por unidade de 32 g, proteína 2,1 g, carboidratos 19 g e gordura 5,2 g."] }],
        },
        raw: { mocked: true },
      });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,Zm90by10cmVudG8=", occurredAt: "2026-06-20T16:10:00-03:00", timeZone: "America/Sao_Paulo" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ foodName: "Trento Chocolate Branco Dark", canonicalName: "Trento Chocolate Branco Dark 32 G", brand: "Peccin", calories: 128, protein: 2.1, carbs: 19, fat: 5.2, source: "catalog" }));
    expect(result.items[0].calories).not.toBe(100);
    expect(result.items[0].calories).not.toBe(212);
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(createTextResponseMock).toHaveBeenLastCalledWith(expect.objectContaining({ tools: [expect.objectContaining({ type: "web_search" })] }));
  });

  it("usa busca semântica local antes do fallback médio quando a busca web não encontra nutrição confiável", async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const catalog = getCatalogCache();
    const targetIndex = catalog.findIndex(food => food.slug === "kitkat-ao-leite-nestle");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    embeddingsCreateMock.mockImplementation(async (request: { input: string[] }) => ({
      embeddings: request.input.length > 1
        ? catalog.map((_, index) => (index === targetIndex ? [1, 0] : [0, 1]))
        : [[1, 0]],
      raw: {},
    }));
    createTextResponseMock
      .mockResolvedValueOnce({ id: "resp_unknown_packaged_chocolate", outputText: JSON.stringify({ mealLabel: "Lanche", confidence: 0.8, reasoning: "Embalagem de Alpino visível, mas sem tabela nutricional legível.", items: [{ foodName: "Alpino", quantity: 1, unit: "unidade", portionText: "1 unidade", servings: 1, estimatedGrams: 0, estimatedCalories: 100, estimatedMacros: { protein: 1, carbs: 11, fat: 5 }, confidence: 0.76, foodClassification: { processingLevel: "processed", isFruit: false, isVegetable: false, fiberGrams: 0 } }] }), raw: { mocked: true } })
      .mockResolvedValueOnce({ id: "resp_web_nutrition_lookup_empty", outputText: JSON.stringify({ found: false, matchedProductName: "", brandName: "", servingLabel: "", gramsPerServing: 0, calories: 0, protein: 0, carbs: 0, fat: 0, confidence: 0.2, sourceUrl: "", evidence: "Nenhuma fonte específica confiável encontrada." }), raw: { mocked: true } });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,Zm90by1hbHBpbm8=", occurredAt: "2026-06-20T16:10:00-03:00", timeZone: "America/Sao_Paulo" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Alpino",
      canonicalName: "Kit Kat ao Leite Nestlé",
      calories: 220,
      source: "catalog",
    }));
    expect(result.items[0].calories).not.toBe(100);
    expect(result.items[0].calories).not.toBe(212);
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(2);
  });

  it("usa NUTRITION_SEARCH uma única vez para produto industrializado com marca antes do genérico", async () => {
    createTextResponseMock
      .mockResolvedValueOnce({
        id: "resp_branded_beverage",
        outputText: JSON.stringify({
          mealLabel: "Jantar",
          confidence: 0.91,
          reasoning: "Rótulo comercial legível, sem tabela nutricional visível.",
          items: [{
            foodName: "cerveja lager original",
            brand: "Cervejaria Horizonte",
            quantity: 1,
            unit: "garrafa",
            portionText: "1 garrafa (330 ml)",
            servings: 1,
            estimatedGrams: 330,
            estimatedCalories: 135,
            estimatedMacros: { protein: 1, carbs: 10, fat: 0 },
            confidence: 0.88,
            foodClassification: { processingLevel: "ultra_processed", isFruit: false, isVegetable: false, fiberGrams: 0, isPlainWater: false },
          }],
        }),
        raw: { mocked: true },
      })
      .mockResolvedValueOnce({
        id: "resp_branded_beverage_source",
        outputText: JSON.stringify({
          found: true,
          matchedProductName: "Cerveja Lager Original Cervejaria Horizonte 330 ml",
          brandName: "Cervejaria Horizonte",
          servingLabel: "1 garrafa (330 ml)",
          gramsPerServing: 330,
          calories: 122,
          protein: 1.2,
          carbs: 9.4,
          fat: 0,
          confidence: 0.91,
          sourceUrl: "https://example.test/horizonte-original-330",
          evidence: "A garrafa de 330 ml contém 122 kcal, proteínas 1,2 g, carboidratos 9,4 g e gorduras totais 0 g.",
        }),
        webSearch: {
          executed: true,
          sources: [{
            url: "https://example.test/horizonte-original-330",
            supportingText: ["A garrafa de 330 ml contém 122 kcal, proteínas 1,2 g, carboidratos 9,4 g e gorduras totais 0 g."],
          }],
        },
        raw: { mocked: true },
      });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aG9yaXpvbnRl" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Cerveja Lager Original Cervejaria Horizonte",
      canonicalName: "Cerveja Lager Original Cervejaria Horizonte 330 Ml",
      brand: "Cervejaria Horizonte",
      calories: 122,
      carbs: 9.4,
      source: "catalog",
    }));
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(createTextResponseMock).toHaveBeenLastCalledWith(expect.objectContaining({
      tools: [{ type: "web_search" }],
    }));
  });

  it("rejeita fonte externa de outra marca e mantém a identidade reconhecida no fallback", async () => {
    createTextResponseMock
      .mockResolvedValueOnce({
        id: "resp_branded_beverage_mismatch",
        outputText: JSON.stringify({
          mealLabel: "Jantar",
          confidence: 0.89,
          reasoning: "Rótulo comercial legível, sem tabela nutricional visível.",
          items: [{
            foodName: "cerveja weissbier",
            brand: "Cervejaria Aurora",
            quantity: 1,
            unit: "garrafa",
            portionText: "1 garrafa (500 ml)",
            servings: 1,
            estimatedGrams: 500,
            estimatedCalories: 230,
            estimatedMacros: { protein: 2, carbs: 18, fat: 0 },
            confidence: 0.84,
            foodClassification: { processingLevel: "ultra_processed", isFruit: false, isVegetable: false, fiberGrams: 0, isPlainWater: false },
          }],
        }),
        raw: { mocked: true },
      })
      .mockResolvedValueOnce({
        id: "resp_branded_beverage_wrong_brand",
        outputText: JSON.stringify({
          found: true,
          matchedProductName: "Cerveja Weissbier Outra Marca 500 ml",
          brandName: "Outra Marca",
          servingLabel: "1 garrafa (500 ml)",
          gramsPerServing: 500,
          calories: 190,
          protein: 1,
          carbs: 14,
          fat: 0,
          confidence: 0.95,
          sourceUrl: "https://example.test/outra-marca-weissbier",
          evidence: "A garrafa de 500 ml contém 190 kcal, proteínas 1 g, carboidratos 14 g e gorduras totais 0 g.",
        }),
        webSearch: {
          executed: true,
          sources: [{
            url: "https://example.test/outra-marca-weissbier",
            supportingText: ["A garrafa de 500 ml contém 190 kcal, proteínas 1 g, carboidratos 14 g e gorduras totais 0 g."],
          }],
        },
        raw: { mocked: true },
      });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,YXVyb3Jh" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Cerveja Weissbier Cervejaria Aurora",
      brand: "Cervejaria Aurora",
    }));
    expect(result.items[0].canonicalName).not.toContain("Outra Marca");
    expect(result.items[0].calories).not.toBe(190);
    expect(result.items[0].source).not.toBe("catalog");
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
  });
});
