import { describe, expect, it, vi } from "vitest";
import { mealItems, meals } from "../../../drizzle/schema";
import { createDrizzleMealsRepository } from "../../repositories/mealsRepository";
import { assertLegacyMealItemMutationSafe, assertLegacyMealProjectionSafe } from "./foodV2Snapshot";
import { mealItemSchema } from "./schemas";

describe("#1308 D1: V1 writer cannot overwrite a V2 food snapshot", () => {
  it("accepts ordinary V1 snapshots, absent snapshots and nested incidental text", () => {
    expect(() => assertLegacyMealItemMutationSafe([
      { foodSnapshotJson: null },
      { foodSnapshotJson: JSON.stringify({ kind: "meal_item_resolution", resolution: {
        text: "\"format\":\"food-v2\"" } }) },
      { foodSnapshotJson: "invalid legacy JSON" },
    ])).not.toThrow();
  });

  it("denies confirmed V2 rows before the legacy replacement transaction", () => {
    expect(() => assertLegacyMealItemMutationSafe([
      { foodSnapshotJson: JSON.stringify({ format: "food-v2", schemaVersion: 2,
        identity: { variantId: 12 }, nutrition: { verified: true } }) },
    ])).toThrow("food-v2-legacy-item-mutation-not-supported");
  });

  it("also denies a corrupted or forged top-level V2 marker, without rejecting a sibling V1 row", () => {
    const rows = [
      { foodSnapshotJson: JSON.stringify({ kind: "legacy" }) },
      { foodSnapshotJson: JSON.stringify({ format: "food-v2", schemaVersion: 999 }) },
    ];
    expect(() => assertLegacyMealItemMutationSafe(rows))
      .toThrow("food-v2-legacy-item-mutation-not-supported");
  });
});

describe("#1308 D1: V1 duplication/favorite cannot flatten a V2 DTO", () => {
  it("allows ordinary V1 records and absent V2 marker", () => {
    expect(() => assertLegacyMealProjectionSafe([
      {},
      { v2SnapshotVerified: undefined },
    ])).not.toThrow();
  });

  it("rejects copying any V2 sibling before a new meal can be created", () => {
    expect(() => assertLegacyMealProjectionSafe([
      {}, { v2SnapshotVerified: true }, {},
    ])).toThrow("food-v2-legacy-item-mutation-not-supported");
  });
});

describe("#1308 D1: public V1 update cannot erase a physical V2 item", () => {
  it("rejects the legacy whole-meal replacement before changing status or row", async () => {
    const writes = vi.fn();
    const storedMeal = { id: 17, userId: 7, status: "confirmed", mealLabel: "Almoço" };
    const storedItem = { id: 18, mealId: 17, foodId: 101,
      foodVariantId: 102, nutritionProfileId: 103,
      foodSnapshotJson: JSON.stringify({ format: "food-v2", schemaVersion: 2,
        identity: { foodEntityId: 101, variantId: 102 },
        nutrition: { profileId: 103, verified: true } }),
    };
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
      select: () => ({
        from: (table: unknown) => ({
          where() { return this; },
          orderBy() { return this; },
          for() { return this; },
          async limit() { return table === meals ? [storedMeal] : table === mealItems ? [storedItem] : []; },
        }),
      }),
      update: writes,
    };
    const repo = createDrizzleMealsRepository({
      getDb: async () => db as never,
      onWarning: vi.fn(),
    });
    await expect(repo.persistMealUpdate({
      meal: { id: 17, userId: 7, mealLabel: "Almoço", confidence: 1, occurredAt: 0 },
      items: [], resolvedCatalogIds: new Map(),
    })).rejects.toThrow("food-v2-legacy-item-mutation-not-supported");
    expect(writes).not.toHaveBeenCalled();
  });

  it("denies targeted V1 editing and moving without creating another meal", async () => {
    const item = mealItemSchema.parse({
      foodName: "Banana", canonicalName: "Banana", portionText: "1 unidade",
      quantity: 1, unit: "un", servings: 1, estimatedGrams: 100,
      calories: 90, protein: 1, carbs: 21, fat: 0.3, confidence: 0.9,
      source: "catalog",
    });
    const time = new Date("2026-10-05T12:00:00Z");
    const meal = { id: 17, userId: 7, status: "confirmed" as const, source: "web" as const,
      mealLabel: "Almoço", occurredAt: time.getTime(), createdAt: time.getTime(),
      sourceText: "", confidence: 1, items: [item], media: [] };
    const storedMeal = { ...meal, occurredAt: time };
    const storedItem = { ...item, id: 18, mealId: 17,
      foodSnapshotJson: JSON.stringify({ format: "food-v2", schemaVersion: 2 }) };
    const writes = vi.fn();
    const db = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(db),
      select: () => ({ from: (table: unknown) => ({
        where() { return this; }, orderBy() { return this; }, for() { return this; },
        async limit() { return table === meals ? [storedMeal] : table === mealItems ? [storedItem] : []; },
      }) }),
      insert: writes, update: writes, delete: writes,
    };
    const repo = createDrizzleMealsRepository({ getDb: async () => db as never,
      onWarning: vi.fn() });
    await expect(repo.updateMealItem({ userId: 7, meal, itemIndex: 0,
      updatedItem: item, mealLabel: "Almoço", occurredAt: time.getTime(),
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("food-v2-legacy-item-mutation-not-supported");
    await expect(repo.moveMealItem({ userId: 7, sourceMeal: meal, itemIndex: 0,
      updatedItem: item, targetMeal: { mealLabel: "Lanche", occurredAt: time.getTime() },
      resolvedCatalogIds: new Map(),
    })).rejects.toThrow("food-v2-legacy-item-mutation-not-supported");
    expect(writes).not.toHaveBeenCalled();
  });
});
