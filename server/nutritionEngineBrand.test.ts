import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine branded products", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("preserva marca no meio da frase e prioriza produto exato de marca", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_brand_middle",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.9,
        reasoning: "Produto de marca informado textualmente.",
        items: [
          {
            foodName: "iogurte Nestlé natural",
            quantity: 170,
            unit: "g",
            portionText: "170 g",
            servings: 1,
            estimatedGrams: 170,
            estimatedCalories: 90,
            estimatedMacros: { protein: 5, carbs: 8, fat: 3 },
            confidence: 0.92,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "comi um iogurte Nestlé natural 170g" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "iogurte Nestlé natural",
      canonicalName: "Iogurte natural Nestlé",
      portionText: "170 g",
      estimatedGrams: 170,
      calories: 118,
      source: "catalog",
    }));
  });

  it("diferencia variacao zero da versao tradicional", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_coke_zero",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.88,
        reasoning: "Bebida de marca com variação zero.",
        items: [
          {
            foodName: "Coca-Cola zero lata",
            quantity: 1,
            unit: "lata",
            portionText: "1 lata",
            servings: 1,
            estimatedGrams: 350,
            estimatedCalories: 149,
            estimatedMacros: { protein: 0, carbs: 37, fat: 0 },
            confidence: 0.9,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "Coca-Cola zero lata" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Coca-Cola zero lata",
      calories: 0,
      carbs: 0,
      source: "catalog",
    }));
  });

  it("usa produto de marca no fallback textual quando a IA falha", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "Leite Molico 200ml" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Leite Molico",
      canonicalName: "Leite Molico desnatado",
      portionText: "200 ml",
      estimatedGrams: 200,
      calories: 70,
      source: "catalog",
    }));
  });

  it("mantem alimento sem marca no fluxo generico confiavel", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ text: "200ml leite" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "leite",
      canonicalName: "Leite integral",
      portionText: "200 ml",
      calories: 122,
      source: "catalog",
    }));
  });
});
