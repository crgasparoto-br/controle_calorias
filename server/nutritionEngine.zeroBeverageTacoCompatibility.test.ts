import { beforeEach, describe, expect, it, vi } from "vitest";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({
    createTextResponse: createTextResponseMock,
  }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));
vi.mock("./catalogMatching", async () => {
  const actual = await vi.importActual<typeof import("./catalogMatching")>("./catalogMatching");
  return {
    ...actual,
    findCatalogFood: vi.fn(() => undefined),
  };
});

function mockSimplifiedZeroNutritionExtraction(foodName: string) {
  createTextResponseMock.mockResolvedValue({
    id: "resp_zero_beverage_simplified",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.84,
      reasoning: "Bebida identificada sem informação nutricional utilizável.",
      items: [
        {
          foodName,
          quantity: 350,
          unit: "ml",
          portionText: "350 ml",
          servings: 1,
          estimatedGrams: 350,
          estimatedCalories: 0,
          estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
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
}

describe("nutritionEngine zero beverage compatibility with real TACO fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it.each([
    ["350 ml Água Tônica Zero Açúcar", "Água Tônica", "Água Tônica Zero Açúcar"],
    ["350 ml Refrigerante Diet", "Refrigerante", "Refrigerante Diet"],
    ["350 ml Schweppes Tônica Zero", "Tônica", "Schweppes Tônica Zero"],
  ])("não deixa TACO regular remover qualificador zero: %s", async (text, aiFoodName, expectedFoodName) => {
    const { findTacoFood } = await import("./tacoLookup");
    const regularTacoCandidate = findTacoFood(aiFoodName);
    expect(regularTacoCandidate?.calories).toBeGreaterThan(0);

    mockSimplifiedZeroNutritionExtraction(aiFoodName);

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expectedFoodName,
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it.each([
    ["Água Tônica Zero Açúcar", "Água Tônica", "Água Tônica Zero Açúcar"],
    ["Refrigerante Diet", "Refrigerante", "Refrigerante Diet"],
    ["Schweppes Tônica Zero", "Tônica", "Schweppes Tônica Zero"],
  ])("preserva qualificador zero quando a IA simplifica nome sem quantidade explícita: %s", async (text, aiFoodName, expectedFoodName) => {
    const { findTacoFood } = await import("./tacoLookup");
    const regularTacoCandidate = findTacoFood(aiFoodName);
    expect(regularTacoCandidate?.calories).toBeGreaterThan(0);

    mockSimplifiedZeroNutritionExtraction(aiFoodName);

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expectedFoodName,
      quantity: 350,
      unit: "ml",
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      source: "heuristic",
    }));
    expect(result.totals).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

// Controles negativos discriminantes: a proteção não pode zerar bebida regular.
describe("nutritionEngine regular beverage compatibility with real TACO fallback", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it.each([
    "350 ml Água Tônica",
    "Água Tônica",
  ])("mantém referência TACO calórica para água tônica sem marcador zero: %s", async text => {
    mockSimplifiedZeroNutritionExtraction("Água Tônica");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text,
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items[0].calories).toBeGreaterThan(0);
    expect(result.items[0].source).toBe("catalog");
    expect(result.totals.calories).toBeGreaterThan(0);
  });
});
