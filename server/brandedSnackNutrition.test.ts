import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine branded snack photo nutrition", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
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
  });

  it("aplica fallback médio para chocolate embalado ainda não cadastrado", async () => {
    createTextResponseMock.mockResolvedValue({
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
      canonicalName: "Trento (estimativa de chocolate embalado)",
      calories: 212,
      protein: 2.4,
      carbs: 23.2,
      fat: 12.4,
      source: "catalog",
    }));
    expect(result.items[0].calories).not.toBe(100);
  });
});
