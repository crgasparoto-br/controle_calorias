import { beforeEach, describe, expect, it, vi } from "vitest";

import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";

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
vi.mock("./tacoLookup", () => ({
  findTacoFood: vi.fn(() => undefined),
}));

function mockNutritionlessInference(foodName: string) {
  createTextResponseMock.mockResolvedValue({
    id: "resp_zero_beverage_semantic_guard",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.8,
      reasoning: "Item identificado sem nutrição utilizável.",
      items: [{
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
      }],
    }),
    raw: { mocked: true },
  });
}

function zeroCatalog(name: string, aliases: string[] = []) {
  return {
    slug: "zero-semantic-candidate",
    name,
    aliases,
    servingLabel: "100 ml",
    gramsPerServing: 100,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
  };
}

describe("semantic compatibility for zero beverages", () => {
  beforeEach(() => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(undefined);
  });

  it("keeps zero/diet qualifiers bidirectional even when a generic alias matches", () => {
    expect(isFoodCandidateSemanticallyCompatible(
      "Água Tônica",
      ["Água Tônica Zero Açúcar", "Água Tônica"],
    )).toBe(false);
    expect(isFoodCandidateSemanticallyCompatible(
      "Refrigerante",
      ["Refrigerante Diet", "Refrigerante"],
    )).toBe(false);

    expect(isFoodCandidateSemanticallyCompatible(
      "Refrigerante Zero",
      ["Refrigerante Zero Açúcar"],
    )).toBe(true);
    expect(isFoodCandidateSemanticallyCompatible(
      "Schweppes Zero Tônica",
      ["Schweppes Tônica Zero Açúcar"],
    )).toBe(true);
  });

  it("does not treat zero caffeine or zero lactose as sugar-free markers", () => {
    expect(isFoodCandidateSemanticallyCompatible(
      "Refrigerante Zero Cafeína",
      ["Refrigerante Zero"],
    )).toBe(false);
    expect(isFoodCandidateSemanticallyCompatible(
      "Leite Zero Lactose",
      ["Leite sem açúcar"],
    )).toBe(false);
    expect(isFoodCandidateSemanticallyCompatible(
      "Leite Zero Lactose",
      ["Leite Zero Lactose"],
    )).toBe(true);
  });

  it("rejects a zero semantic catalog candidate for a regular tonic", async () => {
    findCatalogFoodSemanticMock.mockResolvedValue(zeroCatalog(
      "Água Tônica Zero Açúcar",
      ["Água Tônica"],
    ));
    mockNutritionlessInference("Água Tônica");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "350 ml Água Tônica",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({
      calories: 525,
      protein: 21,
      carbs: 52.5,
      fat: 17.5,
      source: "heuristic",
    }));
  });

  it("does not let zero caffeine inherit a zero-sugar semantic candidate", async () => {
    findCatalogFoodSemanticMock.mockResolvedValue(zeroCatalog(
      "Refrigerante Zero Açúcar",
      ["Refrigerante Zero"],
    ));
    mockNutritionlessInference("Refrigerante Zero Cafeína");

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({
      text: "350 ml Refrigerante Zero Cafeína",
      occurredAt: "2026-08-02T16:00:00-03:00",
      timeZone: "America/Sao_Paulo",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].calories).toBeGreaterThan(0);
    expect(result.items[0].source).toBe("heuristic");
  });
});
