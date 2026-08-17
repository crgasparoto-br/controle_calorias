import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "./nutritionEngineTypes";

const createTextResponseMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();
let catalogFixtures: CatalogFood[] = [];

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({ createTextResponse: createTextResponseMock }),
}));
vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));
vi.mock("./catalogRuntime", () => ({
  getCatalogCache: () => catalogFixtures,
}));
vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) => findCatalogFoodSemanticMock(...args),
}));

function visionResponse(items: Array<Record<string, unknown>>) {
  return {
    id: "resp_issue_987",
    outputText: JSON.stringify({
      mealLabel: "Lanche",
      confidence: 0.92,
      reasoning: "Marca, produto, variante e volume estão legíveis no rótulo.",
      items: items.map(item => ({
        quantity: 330,
        unit: "ml",
        portionText: "1 garrafa (330 ml)",
        servings: 1,
        estimatedGrams: 330,
        estimatedCalories: 0,
        estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
        confidence: 0.9,
        foodClassification: {
          processingLevel: "ultra_processed",
          isFruit: false,
          isVegetable: false,
          fiberGrams: 0,
          isPlainWater: false,
        },
        ...item,
      })),
    }),
    raw: { mocked: true },
  };
}

function brandedBeverage(overrides: Partial<CatalogFood> & Pick<CatalogFood, "slug" | "name" | "brandName">): CatalogFood {
  return {
    aliases: ["cerveja"],
    servingLabel: "330 ml",
    gramsPerServing: 330,
    calories: 100,
    protein: 1,
    carbs: 8,
    fat: 0,
    isBrandedProduct: true,
    ...overrides,
  };
}

describe("issue #987 — identidade comercial no MEAL_VISION", () => {
  beforeEach(() => {
    catalogFixtures = [];
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset();
    findCatalogFoodSemanticMock.mockResolvedValue(null);
    vi.stubEnv("AI_MEAL_VISION_PROVIDER", "openai");
    vi.stubEnv("AI_MEAL_VISION_MODEL", "gpt-4.1-mini");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("seleciona macros distintos para marcas sintéticas da mesma categoria", async () => {
    catalogFixtures = [
      brandedBeverage({ slug: "aurora-lager", name: "Cerveja Aurora Lager", brandName: "Aurora", calories: 118, carbs: 9 }),
      brandedBeverage({ slug: "eclipse-lager", name: "Cerveja Eclipse Lager", brandName: "Eclipse", calories: 142, carbs: 12 }),
    ];
    createTextResponseMock.mockResolvedValue(visionResponse([
      { foodName: "Cerveja Lager", brand: "Aurora" },
      { foodName: "Cerveja Lager", brand: "Eclipse" },
    ]));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(result.items).toEqual([
      expect.objectContaining({ foodName: "Cerveja Lager Aurora", brand: "Aurora", canonicalName: "Cerveja Aurora Lager", calories: 118, carbs: 9, source: "catalog" }),
      expect.objectContaining({ foodName: "Cerveja Lager Eclipse", brand: "Eclipse", canonicalName: "Cerveja Eclipse Lager", calories: 142, carbs: 12, source: "catalog" }),
    ]);
    expect(result.totals.calories).toBe(260);
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
  });

  it.each([
    ["Cerveja", "Stella Artois", "Cerveja Stella Artois"],
    ["Cerveja Original", "Heineken", "Cerveja Original Heineken"],
    ["Cerveja Original", "Antarctica", "Cerveja Original Antarctica"],
    ["Cerveja Weissbier", "Paulaner", "Cerveja Weissbier Paulaner"],
  ])("preserva produto e variante visíveis: %s / %s", async (foodName, brand, expectedName) => {
    createTextResponseMock.mockResolvedValue(visionResponse([{
      foodName,
      brand,
      estimatedCalories: 130,
      estimatedMacros: { protein: 1, carbs: 10, fat: 0 },
    }]));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: expectedName,
      brand,
    }));
  });

  it("não duplica a marca quando ela também veio incorporada em foodName", async () => {
    createTextResponseMock.mockResolvedValue(visionResponse([{
      foodName: "Cerveja Stella Artois",
      brand: "Stella Artois",
      estimatedCalories: 135,
      estimatedMacros: { protein: 1, carbs: 10, fat: 0 },
    }]));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(result.items[0].foodName).toBe("Cerveja Stella Artois");
  });

  it("tenta NUTRITION_SEARCH específico uma vez antes do fallback local", async () => {
    createTextResponseMock.mockResolvedValue(visionResponse([{
      foodName: "Bebida Original",
      brand: "Marca Inédita",
    }]));
    findCatalogFoodSemanticMock.mockResolvedValue(brandedBeverage({
      slug: "marca-inedita-original",
      name: "Bebida Original Marca Inédita",
      brandName: "Marca Inédita",
      calories: 126,
      carbs: 9.5,
    }));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(findCatalogFoodSemanticMock).toHaveBeenCalledTimes(1);
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      expect.stringContaining("Bebida Original Marca Inédita"),
      { searchSpecificProduct: true, skipNutritionSearch: false },
    );
    expect(result.items[0]).toEqual(expect.objectContaining({
      brand: "Marca Inédita",
      calories: 126,
      carbs: 9.5,
      source: "catalog",
    }));
  });

  it("preserva identidade e marca origem heurística quando nenhuma fonte é confiável", async () => {
    createTextResponseMock.mockResolvedValue(visionResponse([{
      foodName: "Bebida Light",
      brand: "Marca Inédita",
    }]));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Bebida Light Marca Inédita",
      brand: "Marca Inédita",
      source: "heuristic",
      confidence: expect.any(Number),
    }));
    expect(result.items[0].confidence).toBeLessThanOrEqual(0.62);
    expect(findCatalogFoodSemanticMock.mock.calls.filter(([, options]) => (
      (options as { skipNutritionSearch?: boolean }).skipNutritionSearch === false
    ))).toHaveLength(1);
    expect(findCatalogFoodSemanticMock.mock.calls.slice(1).every(([, options]) => (
      (options as { skipNutritionSearch?: boolean }).skipNutritionSearch === true
    ))).toBe(true);
  });

  it("não inventa marca para rótulo visualmente ambíguo", async () => {
    createTextResponseMock.mockResolvedValue(visionResponse([{
      foodName: "Cerveja Lager",
      brand: null,
      estimatedCalories: 130,
      estimatedMacros: { protein: 1, carbs: 10, fat: 0 },
    }]));

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aW1hZ2Vt" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      foodName: "Cerveja Lager",
      brand: null,
    }));
  });
});
