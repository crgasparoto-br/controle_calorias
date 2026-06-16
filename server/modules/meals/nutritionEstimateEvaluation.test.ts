import { describe, expect, it } from "vitest";

import {
  adjustFutureEstimateConfidence,
  aggregateNutritionEstimateErrorMetrics,
  buildMacroValuesFromPer100g,
  compareNutritionEstimateWithConfirmedSource,
  isReviewableEstimatedNutritionSource,
  type ConfirmedNutritionRecord,
  type EstimatedNutritionRecord,
} from "./nutritionEstimateEvaluation";
import { buildCatalogNutritionSource, buildEstimatedNutritionSource } from "./nutritionSourceSelection";

const estimatedSource = buildEstimatedNutritionSource({
  confidence: 0.54,
  matchedBy: "heuristic_fallback",
  origin: "documented_estimate_rule",
});

const confirmedSource = buildCatalogNutritionSource({
  food: {
    id: 77,
    scope: "global",
    name: "Iogurte proteico morango",
    brandName: "Marca Boa",
    source: {
      slug: "fabricante-marca-boa",
      name: "Fabricante Marca Boa",
      version: "2026-06",
      foodCode: "MB-IORG-PROT-MORANGO-160",
    },
  },
  confidence: 0.94,
});

function estimated(overrides: Partial<EstimatedNutritionRecord> = {}): EstimatedNutritionRecord {
  return {
    foodName: "Iogurte proteico morango",
    brandName: "Marca Boa",
    category: "laticinios",
    preparation: "pronto para consumo",
    unit: "pote",
    grams: 160,
    values: {
      caloriesKcal: 240,
      proteinG: 10,
      carbsG: 34,
      fatG: 6,
    },
    source: estimatedSource,
    ...overrides,
  };
}

function confirmed(overrides: Partial<ConfirmedNutritionRecord> = {}): ConfirmedNutritionRecord {
  return {
    foodName: "Iogurte proteico morango",
    brandName: "Marca Boa",
    category: "laticinios",
    preparation: "pronto para consumo",
    unit: "pote",
    grams: 160,
    values: {
      caloriesKcal: 150,
      proteinG: 15,
      carbsG: 12,
      fatG: 2.5,
    },
    source: confirmedSource,
    ...overrides,
  };
}

describe("nutrition estimate evaluation", () => {
  it("reconhece fonte estimada revisavel", () => {
    expect(isReviewableEstimatedNutritionSource(estimatedSource)).toBe(true);
    expect(isReviewableEstimatedNutritionSource(confirmedSource)).toBe(false);
  });

  it("calcula macros confirmados a partir de fonte por 100g", () => {
    expect(buildMacroValuesFromPer100g({
      grams: 160,
      caloriesKcalPer100g: 93.75,
      proteinGPer100g: 9.375,
      carbsGPer100g: 7.5,
      fatGPer100g: 1.5625,
    })).toEqual({
      caloriesKcal: 150,
      proteinG: 15,
      carbsG: 12,
      fatG: 2.5,
    });
  });

  it("compara estimativa antiga com fonte confirmada posterior e gera revisao relevante", () => {
    const result = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated(),
      confirmed: confirmed(),
    });

    expect(result).toEqual(expect.objectContaining({
      foodName: "Iogurte proteico morango",
      brandName: "Marca Boa",
      category: "laticinios",
      relevantDivergence: true,
      reviewReason: "estimated_vs_confirmed_divergence",
      reviewPriority: "high",
      caloriesAbsoluteError: 90,
      confidenceAdjustment: -0.18,
    }));
    expect(result.divergences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        nutrient: "caloriesKcal",
        estimated: 240,
        confirmed: 150,
        absoluteError: 90,
        relativeError: 0.6,
      }),
      expect.objectContaining({
        nutrient: "carbsG",
        absoluteError: 22,
      }),
    ]));
  });

  it("nao envia fonte ja confirmada para revisao como se fosse estimativa", () => {
    const result = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated({ source: confirmedSource }),
      confirmed: confirmed(),
    });

    expect(result).toEqual(expect.objectContaining({
      relevantDivergence: false,
      reviewReason: "estimate_source_not_reviewable",
      reviewPriority: "low",
      confidenceAdjustment: 0,
    }));
  });

  it("agrega metricas por categoria com maior erro nutricional", () => {
    const highError = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated(),
      confirmed: confirmed(),
    });
    const lowError = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated({
        foodName: "Arroz",
        brandName: null,
        category: "cereais",
        values: { caloriesKcal: 130, proteinG: 2.8, carbsG: 28, fatG: 0.3 },
      }),
      confirmed: confirmed({
        foodName: "Arroz",
        brandName: null,
        category: "cereais",
        values: { caloriesKcal: 128, proteinG: 2.5, carbsG: 28.1, fatG: 0.2 },
      }),
    });

    expect(aggregateNutritionEstimateErrorMetrics([lowError, highError])).toEqual([
      expect.objectContaining({
        category: "laticinios",
        sampleCount: 1,
        relevantDivergenceCount: 1,
        averageCaloriesAbsoluteError: 90,
      }),
      expect.objectContaining({
        category: "cereais",
        sampleCount: 1,
        relevantDivergenceCount: 0,
        averageCaloriesAbsoluteError: 2,
      }),
    ]);
  });

  it("reduz confianca futura de padroes com erro recorrente", () => {
    const first = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated(),
      confirmed: confirmed(),
    });
    const second = compareNutritionEstimateWithConfirmedSource({
      estimated: estimated({ values: { caloriesKcal: 310, proteinG: 8, carbsG: 42, fatG: 7 } }),
      confirmed: confirmed(),
    });

    expect(adjustFutureEstimateConfidence({
      currentConfidence: 0.7,
      evaluations: [first, second],
    })).toBe(0.27);
  });
});