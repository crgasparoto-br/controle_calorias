import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: findCatalogFoodSemanticMock,
}));

describe("nutritionEngine brand and type specificity", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it("usa marca e tipo do texto original para escolher referencia nutricional especifica", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_generic_cheese",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.9,
        reasoning: "A IA retornou alimento base, mas o texto tem marca e versao.",
        items: [
          {
            foodName: "queijo",
            brand: "Polenghi",
            portionText: "20 g",
            servings: 1,
            estimatedGrams: 20,
            estimatedCalories: 0,
            estimatedMacros: {
              protein: 0,
              carbs: 0,
              fat: 0,
            },
            confidence: 0.84,
            foodClassification: {
              processingLevel: "ultra_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 0,
            },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "20g queijo polenghi light",
      occurredAt: "2026-07-08T10:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Queijo Polenghi Light",
      canonicalName: "Queijo Polenghi Light",
      brand: "Polenghi",
      calories: 44,
      protein: 3.6,
      carbs: 1.2,
      fat: 2.8,
      source: "catalog",
    }));
  });

  it("preserva marca e qualificador textual quando precisa cair em fallback menos especifico", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_requeijao_generic",
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.86,
        reasoning: "Referencia estimada porque nao ha catalogo especifico disponivel no teste.",
        items: [
          {
            foodName: "requeijão",
            brand: "Catupiry",
            portionText: "61 g",
            servings: 1,
            estimatedGrams: 61,
            estimatedCalories: 110,
            estimatedMacros: {
              protein: 5,
              carbs: 3,
              fat: 8,
            },
            confidence: 0.82,
            foodClassification: {
              processingLevel: "ultra_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 0,
            },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "61g requeijão catupiry light",
      occurredAt: "2026-07-08T07:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Requeijão Catupiry Light",
      canonicalName: "Requeijão",
      brand: "Catupiry",
      calories: 110,
      protein: 5,
      carbs: 3,
      fat: 8,
      source: "hybrid",
    }));
  });

  it("mantem registro simples sem complemento funcionando", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_simple_requeijao",
      outputText: JSON.stringify({
        mealLabel: "Café da manhã",
        confidence: 0.83,
        reasoning: "Registro simples sem marca ou tipo.",
        items: [
          {
            foodName: "requeijão",
            portionText: "61 g",
            servings: 1,
            estimatedGrams: 61,
            estimatedCalories: 110,
            estimatedMacros: {
              protein: 5,
              carbs: 3,
              fat: 8,
            },
            confidence: 0.8,
            foodClassification: {
              processingLevel: "ultra_processed",
              isFruit: false,
              isVegetable: false,
              fiberGrams: 0,
            },
          },
        ],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "61g requeijão",
      occurredAt: "2026-07-08T07:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].foodName).toBe("Requeijão");
    expect(result.items[0].brand).toBeNull();
  });
});
