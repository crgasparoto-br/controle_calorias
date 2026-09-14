import { describe, expect, it, vi } from "vitest";

const findCatalogFoodSemanticMock = vi.hoisted(() => vi.fn(async (query: string) => {
  if (!/^1 fatia\b/iu.test(query.trim())) return null;
  return {
    slug: "panco-premium-researched",
    name: "Pão de Forma Panco Premium",
    aliases: ["Pão de Forma Panco Premium"],
    brandName: "Panco",
    isBrandedProduct: true,
    productVariant: "premium",
    variants: ["Pão de Forma Panco Premium"],
    servingLabel: "2 fatias (50 g)",
    gramsPerServing: 50,
    calories: 125,
    protein: 3.9,
    carbs: 24,
    fat: 1.5,
    sourceUrls: ["https://varejista.example/panco-premium"],
    sourceEvidence: "Pão de Forma Panco Premium: porção de 50 g (2 fatias), 125 kcal, 3,9 g de proteínas, 24 g de carboidratos e 1,5 g de gorduras.",
    sourceVerifiedAt: new Date("2026-09-14T00:00:00.000Z"),
    sourceConfidence: 0.95,
  };
}));

vi.mock("./catalogSemanticSearch", () => ({
  findCatalogFoodSemantic: findCatalogFoodSemanticMock,
}));

const { prepareCountableFoodRegistrationResolved } = await import(
  "./countableFoodQuantity"
);

describe("issue #1072 — contexto contável na pesquisa comercial", () => {
  it("mantém identidade canônica e usa quantidade/unidade no fallback de pesquisa específica", async () => {
    const prepared = await prepareCountableFoodRegistrationResolved(
      42,
      "1 fatia de pão de forma Panco Premium",
    );

    expect(findCatalogFoodSemanticMock).toHaveBeenNthCalledWith(
      1,
      "pão de forma Panco Premium",
      expect.objectContaining({ searchSpecificProduct: true }),
    );
    expect(findCatalogFoodSemanticMock).toHaveBeenCalledWith(
      "1 fatia de pão de forma Panco Premium",
      expect.objectContaining({ searchSpecificProduct: true }),
    );
    expect(prepared).toMatchObject({
      pendingItems: [],
      registrationText: "25 g de pão de forma Panco Premium",
      resolutions: [
        {
          request: {
            segment: "1 fatia de pão de forma Panco Premium",
            foodName: "pão de forma Panco Premium",
            brand: "Panco",
            count: 1,
            requestedUnit: "fatia",
          },
        },
      ],
    });
  });
});
