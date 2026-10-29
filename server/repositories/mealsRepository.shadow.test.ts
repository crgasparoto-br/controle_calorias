import { describe, expect, it, vi } from "vitest";
import { mealItems, meals } from "../../drizzle/schema";
import { createDrizzleMealsRepository } from "./mealsRepository";
import { calculateHistoricalQualityIndicators } from "../modules/insights/foodQuality";
import { calculateFoodQualitySummary } from "../../shared/reportsGoalAnalytics";
import { buildFoodShadowEvent } from "../modules/foodIntelligenceV2/shadowComparison";
import { buildV1HistoricalSnapshotFixture, buildFoodResolutionDecisionFixture } from "../modules/foodIntelligenceV2/fixtures";

describe("#1307 / Gate 19 — persisted meal reader invariants", () => {
  it("returns saved macros, identity and classification without a live catalog lookup", async () => {
    const snapshot = JSON.stringify({
      kind: "meal_item_resolution",
      classification: {
        processingLevel: "processed",
        isFruit: false, isVegetable: false, isUltraProcessed: false, fiberGrams: 0.7,
      },
      resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
    });
    const savedMeal = {
      id: 15, userId: 9, source: "web", mealLabel: "Café",
      status: "confirmed", occurredAt: new Date("2026-10-01T10:00:00Z"),
      createdAt: new Date("2026-10-01T10:01:00Z"), sourceText: null,
      transcript: null, notes: null, confidence: 0.9,
    };
    const savedItem = {
      id: 16, mealId: 15, foodId: null, foodCatalogId: 100,
      foodName: "Original", canonicalName: "Original",
      portionText: "1 un", quantity: 1, unit: "un", servings: 1,
      estimatedGrams: 12, calories: 73, protein: 5, carbs: 4, fat: 4,
      source: "catalog", foodSnapshotJson: snapshot, sourceMediaStorageKey: null,
    };
    const select = vi.fn(() => ({
      from(table: unknown) {
        return {
          where() { return this; },
          orderBy: vi.fn(async () => table === meals ? [savedMeal] : table === mealItems ? [savedItem] : []),
        };
      },
    }));
    const warnings = vi.fn();
    const repo = createDrizzleMealsRepository({
      getDb: async () => ({ select }) as never,
      onWarning: warnings,
    });
    const result = await repo.findConfirmedByUserId(9, { includeMedia: false, shadowReadOnly: true });
    expect(warnings).not.toHaveBeenCalled();
    expect(result).toHaveLength(1);
    expect(result?.[0].items).toMatchObject([{
      calories: 73, protein: 5, carbs: 4, fat: 4,
      historicalRef: "catalog:100",
      classification: { processingLevel: "processed", fiberGrams: 0.7 },
      canonicalName: "Original",
    }]);
    // The pre-cutover V1 reader is byte-shape compatible: no new fields.
    const productive = await repo.findConfirmedByUserId(9, { includeMedia: false });
    expect(productive?.[0].items[0].classification).toBeUndefined();
    expect(productive?.[0].items[0].historicalRef).toBeUndefined();
    // The test has no catalog provider or current catalog state whatsoever.
    expect(select).toHaveBeenCalled();
  });

  it("does not guess invalid/missing historical classifications", async () => {
    // No current profile should silently fill an incomplete or unsupported
    // historical snapshot. Invalid past data remains unclassified for shadow.
    const snapshot = JSON.stringify({
      classification: {
        processingLevel: "ultra_processed", isFruit: false, isVegetable: false,
        isUltraProcessed: true, fiberGrams: "untrusted",
      },
    });
    const mealRow = {
      id: 1, userId: 2, source: "web", status: "confirmed",
      mealLabel: "Lanche", occurredAt: new Date(), createdAt: new Date(), confidence: 0.9,
    };
    const itemRow = {
      id: 1, mealId: 1, foodId: null, foodCatalogId: null,
      foodName: "Lanche", canonicalName: "Lanche", portionText: "1 un",
      quantity: 1, unit: "un", servings: 1, estimatedGrams: 50,
      calories: 200, protein: 7, carbs: 26, fat: 8,
      source: "heuristic", foodSnapshotJson: snapshot,
    };
    const repo = createDrizzleMealsRepository({
      getDb: async () => ({
        select: () => ({
          from(table: unknown) {
            return { where() { return this; },
              async orderBy() { return table === meals ? [mealRow] : [itemRow]; } };
          },
        }),
      }) as never,
      onWarning: vi.fn(),
    });
    const result = await repo.findConfirmedByUserId(2, { includeMedia: false, shadowReadOnly: true });
    expect(result?.[0].items[0].classification).toBeNull();
    expect(result?.[0].items[0].calories).toBe(200);
  });
  it("keeps persisted V2 variants distinct despite a shared family, catalog and name", async () => {
    const meal = {
      id: 30, userId: 9, source: "web", status: "confirmed",
      mealLabel: "Café", occurredAt: new Date("2026-10-29T10:00:00Z"),
      createdAt: new Date("2026-10-29T10:01:00Z"), confidence: 0.9,
    };
    const shared = {
      mealId: 30, foodId: 10, foodCatalogId: 500,
      foodName: "Leite", canonicalName: "Leite", portionText: "1 copo",
      quantity: 1, unit: "copo", servings: 1, estimatedGrams: 200,
      protein: 7, carbs: 9, fat: 4, foodSnapshotJson: null,
      source: "catalog", sourceMediaStorageKey: null,
    };
    const items = [
      { ...shared, id: 31, foodVariantId: 101, calories: 80 },
      { ...shared, id: 32, foodVariantId: 102, calories: 120 },
      // Legacy item has only a saved family; no variant may be invented.
      { ...shared, id: 33, foodVariantId: null, calories: 60 },
    ];
    const select = vi.fn(() => ({
      from(table: unknown) {
        return {
          where() { return this; },
          async orderBy() { return table === meals ? [meal] : table === mealItems ? items : []; },
        };
      },
    }));
    const repo = createDrizzleMealsRepository({
      getDb: async () => ({ select }) as never,
      onWarning: vi.fn(),
    });
    const saved = await repo.findConfirmedByUserId(9, { includeMedia: false, shadowReadOnly: true });
    const shadowItems = saved?.[0].items ?? [];
    expect(shadowItems.map(item => item.historicalRef))
      .toEqual(["variant:101", "variant:102", "food:10"]);
    expect(shadowItems.map(item => item.calories)).toEqual([80, 120, 60]);

    // A-010: a real repository projection containing food:10 must not be
    // matched by label to a distinct known V2 family, even with equal macros.
    const mismatchedFamily = buildFoodShadowEvent({
      traceId: "b4e590ab-35bd-44cd-932a-e895e51ec7a2",
      modality: "text", entrypoint: "replay", scenarioClass: "commercial",
      v1: { ...buildV1HistoricalSnapshotFixture(), items: [shadowItems[2]] },
      v1Failure: null,
      v2: [buildFoodResolutionDecisionFixture({
        identity: { canonicalName: "Leite", foodEntityId: 11, variantId: null },
        nutrition: { consumed: { calories: 60, protein: 7, carbs: 9, fat: 4 } },
      })],
      observations: [], failure: "none",
      timings: { v1Ms: 1, languageMs: 1, resolverMs: 1, totalMs: 3 },
    });
    expect(mismatchedFamily.differences).toMatchObject({
      comparablePairs: 0, v1UnpairedItems: 1, v2UnpairedItems: 1,
      identity: 1, macros: { calories: null },
    });

    // Exercise the actual historical reader and aggregation, not just a fabricated
    // historicalRef provided directly by a test fixture.
    const quality = calculateHistoricalQualityIndicators([
      { mealLabel: "Café", items: shadowItems },
    ], 0);
    const report = calculateFoodQualitySummary([
      { date: "2026-10-29", items: quality.foodQualityItems },
    ]);
    expect(report.unclassifiedItems).toHaveLength(3);
    expect(report.unclassifiedItems.map(item => item.totalCalories).sort((a, b) => a - b))
      .toEqual([60, 80, 120]);
    expect(report.totalCalories).toBe(260);
    expect(quality.foodQualityItems.every(item => item.processingLevel === "unknown")).toBe(true);
    // Opt-in shadow metadata must never leak into today's public V1 reader.
    const productive = await repo.findConfirmedByUserId(9, { includeMedia: false });
    expect(productive?.[0].items.every(item => item.historicalRef === undefined)).toBe(true);
  });
});
