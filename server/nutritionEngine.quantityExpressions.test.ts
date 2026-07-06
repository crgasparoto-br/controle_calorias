import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine quantity expressions", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("calcula expressão matemática no fallback heurístico", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "300g/2+20g de banana",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "banana",
      quantity: 170,
      unit: "g",
      portionText: "170 g",
      estimatedGrams: 170,
    }));
    expect(result.sourceText).toBe("300g/2+20g de banana");
  });

  it("reaplica quantidade explícita calculada quando a IA retorna item único", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_quantity_expression",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.86,
        reasoning: "Quantidade com multiplicação informada no texto.",
        items: [
          {
            foodName: "laranja pêra",
            portionText: "176 g",
            servings: 1.76,
            estimatedGrams: 176,
            estimatedCalories: 80,
            estimatedMacros: {
              protein: 1.6,
              carbs: 19,
              fat: 0.2,
            },
            confidence: 0.8,
            foodClassification: { processingLevel: "natural_or_minimally_processed", isFruit: true, isVegetable: false, fiberGrams: 4 },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "2x176g de laranja pêra",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "laranja pêra",
      quantity: 352,
      unit: "g",
      portionText: "352 g",
      estimatedGrams: 352,
    }));
    expect(result.items[0].calories).toBeGreaterThan(80);
  });

  it.each([
    ["300g/0 de banana", "divisão por zero"],
    ["100g-100g de banana", "zero ou negativo"],
    ["100g+20ml de banana", "unidades diferentes"],
  ])("rejeita %s antes de chamar a IA", async (text, expectedMessage) => {
    const { processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({ text })).rejects.toThrow(expectedMessage);
    expect(createTextResponseMock).not.toHaveBeenCalled();
  });
});
