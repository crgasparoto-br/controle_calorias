import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createTextResponseMock,
  findCatalogFoodSemanticMock,
  logMealInferenceFallbackMock,
} = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  findCatalogFoodSemanticMock: vi.fn(async () => null),
  logMealInferenceFallbackMock: vi.fn(),
}));

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
vi.mock("./mealInferenceFallbackTelemetry", () => ({
  logMealInferenceFallback: (...args: unknown[]) => logMealInferenceFallbackMock(...args),
}));

const { processMealInput } = await import("./nutritionEngine");
const { findTacoFood } = await import("./tacoLookup");

type TestItem = {
  foodName: string;
  quantity: number;
  unit: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  estimatedCalories: number;
  estimatedMacros: { protein: number; carbs: number; fat: number };
  confidence: number;
  foodClassification: {
    processingLevel: "processed" | "ultra_processed";
    isFruit: false;
    isVegetable: false;
    fiberGrams: number;
  };
  brand?: string | null;
};

function genericItem(foodName: string, grams: number, brand: string | null = null): TestItem {
  return {
    foodName,
    brand,
    quantity: grams,
    unit: "g",
    portionText: `${grams} g`,
    servings: grams / 100,
    estimatedGrams: grams,
    estimatedCalories: 150 * (grams / 100),
    estimatedMacros: {
      protein: 6 * (grams / 100),
      carbs: 15 * (grams / 100),
      fat: 5 * (grams / 100),
    },
    confidence: 0.92,
    foodClassification: {
      processingLevel: "processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
    },
  };
}

function installInference(items: TestItem[]) {
  createTextResponseMock.mockResolvedValue({
    id: "response-issue-1194",
    outputText: JSON.stringify({
      mealLabel: "Café da manhã",
      confidence: 0.95,
      reasoning: "Fixture da regressão do placeholder nutricional.",
      items,
    }),
    raw: {},
  });
}

const TARGET_ITEMS = [
  ["mussarela fatiada", 20],
  ["presunto fatiado", 18],
  ["requeijão", 40],
  ["manteiga com sal", 20],
] as const;

beforeEach(() => {
  createTextResponseMock.mockReset();
  findCatalogFoodSemanticMock.mockReset();
  findCatalogFoodSemanticMock.mockResolvedValue(null);
  logMealInferenceFallbackMock.mockReset();
});

describe("issue #1194 — placeholder nutricional não substitui referências conhecidas", () => {
  it("resolve mussarela, presunto, requeijão e manteiga no caminho textual", async () => {
    installInference(TARGET_ITEMS.map(([name, grams]) => genericItem(name, grams)));

    const result = await processMealInput({
      text: "20 g de mussarela fatiada, 18 g de presunto fatiado, 40 g de requeijão, 20 g de manteiga com sal",
    });

    expect(result.items).toHaveLength(TARGET_ITEMS.length);
    for (const [name, grams] of TARGET_ITEMS) {
      const item = result.items.find(candidate => candidate.foodName.toLowerCase().includes(name.split(" ")[0]));
      const reference = findTacoFood(name);
      expect(reference).toBeDefined();
      expect(item).toEqual(expect.objectContaining({
        source: "catalog",
        estimatedGrams: grams,
        resolution: expect.objectContaining({
          nutritionOrigin: "catalog",
          nutritionVerified: true,
        }),
      }));
      expect(item?.calories).not.toBe(150 * (grams / 100));
      expect([item?.protein, item?.carbs, item?.fat]).not.toEqual([
        6 * (grams / 100),
        15 * (grams / 100),
        5 * (grams / 100),
      ]);
      expect(item?.calories).toBeCloseTo((reference!.calories * grams) / reference!.gramsPerServing, 1);
    }
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });

  it("mantém a mesma resolução no caminho visual", async () => {
    installInference(TARGET_ITEMS.map(([name, grams]) => genericItem(name, grams)));

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1194-known-foods",
    });

    expect(result.items).toHaveLength(TARGET_ITEMS.length);
    expect(result.items.every(item => item.source === "catalog")).toBe(true);
    expect(result.items.map(item => item.resolution?.nutritionOrigin)).toEqual([
      "catalog",
      "catalog",
      "catalog",
      "catalog",
    ]);
    expect(result.items.map(item => item.calories)).not.toEqual([30, 27, 60, 30]);
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });

  it("mantém o fallback explícito para alimento realmente desconhecido", async () => {
    installInference([genericItem("alimento desconhecido xyz", 100)]);

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1194-unknown-food",
    });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expect.stringMatching(/alimento desconhecido xyz/i),
      source: "heuristic",
      calories: 150,
      protein: 6,
      carbs: 15,
      fat: 5,
      resolution: expect.objectContaining({
        nutritionOrigin: "heuristic",
        nutritionVerified: false,
      }),
    }));
    expect(logMealInferenceFallbackMock).toHaveBeenCalledWith("generic_nutrition_fallback", 1);
  });

  it("não transforma placeholder de produto comercial sem fonte em nutrição aceita", async () => {
    installInference([genericItem("Salgadinho MarcaTeste Bacon", 40, "MarcaTeste")]);

    await expect(processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1194-commercial-placeholder",
    })).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        brand: expect.stringMatching(/marcateste/i),
        semanticContract: expect.objectContaining({ needsClarification: true }),
      }),
    });
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });
});
