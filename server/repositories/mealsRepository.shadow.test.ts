import { describe, expect, it, vi } from "vitest";
import { mealItems, meals } from "../../drizzle/schema";
import { createDrizzleMealsRepository } from "./mealsRepository";

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
});
