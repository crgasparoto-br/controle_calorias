import { describe, expect, it } from "vitest";
import {
  findGenericCatalogFood,
  isCatalogFoodSemanticallyCompatible,
} from "./catalogMatching";
import { resolveStructuredCommercialIdentity } from "./commercialFoodIdentityPreflight";
import { parseFoodText } from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";

describe("issue #1198 — identidade genérica não-branded", () => {
  it.each(["Queijo Muçarela", "Queijo Mozarela", "100 g de Queijo Muçarela"])(
    "aceita %s como referência genérica compatível sem clarificação comercial",
    foodName => {
      const reference = findGenericCatalogFood(foodName);
      const semanticName = parseFoodText(foodName).foodName;

      expect(reference).toMatchObject({
        slug: "taco-queijo-mozarela",
        name: "Queijo, mozarela",
      });
      expect(reference?.brandName ?? null).toBeNull();
      expect(reference?.isBrandedProduct ?? false).toBe(false);
      expect(isCatalogFoodSemanticallyCompatible(reference!, semanticName)).toBe(true);
      expect(resolveStructuredCommercialIdentity({
        segment: foodName.startsWith("100 g") ? foodName : `100 g de ${foodName}`,
        foodName: semanticName,
        brand: null,
      })).toEqual({ brand: null });
      expect(reference?.calories).toBeGreaterThan(300);
      expect(reference?.calories).not.toBe(150);
    },
  );

  it("usa a mesma fronteira genérica para uma categoria com variante TACO compatível", () => {
    const reference = findGenericCatalogFood("refrigerante laranja");

    expect(reference).toMatchObject({
      slug: "taco-refrigerante-tipo-laranja",
      name: "Refrigerante, tipo laranja",
    });
    expect(resolveStructuredCommercialIdentity({
      segment: "1 copo de refrigerante laranja",
      foodName: "refrigerante laranja",
      brand: null,
    })).toEqual({ brand: null });
  });

  it.each([
    "Queijo Muçarela Marca X",
    "Queijo Muçarela light",
    "Muçarela light Marca X",
    "Refrigerante laranja Marca X",
  ])(
    "não usa referência genérica quando há evidência comercial explícita ou variante: %s",
    foodName => {
      expect(findGenericCatalogFood(foodName)).toBeNull();
      expect(resolveStructuredCommercialIdentity({
        segment: foodName,
        foodName,
        brand: null,
      })).toMatchObject({
        brand: null,
        identityClarification: {
          context: { clarificationReason: "commercial_identity_unverified" },
        },
      });
    },
  );

  it("não escolhe arbitrariamente uma referência para um alias amplo", () => {
    const tacoReference = findTacoFood("Queijo");

    expect(tacoReference).toBeTruthy();
    expect(findGenericCatalogFood("Queijo")).toBeNull();
  });
});
