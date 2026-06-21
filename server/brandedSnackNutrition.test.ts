import { beforeEach, describe, expect, it, vi } from "vitest";

const { createTextResponseMock, embeddingsCreateMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  embeddingsCreateMock: vi.fn(),
}));

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

vi.mock("./_core/openaiClient", () => ({
  isOpenAiConfigured: () => true,
  createOpenAiClient: () => ({
    embeddings: {
      create: embeddingsCreateMock,
    },
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
    createTextResponseMock.mockReset();
    embeddingsCreateMock.mockReset();
    embeddingsCreateMock.mockResolvedValue({ data: [] });
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
            estimatedMacros: {
              protein: 1,
              carbs: 11,
              fat: 5,
            },
            confidence: 0.82,
          },
          {
            foodName: "Smash",
            quantity: 1,
            unit: "unidade",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 0,
            estimatedCalories: 100,
            estimatedMacros: {
              protein: 1,
              carbs: 10,
              fat: 6,
            },
            confidence: 0.78,
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
      expect.objectContaining({
        foodName: "Kit Kat",
        canonicalName: "Kit Kat ao leite Nestlé",
        brand: "Nestlé",
        calories: 220,
        protein: 3.3,
        carbs: 24,
        fat: 12,
        source: "catalog",
      }),
      expect.objectContaining({
        foodName: "Smash",
        canonicalName: "Smash Original Nestlé",
        brand: "Nestlé",
        calories: 95,
        protein: 0.7,
        carbs: 14,
        fat: 4,
        source: "catalog",
      }),
    ]));
    expect(result.totals).toEqual({
      calories: 315,
      protein: 4,
      carbs: 38,
      fat: 16,
    });
    expect(createTextResponseMock).toHaveBeenCalledTimes(1);
  });

  it("busca na internet a nutrição específica do produto embalado antes de usar fallback médio", async () => {
    createTextResponseMock
      .mockResolvedValueOnce({
        id: "resp_unknown_packaged_chocolate",
        outputText: JSON.stringify({
          mealLabel: "Lanche",
          confidence: 0.8,
          reasoning: "Embalagem de Trento visível, mas sem tabela nutricional legível.",
          items: [
            {
              foodName: "Trento",
              quantity: 1,
              unit: "unidade",
              portionText: "1 unidade",
              servings: 1,
              estimatedGrams: 0,
              estimatedCalories: 100,
              estimatedMacros: {
                protein: 1,
                carbs: 11,
                fat: 5,
              },
              confidence: 0.76,
            },
          ],
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
          evidence: "Fonte informa tabela nutricional por unidade de 32 g.",
        }),
        raw: { mocked: true },
      });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,Zm90by10cmVudG8=",
      occurredAt: "2026-06-20T16:10:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Trento",
      canonicalName: "Trento Chocolate Branco Dark 32 g",
      brand: "Peccin",
      calories: 128,
      protein: 2.1,
      carbs: 19,
      fat: 5.2,
      source: "catalog",
    }));
    expect(result.items[0].calories).not.toBe(100);
    expect(result.items[0].calories).not.toBe(212);
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(createTextResponseMock).toHaveBeenLastCalledWith(expect.objectContaining({
      tools: [expect.objectContaining({ type: "web_search" })],
    }));
  });

  it("usa busca semântica local antes do fallback médio quando a busca web não encontra nutrição confiável", async () => {
    embeddingsCreateMock
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 0] }] })
      .mockResolvedValueOnce({ data: [{ index: 0, embedding: [1, 0] }] });
    createTextResponseMock
      .mockResolvedValueOnce({
        id: "resp_unknown_packaged_chocolate",
        outputText: JSON.stringify({
          mealLabel: "Lanche",
          confidence: 0.8,
          reasoning: "Embalagem de Alpino visível, mas sem tabela nutricional legível.",
          items: [
            {
              foodName: "Alpino",
              quantity: 1,
              unit: "unidade",
              portionText: "1 unidade",
              servings: 1,
              estimatedGrams: 0,
              estimatedCalories: 100,
              estimatedMacros: {
                protein: 1,
                carbs: 11,
                fat: 5,
              },
              confidence: 0.76,
            },
          ],
        }),
        raw: { mocked: true },
      })
      .mockResolvedValueOnce({
        id: "resp_web_nutrition_lookup_empty",
        outputText: JSON.stringify({
          found: false,
          matchedProductName: "",
          brandName: "",
          servingLabel: "",
          gramsPerServing: 0,
          calories: 0,
          protein: 0,
          carbs: 0,
          fat: 0,
          confidence: 0.2,
          sourceUrl: "",
          evidence: "Nenhuma fonte específica confiável encontrada.",
        }),
        raw: { mocked: true },
      });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,Zm90by1hbHBpbm8=",
      occurredAt: "2026-06-20T16:10:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Alpino",
      canonicalName: expect.any(String),
      source: "catalog",
    }));
    expect(result.items[0].calories).not.toBe(100);
    expect(result.items[0].calories).not.toBe(212);
    expect(createTextResponseMock).toHaveBeenCalledTimes(2);
    expect(embeddingsCreateMock).toHaveBeenCalledTimes(2);
  });
});
