import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine product name preservation", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("preserva nome especifico informado quando a IA retorna referencia generica", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_generic_chocolate",
      outputText: JSON.stringify({
        mealLabel: "Jantar",
        confidence: 0.86,
        reasoning: "Referência nutricional genérica para chocolate.",
        items: [
          {
            foodName: "chocolate",
            portionText: "15 g",
            servings: 1,
            estimatedGrams: 15,
            estimatedCalories: 80,
            estimatedMacros: {
              protein: 1,
              carbs: 10,
              fat: 4,
            },
            confidence: 0.82,
            foodClassification: {
              processingLevel: "processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 1,
            },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "15g sleepy koala chocolate",
    });

    expect(result.detectedMealLabel).toBe("Jantar");
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Sleepy Koala Chocolate",
      canonicalName: expect.stringContaining("Chocolate"),
      portionText: "15 g",
      estimatedGrams: 15,
    }));
  });
});
