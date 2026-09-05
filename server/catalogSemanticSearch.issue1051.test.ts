import { beforeEach, describe, expect, it, vi } from "vitest";

const brandedNutritionSearchMock = vi.hoisted(() => vi.fn());
const catalogSemanticSearchCoreMock = vi.hoisted(() => vi.fn());
const packagedSnackSearchCoreMock = vi.hoisted(() => vi.fn());
const resetEmbeddingCacheCoreMock = vi.hoisted(() => vi.fn());

vi.mock("./brandedNutritionSearch", () => ({
  findBrandedNutritionByWebSearch: brandedNutritionSearchMock,
}));

vi.mock("./catalogSemanticSearchCore", () => ({
  findCatalogFoodSemantic: catalogSemanticSearchCoreMock,
  findPackagedSnackByWebSearch: packagedSnackSearchCoreMock,
  resetEmbeddingCache: resetEmbeddingCacheCoreMock,
}));

const { findCatalogFoodSemantic } = await import("./catalogSemanticSearch");

describe("issue #1051 — fallback seguro para produto com marca", () => {
  beforeEach(() => {
    brandedNutritionSearchMock.mockReset();
    catalogSemanticSearchCoreMock.mockReset();
    packagedSnackSearchCoreMock.mockReset();
    resetEmbeddingCacheCoreMock.mockReset();
  });

  it("não substitui produto de marca por catálogo genérico quando a pesquisa específica falha", async () => {
    brandedNutritionSearchMock.mockResolvedValue(null);
    catalogSemanticSearchCoreMock.mockResolvedValue({
      name: "Pão integral Wickbold",
      aliases: ["pão integral"],
      brandName: "Wickbold",
    });

    await expect(
      findCatalogFoodSemantic("pão de forma Panco", {
        searchSpecificProduct: true,
      })
    ).resolves.toBeNull();

    expect(brandedNutritionSearchMock).toHaveBeenCalledWith(
      "pão de forma Panco",
      expect.anything()
    );
    expect(catalogSemanticSearchCoreMock).not.toHaveBeenCalled();
  });
});
