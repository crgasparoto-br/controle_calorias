import { beforeEach, describe, expect, it, vi } from "vitest";

const extractWithAiMock = vi.fn();
const findCatalogFoodMock = vi.fn();
const findCatalogFoodSemanticMock = vi.fn();

vi.mock("./mealAiExtraction", () => ({
  extractWithAi: (...args: unknown[]) => extractWithAiMock(...args),
}));

vi.mock("./catalogMatching", async importOriginal => {
  const actual = await importOriginal<typeof import("./catalogMatching")>();
  return {
    ...actual,
    findCatalogFood: (...args: unknown[]) => findCatalogFoodMock(...args),
  };
});

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: (...args: unknown[]) =>
    findCatalogFoodSemanticMock(...args),
}));

vi.mock("./tacoLookup", () => ({
  findTacoFood: vi.fn(() => undefined),
}));

const { processMealInput } = await import("./nutritionEngine");

const cachedFood = {
  slug: "web-nutrition-panco-premium",
  name: "Pão de Forma Panco Premium",
  aliases: ["Panco Premium"],
  servingLabel: "2 fatias (50 g)",
  gramsPerServing: 50,
  calories: 125,
  protein: 3.9,
  carbs: 24,
  fat: 1.5,
  brandName: "Panco",
  productVariant: "premium",
  variants: ["Pão de Forma Panco Premium"],
  sourceUrls: ["https://panco.example/premium"],
  sourceEvidence: "2 fatias (50 g): 125 kcal.",
  sourceVerifiedAt: new Date(),
  sourceConfidence: 0.95,
  isBrandedProduct: true,
};

const extraction = {
  mealLabel: "Café da manhã",
  confidence: 0.94,
  reasoning: "Produto identificado pela marca e variante.",
  items: [
    {
      foodName: "pão de forma",
      brand: "Panco",
      quantity: 2,
      unit: "fatia",
      portionText: "2 fatias",
      servings: 1,
      estimatedGrams: 50,
      estimatedCalories: 125,
      estimatedMacros: { protein: 3.9, carbs: 24, fat: 1.5 },
      confidence: 0.94,
      foodClassification: {
        processingLevel: "processed",
        isFruit: false,
        isVegetable: false,
        fiberGrams: 1.2,
        isPlainWater: false,
      },
    },
  ],
};

beforeEach(() => {
  extractWithAiMock.mockReset();
  findCatalogFoodMock.mockReset();
  findCatalogFoodSemanticMock.mockReset();
  extractWithAiMock.mockResolvedValue(extraction);
  findCatalogFoodMock.mockReturnValue(undefined);
  findCatalogFoodSemanticMock.mockResolvedValue(cachedFood);
});

describe("issue #1051 — reuso multimodal do cache persistido", () => {
  it("usa o produto persistido para uma transcrição de voz", async () => {
    const result = await processMealInput({
      transcript: "2 fatias de pão de forma Panco Premium",
      audioUrl: "https://media.example/audio.ogg",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Pão de Forma Panco Premium",
        brand: "Panco",
        calories: 125,
        protein: 3.9,
      })
    );
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      expect.stringContaining("Panco"),
      expect.objectContaining({ searchSpecificProduct: true })
    );
  });

  it("usa o mesmo produto persistido para uma imagem com contexto textual", async () => {
    const result = await processMealInput({
      text: "Panco Premium, 2 fatias",
      imageUrl: "data:image/jpeg;base64,aW1hZ2Vt",
    });

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        foodName: "Pão de Forma Panco Premium",
        brand: "Panco",
        calories: 125,
      })
    );
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      expect.stringContaining("Panco"),
      expect.objectContaining({ searchSpecificProduct: true })
    );
  });
});
