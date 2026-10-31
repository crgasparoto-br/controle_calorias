import { describe, expect, it } from "vitest";
import { mealItemSchema } from "./schemas";
import {
  mergeConfirmedMealClassification,
  readConfirmedMealClassification,
} from "./classificationSnapshot";

const classification = {
  processingLevel: "natural_or_minimally_processed" as const,
  isFruit: true,
  isVegetable: false,
  fiberGrams: 2.6,
  isPlainWater: false,
};

const item = {
  foodName: "Banana", canonicalName: "Banana", portionText: "1 unidade",
  servings: 1, estimatedGrams: 100, calories: 87,
  protein: 1.1, carbs: 23, fat: 0.3, confidence: 0.9,
  source: "catalog" as const,
};

describe("#1307 / A-029 — versioned historical classification persistence", () => {
  it("retains a confirmed classification at the real public item schema boundary", () => {
    const parsed = mealItemSchema.parse({ ...item, classification });
    expect(parsed.classification).toEqual(classification);
    const withoutEvidence = mealItemSchema.parse(item);
    expect(withoutEvidence.classification).toBeUndefined();
    expect(mealItemSchema.parse({ ...item, classification: null }).classification).toBeNull();
  });

  it("keeps nutrition and resolution fields while persisting only typed classification", () => {
    const existing = JSON.stringify({
      kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog" },
      calculated: { caloriesKcal: 87 },
    });
    const json = mergeConfirmedMealClassification(existing, classification);
    expect(JSON.parse(json!)).toEqual({
      kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog" },
      calculated: { caloriesKcal: 87 },
      classification: { schemaVersion: 1, ...classification },
    });
    expect(readConfirmedMealClassification(json)).toEqual(classification);
    expect(JSON.parse(existing)).not.toHaveProperty("classification");
  });

  it("never manufactures classification from missing, legacy or future snapshots", () => {
    const old = JSON.stringify({ kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog" } });
    expect(readConfirmedMealClassification(old)).toBeNull();
    expect(mergeConfirmedMealClassification(old, undefined)).toBe(old);
    expect(readConfirmedMealClassification(null)).toBeNull();
    expect(readConfirmedMealClassification("corrupt-json")).toBeNull();
    expect(readConfirmedMealClassification(JSON.stringify({ classification: {
      ...classification, schemaVersion: 2,
    } }))).toBeNull();
    const oldExplicit = JSON.stringify({ classification: { ...classification, isUltraProcessed: false } });
    expect(readConfirmedMealClassification(oldExplicit)).toEqual(classification);
  });

  it("clears stale claims on explicit null and never erases unrelated evidence", () => {
    const original = mergeConfirmedMealClassification(JSON.stringify({ resolution: { nutritionVerified: true } }), classification);
    const cleared = mergeConfirmedMealClassification(original, null);
    expect(cleared).toBe(JSON.stringify({ resolution: { nutritionVerified: true } }));
    expect(readConfirmedMealClassification(cleared)).toBeNull();
    expect(mergeConfirmedMealClassification(null, null)).toBeNull();
  });

  it("rejects malformed classification and arbitrary sensitive keys fail-closed", () => {
    const invalid = [
      { ...classification, fiberGrams: -1 },
      { ...classification, fiberGrams: Number.POSITIVE_INFINITY },
      { ...classification, processingLevel: "unknown" },
      { ...classification, isFruit: "true" },
      { ...classification, sourceText: "private@example.test" },
    ];
    for (const value of invalid) {
      expect(mealItemSchema.safeParse({ ...item, classification: value }).success).toBe(false);
      expect(() => mergeConfirmedMealClassification(null, value as never)).toThrow("invalid-meal-classification");
    }
    expect(() => mergeConfirmedMealClassification("[]", classification)).toThrow("invalid-meal-food-snapshot");
    expect(readConfirmedMealClassification(JSON.stringify({ classification: {
      schemaVersion: 1, ...classification, sourceText: "private@example.test",
    } }))).toBeNull();
  });
});
