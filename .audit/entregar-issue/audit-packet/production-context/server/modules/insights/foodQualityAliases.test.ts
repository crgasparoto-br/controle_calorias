import { describe, expect, it } from "vitest";
import { calculateQualityIndicators, createFoodLookup } from "./foodQuality";

function mealItem(overrides: Record<string, unknown> = {}) {
  return {
    foodName: "item de teste",
    canonicalName: "item de teste",
    portionText: "100 g",
    quantity: 100,
    unit: "g",
    servings: 1,
    estimatedGrams: 100,
    calories: 100,
    protein: 1,
    carbs: 20,
    fat: 1,
    confidence: 0.9,
    source: "catalog" as const,
    ...overrides,
  };
}

function meal(items: unknown[]) {
  return [
    {
      id: 1,
      userId: 1,
      source: "web",
      mealLabel: "lanche",
      status: "confirmed",
      occurredAt: new Date("2026-06-01T12:00:00.000Z").getTime(),
      sourceText: "",
      confidence: 0.9,
      items,
      media: [],
      createdAt: Date.now(),
    },
  ] as never;
}

describe("food quality catalog aliases", () => {
  it("classifica variações representativas de entrada manual ou WhatsApp", () => {
    const quality = calculateQualityIndicators(
      meal([
        mealItem({
          foodName: "pão de sal",
          canonicalName: "pão de sal",
          estimatedGrams: 50,
          calories: 135,
        }),
        mealItem({
          foodName: "filé de frango grelhado",
          canonicalName: "filé de frango grelhado",
          estimatedGrams: 120,
          calories: 198,
          protein: 37,
        }),
        mealItem({
          foodName: "copo de leite",
          canonicalName: "copo de leite",
          estimatedGrams: 200,
          calories: 122,
        }),
        mealItem({
          foodName: "coca cola sem açúcar",
          canonicalName: "coca cola sem açúcar",
          estimatedGrams: 350,
          calories: 1,
        }),
        mealItem({
          foodName: "banana prata madura",
          canonicalName: "banana prata madura",
          estimatedGrams: 80,
          calories: 72,
        }),
      ]),
      0,
      createFoodLookup([]),
    );

    expect(quality.foodQualityItems).toEqual([
      expect.objectContaining({ isClassified: true, isUltraProcessed: false }),
      expect.objectContaining({ isClassified: true, isUltraProcessed: false }),
      expect.objectContaining({ isClassified: true, isUltraProcessed: false }),
      expect.objectContaining({ isClassified: true, isUltraProcessed: true }),
      expect.objectContaining({ isClassified: true, isFruit: true }),
    ]);
    expect(quality.fruitServings).toBe(1);
    expect(quality.ultraProcessedServings).toBe(1);
  });

  it("mantém item sem equivalência segura como não classificado", () => {
    const quality = calculateQualityIndicators(
      meal([
        mealItem({
          foodName: "bebida láctea sabor morango",
          canonicalName: "bebida láctea sabor morango",
          portionText: "1 garrafinha",
          calories: 160,
        }),
      ]),
      0,
      createFoodLookup([]),
    );

    expect(quality.foodQualityItems).toEqual([
      expect.objectContaining({
        foodName: "bebida láctea sabor morango",
        isClassified: false,
        unclassifiedReason: "missing_catalog_id",
      }),
    ]);
  });
});
