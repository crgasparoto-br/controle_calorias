import { describe, expect, it } from "vitest";
import { isCatalogFoodSemanticallyCompatible } from "./catalogMatching";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

describe("food catalog reference branded snacks", () => {
  it("contains Coca-Cola Original with official serving provenance", () => {
    const food = FOOD_CATALOG_REFERENCE.find(
      item => item.slug === "coca-cola-original"
    );

    expect(food).toEqual(
      expect.objectContaining({
        name: "Coca-Cola Original",
        brandName: "Coca-Cola",
        productVariant: "original",
        servingLabel: "200 ml (1 copo)",
        gramsPerServing: 200,
        calories: 85,
        carbs: 21,
        sourceUrls: ["https://www.coca-cola.com/br/pt/brands/coca-cola/produtos"],
        sourceConfidence: 0.99,
        isBrandedProduct: true,
      })
    );
    expect(food?.sourceEvidence).toContain("85 kcal");
    expect(food?.sourceEvidence).toContain("21 g de carboidratos");
  });

  it("contains the commercial identity and serving nutrition for Ouro Branco Duo Nuts", () => {
    const food = FOOD_CATALOG_REFERENCE.find(
      item => item.slug === "ouro-branco-duo-nuts-lacta"
    );

    expect(food).toEqual(
      expect.objectContaining({
        name: "Ouro Branco Duo Nuts Lacta",
        brandName: "Lacta",
        gramsPerServing: 22,
        calories: 114,
        protein: 1.1,
        carbs: 14,
        fat: 5.8,
        isBrandedProduct: true,
      })
    );
    expect(
      isCatalogFoodSemanticallyCompatible(food!, "Ouro Branco Pro Nuts Lacta")
    ).toBe(true);
  });

  it("contains the commercial identity and serving nutrition for Amandita", () => {
    const food = FOOD_CATALOG_REFERENCE.find(
      item => item.slug === "amandita-recheada-creme-cacau-lacta"
    );

    expect(food).toEqual(
      expect.objectContaining({
        name: "Amandita Recheada de Creme com Cacau Lacta",
        brandName: "Lacta",
        gramsPerServing: 30,
        calories: 156,
        protein: 1.4,
        carbs: 20,
        fat: 7.8,
        isBrandedProduct: true,
      })
    );
    expect(
      isCatalogFoodSemanticallyCompatible(
        food!,
        "Amandita Recheada de Creme com Cacau Lacta"
      )
    ).toBe(true);
  });
});
