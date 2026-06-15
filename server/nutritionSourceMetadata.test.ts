import { describe, expect, it } from "vitest";
import {
  buildCatalogNutritionSourceCandidate,
  selectCatalogNutritionSource,
  selectEstimatedNutritionSource,
} from "./nutritionSourceMetadata";
import type { CatalogFood } from "./nutritionEngine";

const cocaZero: CatalogFood = {
  slug: "coca-cola-zero-lata",
  name: "Coca-Cola zero lata",
  aliases: ["coca cola zero", "coca zero lata"],
  servingLabel: "1 lata",
  gramsPerServing: 350,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
};

const rice: CatalogFood = {
  slug: "arroz-branco",
  name: "Arroz branco cozido",
  aliases: ["arroz", "arroz branco"],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 130,
  protein: 2.7,
  carbs: 28,
  fat: 0.3,
};

describe("nutrition source metadata", () => {
  it("transforma produto de marca do catalogo em candidato curado", () => {
    const candidate = buildCatalogNutritionSourceCandidate(cocaZero, {
      foodName: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      variation: "zero",
      unit: "lata",
    });

    expect(candidate).toEqual(expect.objectContaining({
      id: "coca-cola-zero-lata",
      name: "Coca-Cola zero lata",
      brandName: "Coca-Cola",
      sourceType: "curated_catalog",
      sourceName: "Catálogo interno",
      sourceVersion: "static-reference",
      servingUnit: "lata",
    }));
  });

  it("seleciona fonte exata para produto de marca com variacao compativel", () => {
    const selectedAt = new Date("2026-06-15T12:00:00.000Z");
    const metadata = selectCatalogNutritionSource({
      food: cocaZero,
      selectedAt,
      query: {
        foodName: "Coca-Cola zero lata",
        brandName: "Coca-Cola",
        variation: "zero",
        unit: "lata",
      },
    });

    expect(metadata).toEqual(expect.objectContaining({
      quality: "exact",
      isEstimate: false,
      reviewRequired: false,
      selectedAt: "2026-06-15T12:00:00.000Z",
    }));
    expect(metadata.source).toEqual(expect.objectContaining({
      type: "curated_catalog",
      name: "Catálogo interno",
      version: "static-reference",
    }));
    expect(metadata.reasons).toContain("exact_brand_variation_match");
  });

  it("seleciona base interna para alimento sem marca", () => {
    const metadata = selectCatalogNutritionSource({
      food: rice,
      selectedAt: new Date("2026-06-15T12:00:00.000Z"),
      query: {
        foodName: "arroz branco",
        unit: "g",
      },
    });

    expect(metadata.quality).toBe("exact");
    expect(metadata.isEstimate).toBe(false);
    expect(metadata.reviewRequired).toBe(false);
    expect(metadata.source.type).toBe("internal_catalog");
    expect(metadata.reasons).toContain("curated_or_official_unbranded_match");
  });

  it("marca estimativa por regra interna com revisao requerida", () => {
    const metadata = selectEstimatedNutritionSource({
      foodName: "pão artesanal desconhecido",
      selectedAt: new Date("2026-06-15T12:00:00.000Z"),
      query: {
        foodName: "pão artesanal desconhecido",
        unit: "g",
      },
    });

    expect(metadata.quality).toBe("estimated");
    expect(metadata.isEstimate).toBe(true);
    expect(metadata.reviewRequired).toBe(true);
    expect(metadata.source).toEqual(expect.objectContaining({
      type: "generic_estimate",
      name: "Estimativa por regra interna",
    }));
    expect(metadata.reasons).toContain("estimated_fallback_used");
  });
});
