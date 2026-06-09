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
      model: "gpt-4.1-mini",
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

  it("mantém todos os alimentos retornados pela IA em listas longas", async () => {
    const items = Array.from({ length: 11 }, (_, index) => ({
      foodName: `alimento ${index + 1}`,
      portionText: "1 porção",
      servings: 1,
      estimatedGrams: 100,
      estimatedCalories: 100 + index,
      estimatedMacros: {
        protein: 5,
        carbs: 12,
        fat: 3,
      },
      confidence: 0.8,
    }));

    createTextResponseMock.mockResolvedValue({
      id: "resp_many_items",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.88,
        reasoning: "Lista longa informada pelo usuário.",
        items,
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: items.map(item => item.foodName).join(", "),
    });

    const request = createTextResponseMock.mock.calls[0][0];
    expect(request.format.schema.properties.items.maxItems).toBeUndefined();
    expect(result.items).toHaveLength(11);
    expect(result.items.map(item => item.foodName)).toContain("alimento 11");
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

  it("interpreta gramas e nome do alimento no fallback textual", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "140g Carne moída suína 🥩",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Carne moída suína",
      portionText: "140 g",
      estimatedGrams: 140,
    }));
    // Com a TACO integrada, a carne moída pode ser resolvida via catálogo TACO
    // (source: "catalog") ou via heurística (source: "hybrid") dependendo do match.
    // O importante é que o item seja reconhecido com os dados corretos de porção.
    expect(["catalog", "hybrid"]).toContain(result.items[0].source);
  });

  it("normaliza nome e gramas quando a IA devolve quantidade junto do foodName", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_grams_in_name",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.82,
        reasoning: "Quantidade veio colada no nome.",
        items: [
          {
            foodName: "140g Carne moída suína 🥩",
            portionText: "1 porção",
            servings: 1,
            estimatedGrams: 0,
            estimatedCalories: 210,
            estimatedMacros: {
              protein: 20,
              carbs: 0,
              fat: 14,
            },
            confidence: 0.75,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "140g Carne moída suína 🥩",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Carne moída suína",
      portionText: "140 g",
      estimatedGrams: 140,
    }));
    // Com a TACO integrada, a carne moída pode ser resolvida via catálogo TACO
    // (source: "catalog") ou via heurística (source: "hybrid") dependendo do match.
    expect(["catalog", "hybrid"]).toContain(result.items[0].source);
  });

  it("remove alimentos inventados pela IA que não aparecem na mensagem textual", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_extra_habit_food",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.84,
        reasoning: "Misturou item informado com hábito do usuário.",
        items: [
          {
            foodName: "banana",
            portionText: "1 unidade",
            servings: 1,
            estimatedGrams: 80,
            estimatedCalories: 72,
            estimatedMacros: {
              protein: 0.9,
              carbs: 18.6,
              fat: 0.2,
            },
            confidence: 0.9,
          },
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
            confidence: 0.72,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "banana",
      habits: [
        {
          foodName: "whey protein",
          occurrenceCount: 12,
        },
      ],
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].foodName).toBe("banana");
  });

  it("mantém alimento textual quando a IA usa o nome canônico do catálogo", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_catalog_name",
      outputText: JSON.stringify({
        mealLabel: "Almoço",
        confidence: 0.84,
        reasoning: "Item informado normalizado para nome canônico.",
        items: [
          {
            foodName: "Arroz branco cozido",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 130,
            estimatedMacros: {
              protein: 2.7,
              carbs: 28,
              fat: 0.3,
            },
            confidence: 0.9,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "arroz",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Arroz branco cozido",
      canonicalName: "Arroz branco cozido",
    }));
  });

  it("usa tabela nutricional da imagem e quantidade exata informada no WhatsApp", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_label_table",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.89,
        reasoning: "Valores extraídos da tabela nutricional visível no rótulo.",
        items: [
          {
            foodName: "banana",
            portionText: "100 g",
            servings: 1,
            estimatedGrams: 100,
            estimatedCalories: 400,
            estimatedMacros: {
              protein: 20,
              carbs: 60,
              fat: 10,
            },
            confidence: 0.88,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "registrar 47g desse alimento",
      imageUrl: "data:image/jpeg;base64,tabela-nutricional",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "banana",
      canonicalName: "banana",
      portionText: "47 g",
      estimatedGrams: 47,
      calories: 188,
      protein: 9.4,
      carbs: 28.2,
      fat: 4.7,
      source: "hybrid",
    }));
    expect(result.totals).toEqual({
      calories: 188,
      protein: 9.4,
      carbs: 28.2,
      fat: 4.7,
    });
  });

  it("inclui no prompt regras para priorizar rótulo de embalagem e evitar fallback indevido para água", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_label_identity",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.87,
        reasoning: "Rótulo legível identificado na embalagem.",
        items: [
          {
            foodName: "pão de cenoura",
            portionText: "80 g",
            servings: 1,
            estimatedGrams: 80,
            estimatedCalories: 250,
            estimatedMacros: {
              protein: 5,
              carbs: 40,
              fat: 7,
            },
            confidence: 0.84,
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,ZmFrZS1wYWNhZ2luZw==",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "pão de cenoura",
    }));

    const request = createTextResponseMock.mock.calls[0][0];
    const textInput = request.input[0].content.find((item: { type: string }) => item.type === "input_text");

    expect(textInput?.text).toContain("Quando houver texto legível em embalagem, rótulo, etiqueta de preço ou etiqueta de balança com nome de alimento, use esse texto como identidade principal do item em foodName.");
    expect(textInput?.text).toContain("se o rótulo legível indicar 'PÃO DE CENOURA'");
    expect(textInput?.text).toContain("Nunca transforme lista de ingredientes em itens separados da refeição");
    expect(textInput?.text).toContain("Se houver peso líquido, peso drenado, peso na etiqueta da balança ou porção declarada visível");
    expect(textInput?.text).toContain("não use água como fallback apenas por transparência, brilho, reflexo ou plástico translúcido");
  });

  it("não limita o fallback heurístico a 8 alimentos", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider indisponível"));

    const foods = Array.from({ length: 11 }, (_, index) => `alimento ${index + 1}`);
    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: foods.join(", "),
    });

    expect(result.items).toHaveLength(11);
    expect(result.items.map(item => item.foodName)).toContain("alimento 11");
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

  it("não gera rascunho quando a IA informa que não há item confiável na imagem", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_empty_items",
      outputText: JSON.stringify({
        mealLabel: "Refeição registrada",
        confidence: 0.12,
        reasoning: "A imagem não mostra alimento consumível com segurança suficiente.",
        items: [],
      }),
      raw: { mocked: true },
    });

    const { MealInferenceError, processMealInput } = await import("./nutritionEngine");

    await expect(processMealInput({
      imageUrl: "https://storage.test/foto-sem-alimento-confiavel.jpg",
    })).rejects.toBeInstanceOf(MealInferenceError);

    const request = createTextResponseMock.mock.calls[0][0];
    expect(request.format.schema.properties.items.minItems).toBe(0);
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
