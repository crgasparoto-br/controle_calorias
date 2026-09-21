import { describe, expect, it } from "vitest";
import { isCatalogFoodSemanticallyCompatible } from "./catalogMatching";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

describe("food catalog reference branded snacks", () => {
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
