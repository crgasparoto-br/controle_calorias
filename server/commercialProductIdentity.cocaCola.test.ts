import { describe, expect, it } from "vitest";
import {
  isCommercialProductIdentityCompatible,
  isCommercialServingMeasureCompatible,
} from "./commercialProductIdentity";
import { buildItemFromCatalog } from "./mealItemBuilders";

const originalFromCan = {
  foodName: "200 ml de Coca-Cola Original",
  matchedProductName: "Coca-Cola Original lata 350 ml",
  brandName: "Coca-Cola",
  servingLabel: "1 lata (350 ml)",
  gramsPerServing: 350,
};

describe("identidade comercial de bebidas por volume", () => {
  it("aceita o volume consumido quando a fonte descreve uma lata maior da mesma variante", () => {
    expect(isCommercialProductIdentityCompatible(originalFromCan)).toBe(true);
  });

  it.each([
    "Coca-Cola Original garrafa 2 l",
    "Coca-Cola Original PET 1,5 l",
    "Coca-Cola Original caixa 1 l",
  ])("trata %s como embalagem, não como variante nutricional", matchedProductName => {
    expect(isCommercialProductIdentityCompatible({
      ...originalFromCan,
      matchedProductName,
      servingLabel: "200 ml (1 copo)",
      gramsPerServing: 200,
    })).toBe(true);
  });

  it("aceita a relação de volume mesmo quando o rótulo usa unidade de embalagem", () => {
    expect(isCommercialServingMeasureCompatible({
      foodName: "200 ml de Coca-Cola Original",
      matchedProductName: "Coca-Cola Original",
      servingLabel: "1 garrafa (2 l)",
      gramsPerServing: 2000,
    })).toBe(true);
  });

  it("escala explicitamente uma fonte nutricional de 100 ml para 200 ml", () => {
    const item = buildItemFromCatalog({
      slug: "coca-cola-original-100ml",
      name: "Coca-Cola Original",
      aliases: ["coca cola original"],
      brandName: "Coca-Cola",
      productVariant: "original",
      servingLabel: "100 ml",
      gramsPerServing: 100,
      calories: 42.5,
      protein: 0,
      carbs: 10.5,
      fat: 0,
      isBrandedProduct: true,
    }, {
      foodName: "200 ml de Coca-Cola Original",
      brand: "Coca-Cola",
      quantity: 200,
      unit: "ml",
      portionText: "200 ml",
      servings: 1,
      estimatedGrams: 200,
      estimatedCalories: 0,
      estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
      confidence: 0.99,
    });

    expect(item).toEqual(expect.objectContaining({
      estimatedGrams: 200,
      calories: 85,
      carbs: 21,
      protein: 0,
      fat: 0,
    }));
  });

  it("não troca Coca-Cola Original por Zero", () => {
    expect(isCommercialProductIdentityCompatible({
      ...originalFromCan,
      matchedProductName: "Coca-Cola Zero lata 350 ml",
    })).toBe(false);
  });

  it("não troca Coca-Cola Zero por Original", () => {
    expect(isCommercialProductIdentityCompatible({
      ...originalFromCan,
      foodName: "200 ml de Coca-Cola Zero",
      matchedProductName: "Coca-Cola Original lata 350 ml",
    })).toBe(false);
  });

  it("mantém Coca-Cola sem variante explícita ambígua diante de um candidato variantizado", () => {
    expect(isCommercialProductIdentityCompatible({
      ...originalFromCan,
      foodName: "200 ml de Coca-Cola",
    })).toBe(false);
  });

  it("continua rejeitando massa incompatível", () => {
    expect(isCommercialProductIdentityCompatible({
      foodName: "200 g de Coca-Cola Original",
      matchedProductName: "Coca-Cola Original lata 350 g",
      brandName: "Coca-Cola",
      servingLabel: "1 lata (350 g)",
      gramsPerServing: 350,
    })).toBe(false);
  });
});
