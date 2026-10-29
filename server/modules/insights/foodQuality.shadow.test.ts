import { describe, expect, it } from "vitest";
import { calculateFoodQualitySummary } from "../../../shared/reportsGoalAnalytics";
import { calculateHistoricalQualityIndicators, calculateQualityIndicators, createFoodLookup } from "./foodQuality";

const persisted = () => ({
  foodName: "Pão A", canonicalName: "Pão", portionText: "1 fatia",
  historicalRef: "variant:101", foodCatalogId: 500,
  servings: 1, estimatedGrams: 30, calories: 85, protein: 3,
  classification: {
    processingLevel: "processed" as const,
    isFruit: false, isVegetable: false, isUltraProcessed: false, fiberGrams: 1.3,
  },
});

describe("#1307 / Gate 19 — historical shadow readers", () => {
  it("keeps the confirmed nutrition and category after the current catalog is changed", () => {
    const meal = [{ mealLabel: "Café da manhã", items: [persisted()] }];
    const before = calculateHistoricalQualityIndicators(meal, 0);
    const changedLiveCatalog = createFoodLookup([{
      id: 500, name: "Pão", servingSize: 30, calories: 400, protein: 9, carbs: 10,
      fat: 5, fiber: 9, isFruit: true, isVegetable: false, isUltraProcessed: false,
      processingLevel: "natural_or_minimally_processed",
    } as Parameters<typeof createFoodLookup>[0][number]]);
    const live = calculateQualityIndicators(meal, 0, changedLiveCatalog);
    const after = calculateHistoricalQualityIndicators(meal, 0);
    expect(after).toEqual(before);
    expect(after.foodQualityItems[0]).toMatchObject({
      calories: 85, processingLevel: "processed",
      historicalRef: "variant:101", isClassified: true,
    });
    // The test does not require the live lookup to change every result; it
    // proves the shadow reader never delegates to it or changes with it.
    expect(live.foodQualityItems[0]?.calories).toBe(85);
  });

  it("leaves unknown classification explicit instead of guessing from the catalog", () => {
    const item = { ...persisted(), classification: null };
    const report = calculateHistoricalQualityIndicators([{ mealLabel: "Almoço", items: [item] }], 0);
    expect(report.foodQualityItems[0]).toMatchObject({
      processingLevel: "unknown", isClassified: false, calories: 85,
      unclassifiedReason: "unknown",
    });
    expect(report.fiberGrams).toBe(0);
    expect(report.fruitServings).toBe(0);
  });

  it("does not collapse historical variants with identical display names", () => {
    const report = calculateFoodQualitySummary([
      { date: "2026-10-01", items: [
        { calories: 80, canonicalName: "Pão", historicalRef: "variant:101", isClassified: false },
        { calories: 120, canonicalName: "Pão", historicalRef: "variant:102", isClassified: false },
      ] },
    ]);
    expect(report.unclassifiedItems).toHaveLength(2);
    expect(report.unclassifiedItems.map(item => item.totalCalories).sort((a, b) => a - b)).toEqual([80, 120]);
    expect(report.totalCalories).toBe(200);
  });

  it("preserves snapshot totals even when a variant is retired or its catalog row is absent", () => {
    const meal = [{ mealLabel: "Jantar", items: [
      { ...persisted(), foodCatalogId: null, historicalRef: "variant:retired",
        classification: persisted().classification },
    ] }];
    const result = calculateHistoricalQualityIndicators(meal, 0);
    expect(result.foodQualityItems[0].historicalRef).toBe("variant:retired");
    expect(result.proteinGrams).toBe(3);
    expect(result.foodQualityItems[0].calories).toBe(85);
  });
});
