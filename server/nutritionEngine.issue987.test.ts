import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogFood } from "./nutritionEngineTypes";

const { createTextResponseMock, findCatalogFoodSemanticMock } = vi.hoisted(() => ({
  createTextResponseMock: vi.fn(),
  findCatalogFoodSemanticMock: vi.fn(),
}));

vi.mock("./_core/aiProvider", () => ({
  getAiProvider: () => ({ createTextResponse: createTextResponseMock }),
}));

vi.mock("./_core/ai/providerResolver", () => ({
  getAiProviderById: () => ({
    createTextResponse: (request: unknown) => createTextResponseMock(request),
  }),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: findCatalogFoodSemanticMock,
}));

const brandedFixtures: CatalogFood[] = [
  {
    slug: "issue987-serra-norte-lager-original",
    name: "Bebida Lager Original Serra Norte",
    aliases: ["bebida lager original"],
    variants: ["Original", "Lager"],
    servingLabel: "330 ml",
    gramsPerServing: 330,
    calories: 111,
    protein: 1,
    carbs: 8,
    fat: 0,
    brandName: "Serra Norte",
    isBrandedProduct: true,
  },
  {
    slug: "issue987-vale-azul-lager-original",
    name: "Bebida Lager Original Vale Azul",
    aliases: ["bebida lager original"],
    variants: ["Original", "Lager"],
    servingLabel: "330 ml",
    gramsPerServing: 330,
    calories: 149,
    protein: 2,
    carbs: 13,
    fat: 0,
    brandName: "Vale Azul",
    isBrandedProduct: true,
  },
];

function extractionItem(brand: string) {
  return {
    foodName: "bebida lager original",
    brand,
    quantity: 1,
    unit: "garrafa",
    portionText: "1 garrafa (330 ml)",
    servings: 1,
    estimatedGrams: 330,
    estimatedCalories: 130,
    estimatedMacros: { protein: 1, carbs: 10, fat: 0 },
    confidence: 0.9,
    foodClassification: {
      processingLevel: "ultra_processed",
      isFruit: false,
      isVegetable: false,
      fiberGrams: 0,
      isPlainWater: false,
    },
  };
}

describe("nutritionEngine issue #987 commercial identity", () => {
  beforeEach(async () => {
    createTextResponseMock.mockReset();
    findCatalogFoodSemanticMock.mockReset().mockResolvedValue(null);
    const { getCatalogCache } = await import("./catalogRuntime");
    getCatalogCache().push(...brandedFixtures);
  });

  afterEach(async () => {
    const { getCatalogCache } = await import("./catalogRuntime");
    const fixtureSlugs = new Set(brandedFixtures.map(item => item.slug));
    const catalog = getCatalogCache();
    for (let index = catalog.length - 1; index >= 0; index -= 1) {
      if (fixtureSlugs.has(catalog[index].slug)) catalog.splice(index, 1);
    }
  });

  it("seleciona macros distintos por marca sem lista fixa e preserva a identidade exibida", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_issue987_two_brands",
      outputText: JSON.stringify({
        mealLabel: "Jantar",
        confidence: 0.92,
        reasoning: "Duas embalagens com marca e versão legíveis.",
        items: [extractionItem("Serra Norte"), extractionItem("Vale Azul")],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aXNzdWU5ODc=" });

    expect(result.items).toEqual([
      expect.objectContaining({
        foodName: "Bebida Lager Original Serra Norte",
        canonicalName: "Bebida Lager Original Serra Norte",
        brand: "Serra Norte",
        calories: 111,
        carbs: 8,
        source: "catalog",
      }),
      expect.objectContaining({
        foodName: "Bebida Lager Original Vale Azul",
        canonicalName: "Bebida Lager Original Vale Azul",
        brand: "Vale Azul",
        calories: 149,
        carbs: 13,
        source: "catalog",
      }),
    ]);
    expect(result.totals).toEqual({ calories: 260, protein: 3, carbs: 21, fat: 0 });
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalled();
  });

  it("não duplica a marca quando MEAL_VISION também a inclui no nome do produto", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_issue987_no_duplicate",
      outputText: JSON.stringify({
        mealLabel: "Jantar",
        confidence: 0.9,
        reasoning: "Marca legível.",
        items: [{ ...extractionItem("Serra Norte"), foodName: "bebida lager original Serra Norte" }],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,aXNzdWU5ODctZHVw" });

    expect(result.items[0].foodName).toBe("Bebida Lager Original Serra Norte");
    expect(result.items[0].foodName.match(/Serra Norte/giu)).toHaveLength(1);
  });

  it("não promove água pura com marca para a busca nutricional específica", async () => {
    createTextResponseMock.mockResolvedValue({
      id: "resp_issue987_branded_water",
      outputText: JSON.stringify({
        mealLabel: "Lanche",
        confidence: 0.95,
        reasoning: "Água mineral pura em embalagem identificada.",
        items: [{
          ...extractionItem("Fonte Clara"),
          foodName: "água mineral com gás",
          portionText: "1 garrafa (500 ml)",
          estimatedGrams: 500,
          estimatedCalories: 0,
          estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
          foodClassification: {
            processingLevel: "natural_or_minimally_processed",
            isFruit: false,
            isVegetable: false,
            fiberGrams: 0,
            isPlainWater: true,
          },
        }],
      }),
      raw: { mocked: true },
    });

    const { processMealInput } = await import("./nutritionEngine");
    const result = await processMealInput({ imageUrl: "data:image/jpeg;base64,YWd1YS1wdXJh" });

    expect(result.items[0]).toEqual(expect.objectContaining({
      brand: "Fonte Clara",
      classification: expect.objectContaining({ isPlainWater: true }),
    }));
    expect(findCatalogFoodSemanticMock).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ allowSpecificNutritionSearch: true }),
    );
  });
});
