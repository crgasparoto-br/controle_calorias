import { describe, expect, it } from "vitest";

import {
  buildAiInferredNutritionSource,
  buildCatalogNutritionSource,
  buildEstimatedNutritionSource,
  deriveNutritionSourceForMealItem,
  NUTRITION_SOURCE_SELECTION_VERSION,
} from "./nutritionSourceSelection";

describe("nutrition source selection", () => {
  it("prioriza produto com marca como fonte exata de produto", () => {
    const source = buildCatalogNutritionSource({
      food: {
        id: 99,
        scope: "global",
        name: "Iogurte natural Nestlé",
        brandName: "Nestlé",
        source: {
          slug: "fabricante-nestle",
          name: "Fabricante Nestlé",
          version: "2026-06",
          foodCode: "NESTLE-IORG-NAT-170",
        },
      },
      confidence: 0.94,
    });

    expect(source).toEqual(expect.objectContaining({
      type: "branded_product_exact",
      origin: "fabricante-nestle",
      sourceName: "Fabricante Nestlé",
      sourceVersion: "2026-06",
      foodCode: "NESTLE-IORG-NAT-170",
      confidence: 0.94,
      isEstimated: false,
      matchedBy: "brand_product_catalog_match",
      selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    }));
  });

  it("diferencia base oficial de curadoria interna pelo slug da fonte", () => {
    const source = buildCatalogNutritionSource({
      food: {
        id: 15,
        scope: "global",
        name: "Arroz branco cozido",
        brandName: null,
        source: {
          slug: "taco",
          name: "Tabela TACO",
          version: "4",
          foodCode: "C0001A",
        },
      },
    });

    expect(source).toEqual(expect.objectContaining({
      type: "official_database",
      origin: "taco",
      sourceName: "Tabela TACO",
      sourceVersion: "4",
      foodCode: "C0001A",
      isEstimated: false,
    }));
  });

  it("marca estimativa documentada quando nao ha fonte confiavel", () => {
    const source = buildEstimatedNutritionSource({
      confidence: 0.47,
      matchedBy: "unknown_food_heuristic",
    });

    expect(source).toEqual(expect.objectContaining({
      type: "documented_estimate",
      origin: "documented_estimate_rule",
      confidence: 0.47,
      isEstimated: true,
      matchedBy: "unknown_food_heuristic",
      selectionVersion: NUTRITION_SOURCE_SELECTION_VERSION,
    }));
  });

  it("marca inferencia da IA como estimativa revisavel", () => {
    const source = buildAiInferredNutritionSource({ confidence: 0.58 });

    expect(source).toEqual(expect.objectContaining({
      type: "ai_inferred",
      origin: "ai_meal_extraction",
      confidence: 0.58,
      isEstimated: true,
      matchedBy: "llm_nutrition_inference",
    }));
  });

  it("preserva fonte enviada pelo item quando ja existe metadata estruturado", () => {
    const existing = buildEstimatedNutritionSource({ confidence: 0.51 });

    expect(deriveNutritionSourceForMealItem({
      source: "heuristic",
      confidence: 0.3,
      nutritionSource: existing,
    })).toBe(existing);
  });
});
