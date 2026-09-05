import { describe, expect, it } from "vitest";
import { recoverExplicitBrandFromSource } from "./nutritionEngine";

const baseItem = {
  foodName: "pão de forma",
  brand: null,
  portionText: "2 fatias",
  servings: 1,
  estimatedGrams: 50,
  estimatedCalories: 0,
  estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
  confidence: 0.82,
  foodClassification: {
    processingLevel: "processed" as const,
    isFruit: false,
    isVegetable: false,
    fiberGrams: 1.3,
  },
};

describe("issue #1051 — recuperação de marca a partir da origem", () => {
  it("recupera Panco do segmento-fonte quando a extração omite a marca", () => {
    expect(
      recoverExplicitBrandFromSource(baseItem, "2 fatias de pão de forma Panco")
    ).toEqual(
      expect.objectContaining({ foodName: "pão de forma", brand: "Panco" })
    );
  });

  it("não substitui uma marca explicitamente retornada pela IA", () => {
    expect(
      recoverExplicitBrandFromSource(
        { ...baseItem, brand: "Wickbold" },
        "2 fatias de pão de forma Panco"
      )
    ).toEqual(expect.objectContaining({ brand: "Wickbold" }));
  });

  it("não inventa marca para um produto não reconhecido", () => {
    expect(
      recoverExplicitBrandFromSource(
        baseItem,
        "2 fatias de pão de forma artesanal"
      )
    ).toEqual(expect.objectContaining({ brand: null }));
  });
});
