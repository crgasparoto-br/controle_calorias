import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine composite text fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("nao reduz alimento composto com preparo ao ingrediente isolado", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_reduced_preparation",
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.82,
        reasoning: "A IA reduziu a preparação ao ingrediente final.",
        items: [
          {
            foodName: "salsinha",
            portionText: "50 g",
            servings: 1,
            estimatedGrams: 50,
            estimatedCalories: 18,
            estimatedMacros: {
              protein: 1.5,
              carbs: 3,
              fat: 0.4,
            },
            confidence: 0.82,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "50g tahine com salsinha",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "tahine com salsinha",
      portionText: "50 g",
      estimatedGrams: 50,
      source: "heuristic",
    }));
    expect(result.items[0].foodName).not.toBe("salsinha");
    expect(result.reasoning).toContain("descrição completa");
  });

  it("usa fallback textual quando todos os itens da IA sao rejeitados", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_unrelated_item",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.78,
        reasoning: "A IA retornou um item que nao aparece no texto.",
        items: [
          {
            foodName: "whey protein",
            portionText: "1 scoop",
            servings: 1,
            estimatedGrams: 30,
            estimatedCalories: 120,
            estimatedMacros: {
              protein: 24,
              carbs: 3,
              fat: 2,
            },
            confidence: 0.78,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "banana",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].foodName).toBe("banana");
    expect(result.items[0].foodName).not.toBe("whey protein");
    expect(result.reasoning).toContain("heurística");
  });
});
