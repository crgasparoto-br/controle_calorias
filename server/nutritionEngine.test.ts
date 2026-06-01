import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

describe("nutritionEngine.processMealInput", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
  });

  it("converte a resposta estruturada da OpenAI em itens validados e recalcula os totais no backend", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_1",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.91,
        reasoning: "Itens identificados com boa visibilidade.",
        items: [
          {
            foodName: "arroz",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 9999,
            estimatedMacros: {
              protein: 999,
              carbs: 999,
              fat: 999,
            },
            confidence: 0.95,
          },
          {
            foodName: "molho pesto",
            portionText: "2 colheres de sopa",
            servings: 1,
            estimatedGrams: 30,
            estimatedCalories: 120,
            estimatedMacros: {
              protein: 2,
              carbs: 3,
              fat: 11,
            },
            confidence: 0.72,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "almoço com arroz e molho pesto",
      imageUrl: "https://storage.test/prato.jpg",
    });

    expect(createTextResponseMock).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-4o-mini",
      format: expect.objectContaining({
        type: "json_schema",
        name: "meal_extraction",
      }),
      input: [
        {
          role: "user",
          content: expect.arrayContaining([
            expect.objectContaining({ type: "input_text" }),
            expect.objectContaining({ type: "input_image", image_url: "https://storage.test/prato.jpg" }),
          ]),
        },
      ],
    }));

    expect(result.detectedMealLabel).toBe("Almoço");
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toEqual(expect.objectContaining({
      canonicalName: "Arroz branco cozido",
      calories: 130,
      protein: 2.7,
      carbs: 28,
      fat: 0.3,
      source: "catalog",
    }));
    expect(result.items[1]).toEqual(expect.objectContaining({
      canonicalName: "molho pesto",
      calories: 120,
      protein: 2,
      carbs: 3,
      fat: 11,
      source: "hybrid",
    }));
    expect(result.totals).toEqual({
      calories: 250,
      protein: 4.7,
      carbs: 31,
      fat: 11.3,
    });
  });

  it("usa fallback heurístico quando a OpenAI falha para uma descrição em texto", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "banana e whey",
    });

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.needsConfirmation).toBe(true);
    expect(result.totals.calories).toBeGreaterThan(0);
    expect(result.reasoning).toContain("heurística");
  });

  it("não trata café como café da manhã quando o usuário menciona café como alimento", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "café, banana e whey",
      occurredAt: "2026-06-01T18:20:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.detectedMealLabel).toBe("Pré-treino");
    expect(result.items.length).toBeGreaterThan(0);
  });

  it("prioriza rótulo explícito sobre a sugestão por horário", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "café da manhã com ovos",
      occurredAt: "2026-06-01T18:20:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.detectedMealLabel).toBe("Café da manhã");
  });

  it("não gera rascunho quando a saída da IA é inválida e não há fallback textual", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_invalid",
      outputText: "{\"items\":[]}",
      raw: { mocked: true },
    });

    const { MealInferenceError, processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      imageUrl: "https://storage.test/prato.jpg",
    })).rejects.toBeInstanceOf(MealInferenceError);
  });
});
