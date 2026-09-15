import { describe, expect, it, vi } from "vitest";

vi.mock("./mealAiExtraction", () => ({
  extractWithAi: vi.fn(async () => ({
    mealLabel: "Lanche",
    confidence: 0.8,
    reasoning: "Item identificado.",
    items: [
      {
        foodName: "manteiga",
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
          processingLevel: "processed_culinary_ingredient",
          isFruit: false,
          isVegetable: false,
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
});
