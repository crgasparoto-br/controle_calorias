import { describe, expect, it } from "vitest";
import { calculateFoodQualitySummary } from "./reportsGoalAnalytics";

describe("calculateFoodQualitySummary processing levels", () => {
  it("distribui calorias por nível de processamento explícito", () => {
    const summary = calculateFoodQualitySummary([
      {
        date: "2026-06-01",
        items: [
          { calories: 100, isClassified: true, processingLevel: "natural_or_minimally_processed" },
          { calories: 50, isClassified: true, processingLevel: "processed_culinary_ingredient" },
          { calories: 150, isClassified: true, processingLevel: "processed" },
          { calories: 200, isClassified: true, processingLevel: "ultra_processed" },
          { calories: 75, isClassified: true, processingLevel: "unknown" },
          { calories: 25, isClassified: false, foodName: "sem cadastro", unclassifiedReason: "missing_catalog_id" },
        ],
      },
    ]);

    expect(summary.naturalOrMinimallyProcessedCalories).toBe(100);
    expect(summary.processedCulinaryIngredientCalories).toBe(50);
    expect(summary.processedCalories).toBe(150);
    expect(summary.ultraProcessedCalories).toBe(200);
    expect(summary.unknownProcessingCalories).toBe(75);
    expect(summary.unclassifiedCalories).toBe(25);
    expect(summary.distribution.map(item => item.key)).toEqual([
      "naturalOrMinimallyProcessed",
      "processedCulinaryIngredient",
      "processed",
      "ultraProcessed",
      "unknownProcessing",
      "unclassified",
    ]);
  });

  it("preserva fallback dos flags antigos quando processingLevel está ausente", () => {
    const summary = calculateFoodQualitySummary([
      {
        date: "2026-06-01",
        items: [
          { calories: 100, isClassified: true, isUltraProcessed: true },
          { calories: 150, isClassified: true, isFruit: true },
          { calories: 50, isClassified: true },
        ],
      },
    ]);

    expect(summary.ultraProcessedCalories).toBe(100);
    expect(summary.naturalOrMinimallyProcessedCalories).toBe(200);
    expect(summary.unknownProcessingCalories).toBe(0);
  });
});
