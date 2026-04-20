import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeLLMMock = vi.fn();

vi.mock("./_core/llm", () => ({
  invokeLLM: invokeLLMMock,
}));

describe("nutritionEngine.processMealInput", () => {
  beforeEach(() => {
    invokeLLMMock.mockReset();
  });

  it("converte a resposta estruturada da IA em itens com cálculo determinístico de macros", async () => {
    invokeLLMMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              mealLabel: "Almoço",
              confidence: 0.91,
              reasoning: "Itens identificados com boa visibilidade.",
              items: [
                {
                  foodName: "arroz",
                  portionText: "1 porção",
                  servings: 1,
                  estimatedGrams: 100,
                  confidence: 0.95,
                },
                {
                  foodName: "frango grelhado",
                  portionText: "150 g",
                  servings: 1.5,
                  estimatedGrams: 150,
                  confidence: 0.89,
                },
              ],
            }),
          },
        },
      ],
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "almoço com arroz e frango grelhado",
    });

    expect(result.detectedMealLabel).toBe("Almoço");
    expect(result.items).toHaveLength(2);
    expect(result.totals.calories).toBe(377.5);
    expect(result.totals.protein).toBe(49.2);
    expect(result.items[0]?.canonicalName).toBe("Arroz branco cozido");
    expect(result.items[1]?.canonicalName).toBe("Frango grelhado");
  });

  it("usa fallback heurístico quando a IA falha", async () => {
    invokeLLMMock.mockRejectedValue(new Error("LLM indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "banana e whey",
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.needsConfirmation).toBe(true);
    expect(result.totals.calories).toBeGreaterThan(0);
    expect(result.reasoning).toContain("heurística");
  });
});
