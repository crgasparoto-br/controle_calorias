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
  foodClassification?: {
    processingLevel: "natural_or_minimally_processed" | "processed" | "ultra_processed";
    isFruit: boolean;
    isVegetable: boolean;
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

function naturalFruitItem(foodName: string, grams: number): TestItem {
  return {
    ...genericItem(foodName, grams),
    foodClassification: {
      processingLevel: "natural_or_minimally_processed",
      isFruit: true,
      isVegetable: false,
      fiberGrams: 1,
    },
  };
}

function expectScaledNaturalReference(
  item: Awaited<ReturnType<typeof processMealInput>>["items"][number] | undefined,
  baseName: string,
  grams: number,
) {
  const reference = findTacoFood(baseName);
  expect(reference).toBeTruthy();
  expect(item).toEqual(expect.objectContaining({
    source: "catalog",
    estimatedGrams: grams,
    resolution: expect.objectContaining({
      nutritionOrigin: "catalog",
      nutritionVerified: true,
    }),
  }));
  // A assinatura 150/6/15/5 escalada não pode sobreviver como evidência.
  expect([item?.calories, item?.protein, item?.carbs, item?.fat]).not.toEqual([
    1.5 * grams,
    0.06 * grams,
    0.15 * grams,
    0.05 * grams,
  ].map(value => Math.round(value * 10) / 10));
  expect(item?.calories).toBeCloseTo((reference!.calories * grams) / reference!.gramsPerServing, 1);
  expect(item?.protein).toBeCloseTo((reference!.protein * grams) / reference!.gramsPerServing, 1);
}

describe("issue #1194 — cultivar de alimento natural não cai no placeholder", () => {
  it("185g melão dino usa a referência TACO do melão escalada, não 277,5/11,1/27,8/9,3", async () => {
    installInference([naturalFruitItem("Melão Dino", 185)]);

    const result = await processMealInput({ text: "185g melão dino" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0].foodName).toMatch(/mel[aã]o dino/i);
    expect(result.items[0].brand ?? null).toBeNull();
    expectScaledNaturalReference(result.items[0], "melão", 185);
    expect(result.items[0].calories).not.toBe(277.5);
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });

  it("aplica a mesma política quando o extrator não classifica o alimento", async () => {
    const item = genericItem("Melão Dino", 185);
    delete item.foodClassification;
    installInference([item]);

    const result = await processMealInput({ text: "185g melão dino" });

    expectScaledNaturalReference(result.items[0], "melão", 185);
  });

  it("resolve o melão pelo fallback textual quando a IA está indisponível", async () => {
    createTextResponseMock.mockRejectedValue(new Error("provider unavailable"));

    const result = await processMealInput({ text: "185g melão dino" });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toEqual(expect.objectContaining({ source: "catalog", estimatedGrams: 185 }));
    expect(result.items[0].calories).not.toBe(277.5);
    const reference = findTacoFood("melão")!;
    expect(result.items[0].calories).toBeCloseTo((reference.calories * 185) / reference.gramsPerServing, 1);
  });

  it("controle discriminante: abacaxi pérola segue a mesma cadeia sem hardcode", async () => {
    expect(findTacoFood("abacaxi pérola")).toBeNull();
    installInference([naturalFruitItem("Abacaxi Pérola", 220)]);

    const result = await processMealInput({ text: "220 g de abacaxi pérola" });

    expectScaledNaturalReference(result.items[0], "abacaxi", 220);
  });

  it("mantém a mesma resolução no caminho visual", async () => {
    installInference([naturalFruitItem("Melão Dino", 185)]);

    const result = await processMealInput({
      imageUrl: "data:image/jpeg;base64,issue-1194-melao-dino",
    });

    expectScaledNaturalReference(result.items[0], "melão", 185);
  });

  it("classificação explícita de produto processado permanece fail-closed sem macros genéricos", async () => {
    installInference([genericItem("Melão Dino", 185)]);

    await expect(processMealInput({ text: "185g melão dino" })).rejects.toMatchObject({
      code: "food_identity_clarification_required",
    });
    expect(logMealInferenceFallbackMock).not.toHaveBeenCalledWith("generic_nutrition_fallback", expect.anything());
  });
});
