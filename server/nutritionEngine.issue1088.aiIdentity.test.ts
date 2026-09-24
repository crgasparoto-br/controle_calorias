import { describe, expect, it, vi } from "vitest";

const testInput = vi.hoisted(() => ({
  foodName: "manteiga",
  processingLevel: "processed_culinary_ingredient" as const,
  isFruit: false,
  isVegetable: false,
}));

vi.mock("./mealAiExtraction", () => ({
  extractWithAi: vi.fn(async () => ({
    mealLabel: "Lanche",
    confidence: 0.8,
    reasoning: "Item identificado.",
    items: [
      {
        foodName: testInput.foodName,
        brand: null,
        quantity: 15,
        unit: "g",
        portionText: "15 g",
        servings: 0.15,
        estimatedGrams: 15,
        estimatedCalories: 22.5,
        estimatedMacros: { protein: 0.9, carbs: 2.25, fat: 0.75 },
        confidence: 0.8,
        foodClassification: {
          processingLevel: testInput.processingLevel,
          isFruit: testInput.isFruit,
          isVegetable: testInput.isVegetable,
          fiberGrams: 0,
          isPlainWater: false,
        },
      },
    ],
  })),
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: vi.fn(async () => null),
}));

const { processMealInput } = await import("./nutritionEngine");

describe("issue #1088 — identidade comercial com IA não vazia", () => {
  it("recupera a marca do texto e não aceita catálogo genérico incompatível", async () => {
    await expect(
      processMealInput({ text: "15g de manteiga Batavo extra com sal" })
    ).rejects.toMatchObject({
      code: "food_identity_clarification_required",
      context: expect.objectContaining({
        foodName: "Manteiga Batavo Extra com Sal",
        brand: "Batavo",
        usedSourceTextFallback: false,
        clarificationReason: "brand_variant_unresolved",
      }),
    });
  });

  it.each([
    { sourceText: "laranja pêra", extractedFoodName: "laranja pêra" },
    { sourceText: "mamão formosa", extractedFoodName: "mamão formosa" },
    { sourceText: "feijão preto", extractedFoodName: "feijão preto" },
    { sourceText: "pêra packans", extractedFoodName: "pêra" },
  ])(
    "não promove variante natural a marca desconhecida: $sourceText",
    async ({ sourceText, extractedFoodName }) => {
      testInput.foodName = extractedFoodName;
      testInput.processingLevel = "natural_or_minimally_processed";
      testInput.isFruit = /laranja|mamão|pêra/u.test(sourceText);
      testInput.isVegetable = false;

      const result = await processMealInput({ text: `15 g de ${sourceText}` });

      expect(result.items[0]).toEqual(
        expect.objectContaining({
          foodName: expect.stringMatching(new RegExp(extractedFoodName, "i")),
          brand: null,
        })
      );
      expect(result.semanticContract.needsClarification).toBe(false);
    }
  );
});
