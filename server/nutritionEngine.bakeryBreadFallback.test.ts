import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine estimated nutrition fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("estima macros para pão de padaria reconhecido por imagem sem tabela nutricional", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_bakery_bread_zero_macros",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.82,
        reasoning: "Etiqueta identificou Pão da Fazenda, mas não havia tabela nutricional visível.",
        items: [
          {
            foodName: "Pão da Fazenda",
            quantity: 49,
            unit: "g",
            portionText: "49 g",
            servings: 1,
            estimatedGrams: 49,
            estimatedCalories: 0,
            estimatedMacros: {
              protein: 0,
              carbs: 0,
              fat: 0,
            },
            confidence: 0.82,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "49g",
      imageUrl: "data:image/jpeg;base64,cGFvLWRhLWZhemVuZGE=",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Pão da Fazenda",
      canonicalName: "Pão de padaria",
      quantity: 49,
      unit: "g",
      portionText: "49 g",
      estimatedGrams: 49,
      calories: 147,
      protein: 3.92,
      carbs: 27.44,
      fat: 1.96,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({
      calories: 147,
      protein: 3.92,
      carbs: 27.44,
      fat: 1.96,
    });
  });

  it("estima macros genéricos para alimento reconhecido sem tabela nutricional", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_generic_food_zero_macros",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.8,
        reasoning: "Produto alimentício identificado pela embalagem, mas sem tabela nutricional visível.",
        items: [
          {
            foodName: "Bolinho caseiro",
            quantity: 80,
            unit: "g",
            portionText: "80 g",
            servings: 1,
            estimatedGrams: 80,
            estimatedCalories: 0,
            estimatedMacros: {
              protein: 0,
              carbs: 0,
              fat: 0,
            },
            confidence: 0.8,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "80g",
      imageUrl: "data:image/jpeg;base64,Ym9saW5oby1jYXNlaXJv",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Bolinho caseiro",
      canonicalName: "Bolinho caseiro",
      quantity: 80,
      unit: "g",
      portionText: "80 g",
      estimatedGrams: 80,
      calories: 120,
      protein: 4.8,
      carbs: 12,
      fat: 4,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({
      calories: 120,
      protein: 4.8,
      carbs: 12,
      fat: 4,
    });
  });

  it("preserva macros da tabela nutricional quando a IA extrai valores do rótulo", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_bakery_bread_label_macros",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.88,
        reasoning: "Valores extraídos da tabela nutricional visível no rótulo.",
        items: [
          {
            foodName: "Pão da Fazenda",
            quantity: 49,
            unit: "g",
            portionText: "49 g",
            servings: 1,
            estimatedGrams: 49,
            estimatedCalories: 120,
            estimatedMacros: {
              protein: 4,
              carbs: 22,
              fat: 2,
            },
            confidence: 0.88,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "49g",
      imageUrl: "data:image/jpeg;base64,dGFiZWxhLXBhby1kYS1mYXplbmRh",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Pão da Fazenda",
      canonicalName: "Pão da Fazenda",
      calories: 120,
      protein: 4,
      carbs: 22,
      fat: 2,
      source: "hybrid",
    }));
  });
});
