import { describe, expect, it, vi } from "vitest";
import { foodCatalog, mealItems, meals } from "../../drizzle/schema";
import { createDrizzleMealsRepository } from "./mealsRepository";
import { foodCatalogDirectKey } from "../foodCatalogKeys";
import { calculateHistoricalQualityIndicators } from "../modules/insights/foodQuality";
import { calculateFoodQualitySummary } from "../../shared/reportsGoalAnalytics";
import { buildFoodShadowEvent } from "../modules/foodIntelligenceV2/shadowComparison";
import { buildV1HistoricalSnapshotFixture, buildFoodResolutionDecisionFixture } from "../modules/foodIntelligenceV2/fixtures";
import { mealItemSchema } from "../modules/meals/schemas";
import { calculateQualityIndicators, createFoodLookup } from "../modules/insights/foodQuality";

describe("#1307 / Gate 19 — persisted meal reader invariants", () => {
  it("A-029 saves the submitted classification through the writer, reader and quality aggregate", async () => {
    const received = mealItemSchema.parse({
      foodCatalogId: 500, foodName: "Banana", canonicalName: "Banana",
      portionText: "1 unidade", quantity: 1, unit: "un", servings: 1,
      estimatedGrams: 100, calories: 87, protein: 1.1, carbs: 23, fat: 0.3,
      confidence: 0.9, source: "catalog",
      classification: {
        processingLevel: "natural_or_minimally_processed", isFruit: true,
        isVegetable: false, fiberGrams: 2.6,
      },
      resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
    });
    const withoutClassification = mealItemSchema.parse({
      ...received, foodName: "Legado", canonicalName: "Legado",
      foodCatalogId: 501, classification: undefined,
    });
    let mealRow: Record<string, unknown> | null = null;
    const itemRows: Array<Record<string, unknown>> = [];
    const db = {
      insert(table: unknown) {
        return { async values(value: unknown) {
          if (table === meals) {
            mealRow = { ...(value as Record<string, unknown>), id: 60,
              createdAt: new Date("2026-10-31T08:00:00Z") };
            return [{ insertId: 60 }];
          }
          if (table === mealItems) {
            itemRows.push(...(value as Record<string, unknown>[]).map((row, index) => ({
              ...row, id: 61 + index, foodVariantId: index === 0 ? 301 : null,
            })));
          }
          return [];
        } };
      },
      update(table: unknown) {
        return { set(value: Record<string, unknown>) {
          return { async where() { if (table === meals && mealRow) Object.assign(mealRow, value); } };
        } };
      },
      select() {
        return { from(table: unknown) {
          return { where() { return this; },
            async orderBy() { return table === meals ? (mealRow ? [mealRow] : []) :
              table === mealItems ? itemRows : []; } };
        } };
      },
    };
    const warnings = vi.fn();
    const repository = createDrizzleMealsRepository({ getDb: async () => db as never, onWarning: warnings });
    const mealId = await repository.persistMeal({
      meal: { userId: 9, source: "web", mealLabel: "Lanche", sourceText: "Registro",
        confidence: 0.9, occurredAt: Date.parse("2026-10-31T08:00:00Z") },
      items: [received, withoutClassification], media: [],
      resolvedCatalogIds: new Map([["Banana", 500], ["Legado", 501]]),
    });
    expect(mealId).toBe(60);
    expect(warnings).not.toHaveBeenCalled();
    const savedSnapshot = JSON.parse(itemRows[0].foodSnapshotJson as string);
    expect(savedSnapshot).toMatchObject({
      kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog" },
      classification: { schemaVersion: 1, processingLevel: "natural_or_minimally_processed",
        isFruit: true, fiberGrams: 2.6 },
    });
    expect(itemRows[1].foodSnapshotJson).toBe(JSON.stringify({
      kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
    }));

    const historical = await repository.findConfirmedByUserId(9, { includeMedia: false, shadowReadOnly: true });
    expect(historical?.[0].items).toMatchObject([
      { historicalRef: "variant:301", calories: 87,
        classification: { processingLevel: "natural_or_minimally_processed", isFruit: true, fiberGrams: 2.6 } },
      { historicalRef: "catalog:501", classification: null },
    ]);
    const quality = calculateHistoricalQualityIndicators(historical!, 0);
    expect(quality).toMatchObject({ fiberGrams: 2.6, fruitServings: 1 });
    expect(quality.foodQualityItems.map(item => item.isClassified)).toEqual([true, false]);
    const summary = calculateFoodQualitySummary([
      { date: "2026-10-31", items: quality.foodQualityItems },
    ]);
    expect(summary.unclassifiedItems).toHaveLength(1);

    // Gate 19: a contradictory current catalog cannot rewrite confirmed quality.
    const changedCatalog = createFoodLookup([{
      id: 500, name: "Banana", servingSize: 100, calories: 400,
      protein: 9, carbs: 15, fat: 3, fiber: 99,
      isFruit: false, isVegetable: false, isUltraProcessed: true,
      processingLevel: "ultra_processed",
    } as Parameters<typeof createFoodLookup>[0][number]]);
    const current = calculateQualityIndicators(historical!, 0, changedCatalog);
    expect(current.foodQualityItems[0].processingLevel).toBe("ultra_processed");
    expect(calculateHistoricalQualityIndicators(historical!, 0)).toEqual(quality);
    const publicV1 = await repository.findConfirmedByUserId(9, { includeMedia: false });
    expect(publicV1?.[0].items.every(item => item.classification === undefined &&
      item.historicalRef === undefined)).toBe(true);
  });

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
/** A-030: exercise the real repository update/re-read boundary, not a pure projection. */
describe("#1307 / A-030 — historical identity survives meal updates", () => {
  const classification = {
    schemaVersion: 1, processingLevel: "natural_or_minimally_processed",
    isFruit: true, isVegetable: false, fiberGrams: 2.6,
  } as const;
  const dated = new Date("2026-10-31T10:00:00Z");
  const mealRow = () => ({
    id: 7, userId: 9, source: "web", mealLabel: "Lanche", status: "confirmed",
    occurredAt: dated, createdAt: dated, confidence: 0.9,
    notes: null, sourceText: "Registro", transcript: null,
  });
  const savedItem = (id: number, props: Record<string, unknown> = {}) => ({
    id, mealId: 7, foodId: 10, foodCatalogId: 500, foodVariantId: id + 100,
    nutritionProfileId: id + 200, foodPortionId: id + 300,
    recipeId: null, portionId: null, itemType: "food", createdAt: dated,
    foodName: "Leite", canonicalName: "Leite", portionText: "1 copo",
    quantity: 1, unit: "copo", servings: 1, estimatedGrams: 200,
    calories: 80, protein: 7, carbs: 9, fat: 4,
    grams: 200, caloriesKcal: 80, proteinG: 7, carbG: 9, fatG: 4,
    fiberG: 2.6, sodiumMg: 1, source: "catalog", sourceMediaStorageKey: null,
    foodSnapshotJson: JSON.stringify({
      kind: "meal_item_resolution", resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
      classification,
    }),
    ...props,
  });
  const publicItem = (row: ReturnType<typeof savedItem>) => ({
    foodCatalogId: row.foodCatalogId, foodName: row.foodName,
    canonicalName: row.canonicalName, portionText: row.portionText,
    quantity: row.quantity, unit: row.unit, servings: row.servings,
    estimatedGrams: row.estimatedGrams, calories: row.calories,
    protein: row.protein, carbs: row.carbs, fat: row.fat,
    source: row.source, confidence: 0.9,
  });
  const catalogFood = (id: number, props: Record<string, unknown> = {}) => ({
    id, status: "active", createdByUserId: null, name: "Iogurte",
    brandName: "Marca B", productVariant: null,
    gramsPerServing: 200, calories: 140, protein: 10, carbs: 12, fat: 6, fiber: 2,
    ...props,
  });
  function fixture(initial: Array<ReturnType<typeof savedItem>>,
    catalogRows: Array<ReturnType<typeof catalogFood>> = []) {
    const meal = mealRow();
    let rows: Array<ReturnType<typeof savedItem>> = initial.map(row => ({ ...row }));
    const writes: Array<{ op: string; payload?: unknown }> = [];
    let generatedId = 1000;
    const containsId = (input: unknown, id: number, seen = new Set<object>()): boolean => {
      if (!input || typeof input !== "object" || seen.has(input)) return false;
      seen.add(input);
      if (Array.isArray(input)) return input.some(value => containsId(value, id, seen));
      const record = input as Record<string, unknown>;
      if (record.value === id) return true;
      return Object.values(record).some(value => containsId(value, id, seen));
    };
    const result = (table: unknown) => table === meals ? [{ ...meal }] :
      table === mealItems ? rows.map(row => ({ ...row })) :
      table === foodCatalog ? catalogRows.map(row => ({ ...row })) : [];
    const db = {
      select: () => ({ from: (table: unknown) => {
        const query = {
          where() { return query; }, orderBy() { return query; }, for() { return query; },
          async limit() { return result(table); },
          then<T>(resolve: (rows: Record<string, unknown>[]) => T, reject?: (error: unknown) => T) {
            return Promise.resolve(result(table)).then(resolve, reject);
          },
        };
        return query;
      } }),
      update(table: unknown) {
        return { set(value: Record<string, unknown>) {
          return { async where(filter: unknown) {
            if (table === meals) Object.assign(meal, value);
            if (table === mealItems) {
              const matches = rows.filter(row => containsId(filter, row.id));
              expect(matches).toHaveLength(1);
              Object.assign(matches[0], value);
              writes.push({ op: "update-item", payload: value });
            }
          } };
        } };
      },
      delete(table: unknown) { return { async where() {
        if (table === mealItems) { writes.push({ op: "delete-items" }); rows = []; }
      } }; },
      insert(table: unknown) { return { async values(values: Record<string, unknown> | Record<string, unknown>[]) {
        if (table === meals) return [{ insertId: 8 }];
        if (table === mealItems) {
          const itemValues = values as Record<string, unknown>[];
          writes.push({ op: "insert-items", payload: itemValues });
          rows.push(...itemValues.map(value => ({ ...value, id: generatedId++ }) as ReturnType<typeof savedItem>));
        }
      } }; },
      async transaction<T>(fn: (transaction: unknown) => Promise<T>) { return fn(db); },
    };
    const repository = createDrizzleMealsRepository({ getDb: async () => db as never, onWarning: vi.fn() });
    const update = (items: Array<ReturnType<typeof publicItem>>, mealLabel = "Jantar",
      resolvedCatalogIds = new Map([["Leite", 999]])) =>
      repository.persistMealUpdate({
        meal: { id: 7, userId: 9, mealLabel, occurredAt: dated.getTime(), confidence: 0.9 },
        items: items as never,
        // Deliberately divergent live mapping: an old item may not be reidentified.
        resolvedCatalogIds,
      });
    return { repository, update, writes, items: () => rows.map(row => ({ ...row })) };
  }

  it("relabels a meal without rewriting item IDs, confirmed classification or V2 references", async () => {
    const old = savedItem(21);
    const state = fixture([old]);
    await state.update([publicItem(old)], "Jantar");
    expect(state.writes).toEqual([]);
    expect(state.items()).toEqual([old]);
    const historical = await state.repository.findConfirmedByUserId(9, { shadowReadOnly: true, includeMedia: false });
    expect(historical?.[0].items[0]).toMatchObject({
      historicalRef: "variant:121", classification: { processingLevel: "natural_or_minimally_processed", fiberGrams: 2.6 },
      calories: 80, protein: 7, carbs: 9, fat: 4,
    });
    expect(historical?.[0].mealLabel).toBe("Jantar");
  });

  it("updates only a portion-edited row and keeps its sibling, IDs and provenance", async () => {
    const first = savedItem(21);
    const sibling = savedItem(22, { foodName: "Iogurte", canonicalName: "Iogurte", calories: 120, caloriesKcal: 120 });
    const state = fixture([first, sibling]);
    await state.update([
      { ...publicItem(first), portionText: "2 copos", quantity: 2, estimatedGrams: 400, calories: 160 },
      publicItem(sibling),
    ]);
    expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
    const current = state.items();
    expect(current[0]).toMatchObject({ id: 21, foodVariantId: 121, nutritionProfileId: 221,
      foodSnapshotJson: first.foodSnapshotJson, calories: 160, caloriesKcal: 160,
      grams: 400, proteinG: 7, carbG: 9, fatG: 4 });
    expect(current[1]).toEqual(sibling);
    expect(current[0].foodCatalogId).toBe(500);
  });

  it("reorders two same-name variants and adds a new item without cross-contaminating snapshots", async () => {
    const first = savedItem(21);
    const second = savedItem(22, {
      calories: 120, caloriesKcal: 120,
      foodSnapshotJson: JSON.stringify({ classification: {
        ...classification, schemaVersion: 1, processingLevel: "ultra_processed", isFruit: false,
      } }),
    });
    const newFood = savedItem(90, { foodId: null, foodCatalogId: null, foodVariantId: null,
      foodName: "Café", canonicalName: "Café", calories: 2, caloriesKcal: 2 });
    const state = fixture([first, second]);
    await state.update([publicItem(newFood), publicItem(second), publicItem(first)]);
    expect(state.writes.map(write => write.op)).toEqual(["delete-items", "insert-items"]);
    const [newRow, savedSecond, savedFirst] = state.items();
    expect(newRow.foodVariantId).toBeUndefined();
    expect(newRow.foodSnapshotJson).toBeNull();
    expect(savedSecond).toMatchObject({ foodVariantId: 122, nutritionProfileId: 222,
      foodCatalogId: 500, foodSnapshotJson: second.foodSnapshotJson });
    expect(savedFirst).toMatchObject({ foodVariantId: 121, nutritionProfileId: 221,
      foodCatalogId: 500, foodSnapshotJson: first.foodSnapshotJson });
  });

  it("reorders two same-name variants without exchanging their historical profiles", async () => {
    const first = savedItem(21);
    const second = savedItem(22, { calories: 120, caloriesKcal: 120,
      foodSnapshotJson: JSON.stringify({ classification: {
        ...classification, processingLevel: "ultra_processed", isFruit: false,
      } }) });
    const state = fixture([first, second]);
    await state.update([publicItem(second), publicItem(first)]);
    expect(state.writes.map(write => write.op)).toEqual(["delete-items", "insert-items"]);
    const rows = state.items();
    expect(rows.map(row => row.foodVariantId)).toEqual([122, 121]);
    expect(rows.map(row => row.nutritionProfileId)).toEqual([222, 221]);
    expect(rows.map(row => row.foodSnapshotJson)).toEqual([
      second.foodSnapshotJson, first.foodSnapshotJson,
    ]);
    expect(rows.map(row => row.calories)).toEqual([120, 80]);
  });

  it("A-033 rejects positional V2 inheritance when two homonyms reorder and both portions change", async () => {
    const first = savedItem(21);
    const second = savedItem(22, { calories: 120, caloriesKcal: 120,
      foodSnapshotJson: JSON.stringify({ classification: {
        ...classification, processingLevel: "ultra_processed", isFruit: false,
      } }) });
    const state = fixture([first, second]);
    await state.update([
      { ...publicItem(second), portionText: "3 copos", quantity: 3,
        estimatedGrams: 600, calories: 180 },
      { ...publicItem(first), portionText: "4 copos", quantity: 4,
        estimatedGrams: 800, calories: 320 },
    ]);
    expect(state.writes.map(write => write.op)).toEqual(["delete-items", "insert-items"]);
    const rows = state.items();
    expect(rows.map(row => row.calories)).toEqual([180, 320]);
    expect(rows.map(row => row.foodVariantId)).toEqual([undefined, undefined]);
    expect(rows.map(row => row.nutritionProfileId)).toEqual([undefined, undefined]);
    expect(rows.map(row => row.foodSnapshotJson)).toEqual([null, null]);
  });

  it("A-033 retains identity across changed portions and reorder with verified historical refs", async () => {
    const first = savedItem(21);
    const second = savedItem(22, { calories: 120, caloriesKcal: 120 });
    const state = fixture([first, second]);
    await state.update([
      { ...publicItem(second), historicalRef: "variant:122",
        portionText: "3 copos", quantity: 3, estimatedGrams: 600, calories: 180 },
      { ...publicItem(first), historicalRef: "variant:121",
        portionText: "4 copos", quantity: 4, estimatedGrams: 800, calories: 320 },
    ] as never);
    const rows = state.items();
    expect(rows.map(row => row.foodVariantId)).toEqual([122, 121]);
    expect(rows.map(row => row.nutritionProfileId)).toEqual([222, 221]);
    expect(rows.map(row => row.foodSnapshotJson)).toEqual([
      second.foodSnapshotJson, first.foodSnapshotJson,
    ]);
    expect(rows.map(row => row.calories)).toEqual([180, 320]);
  });

  it("never transfers a prior variant/classification to a different food", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    await expect(state.update([{ ...publicItem(original), foodName: "Queijo",
      canonicalName: "Queijo", foodCatalogId: 700 }])).rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("does not inherit a saved variant after an explicit commercial identity change", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    await expect(state.update([{ ...publicItem(original), brand: "Marca Nova" } as never]))
      .rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("treats explicitly cleared brand as a commercial identity change", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    await expect(state.update([{ ...publicItem(original), brand: null } as never]))
      .rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("rejects ambiguous inherited variant identity after removing one identical duplicate", async () => {
    const first = savedItem(21);
    const second = savedItem(22);
    const state = fixture([first, second]);
    await state.update([publicItem(first)]);
    expect(state.writes.map(write => write.op)).toEqual(["delete-items", "insert-items"]);
    expect(state.items()[0].foodVariantId).toBeUndefined();
    expect(state.items()[0].nutritionProfileId).toBeUndefined();
    expect(state.items()[0].foodSnapshotJson).toBeNull();
  });


  it("A-034 persists submitted commercial identity and preserves it on an unchanged variant edit", async () => {
    const inserted = fixture([]);
    const item = { ...publicItem(savedItem(21)), brand: "Marca A",
      productVariant: "Integral 1 L" };
    await inserted.repository.persistMeal({
      meal: { userId: 9, source: "web", mealLabel: "Lanche", sourceText: "Registro",
        confidence: 0.9, occurredAt: dated.getTime() },
      items: [item] as never, media: [],
      resolvedCatalogIds: new Map([["Leite", 500]]),
    });
    const persisted = JSON.parse(inserted.items()[0].foodSnapshotJson!);
    expect(persisted.confirmedCommercialIdentity).toEqual({
      brand: "Marca A", productVariant: "Integral 1 L",
    });
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      ...persisted, classification,
    }) });
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.repository.updateMealItem({
      userId: 9, meal: loaded, itemIndex: 0,
      updatedItem: { ...publicItem(original), brand: "Marca A",
        productVariant: "Integral 1 L", portionText: "2 copos",
        quantity: 2, estimatedGrams: 400, calories: 160 } as never,
      mealLabel: "Lanche", occurredAt: dated.getTime(),
      resolvedCatalogIds: new Map([["Leite", 999]]),
    });
    const saved = state.items()[0];
    expect(saved).toMatchObject({ foodVariantId: 121, nutritionProfileId: 221,
      foodPortionId: 321, foodCatalogId: 500, calories: 160 });
    expect(JSON.parse(saved.foodSnapshotJson!).confirmedCommercialIdentity).toEqual({
      brand: "Marca A", productVariant: "Integral 1 L",
    });
    expect(JSON.parse(saved.foodSnapshotJson!).classification).toEqual(classification);
  });

  it("A-034 accepts legacy confirmed resolver variant without guessing a missing one", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral 1 L",
        nutritionOrigin: "catalog" }, classification,
    }) });
    const state = fixture([original]);
    await state.update([{ ...publicItem(original), brand: "Marca A",
      productVariant: "Integral 1 L", portionText: "2 copos", quantity: 2,
      estimatedGrams: 400, calories: 160 } as never]);
    expect(state.items()[0]).toMatchObject({ foodVariantId: 121,
      nutritionProfileId: 221, calories: 160 });
    expect(JSON.parse(state.items()[0].foodSnapshotJson!).confirmedCommercialIdentity).toEqual({
      brand: "Marca A", productVariant: "Integral 1 L",
    });
  });

  it("A-034 never assumes a legacy snapshot without variant proves an explicit variant", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", classification,
    }) });
    const state = fixture([original]);
    await expect(state.update([{ ...publicItem(original), brand: "Marca A",
      productVariant: "Integral 1 L", portionText: "2 copos", quantity: 2,
      estimatedGrams: 400, calories: 160 } as never])).rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("A-034 does not resurrect an explicitly cleared classification-only snapshot", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({ classification }) });
    const state = fixture([original]);
    await state.update([{ ...publicItem(original), classification: null } as never]);
    expect(state.items()[0].foodVariantId).toBe(121);
    expect(state.items()[0].foodSnapshotJson).toBeNull();

    const withCommercial = savedItem(22, { foodSnapshotJson: JSON.stringify({
      classification, confirmedCommercialIdentity: { brand: "Marca A" },
    }) });
    const second = fixture([withCommercial]);
    await second.update([{ ...publicItem(withCommercial), classification: null } as never]);
    const snapshot = JSON.parse(second.items()[0].foodSnapshotJson!);
    expect(snapshot.classification).toBeUndefined();
    expect(snapshot.confirmedCommercialIdentity).toEqual({ brand: "Marca A" });
  });

  it("A-035 drops stale V1 catalog and resolution on the public reader -> full meal edit path", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral",
        nutritionOrigin: "catalog", nutritionVerified: true }, classification,
    }) });
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    expect(loaded.items[0].resolution?.productVariant).toBe("Integral");
    await expect(state.update([{ ...loaded.items[0], brand: "Marca B" } as never]))
      .rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("A-035 clears stale resolution on a variant change without affecting its homonym sibling", async () => {
    const first = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral",
        nutritionOrigin: "catalog", nutritionVerified: true }, classification,
    }) });
    const sibling = savedItem(22, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca B", resolution: { productVariant: "Desnatado",
        nutritionOrigin: "catalog", nutritionVerified: true }, classification,
    }) });
    const state = fixture([first, sibling]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await expect(state.update([
      { ...loaded.items[0], brand: "Marca A", productVariant: "Desnatado" } as never,
      loaded.items[1] as never,
    ])).rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()).toEqual([first, sibling]);
  });
  it("A-035 accepts a different, verified direct catalog but never the stale resolution", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral", nutritionOrigin: "catalog",
        nutritionVerified: true }, classification,
    }) });
    const state = fixture([original], [catalogFood(900)]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.update([{ ...loaded.items[0], foodName: "Iogurte", canonicalName: "Iogurte",
      brand: "Marca B", foodCatalogId: 900 } as never],
      "Jantar", new Map([[foodCatalogDirectKey(900), 900], ["Leite", 500]]));
    const saved = state.items()[0];
    expect(saved).toMatchObject({ foodCatalogId: 900, foodId: null, source: "catalog",
      calories: 140, protein: 10, carbs: 12, fat: 6,
      caloriesKcal: 140, proteinG: 10, carbG: 12, fatG: 6, grams: 200 });
    expect(JSON.parse(saved.foodSnapshotJson!)).toEqual({
      kind: "catalog_replacement_nutrition", foodCatalogId: 900, grams: 200,
      calculated: { caloriesKcal: 140, proteinG: 10, carbG: 12, fatG: 6 },
      confirmedCommercialIdentity: { brand: "Marca B" },
    });
    const reread = await state.repository.findConfirmedByUserId(9, { includeMedia: false });
    expect(reread?.[0].items[0]).toMatchObject({ foodCatalogId: 900,
      foodName: "Iogurte", calories: 140, protein: 10, carbs: 12, fat: 6 });
    expect(reread?.[0].items[0].resolution).toBeUndefined();
  });
  it("A-037 never persists old macros or classification under a newly selected catalog ID", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
      classification,
    }) });
    const state = fixture([original], [catalogFood(900, {
      name: "Iogurte natural", productVariant: "Desnatado", calories: 85,
      protein: 9, carbs: 11, fat: 0.5, fiber: 0,
    })]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.update([{ ...loaded.items[0], foodName: "Iogurte natural",
      canonicalName: "Iogurte natural", brand: "Marca B", productVariant: "Desnatado",
      foodCatalogId: 900, classification } as never], "Jantar",
      new Map([[foodCatalogDirectKey(900), 900]]));
    const saved = state.items()[0];
    expect(saved).toMatchObject({ foodCatalogId: 900, foodId: null,
      calories: 85, protein: 9, carbs: 11, fat: 0.5,
      caloriesKcal: 85, proteinG: 9, carbG: 11, fatG: 0.5,
      fiberG: 0, sodiumMg: null, source: "catalog" });
    const snapshot = JSON.parse(saved.foodSnapshotJson!);
    expect(snapshot.classification).toBeUndefined();
    expect(snapshot.resolution).toBeUndefined();
    expect(snapshot.confirmedCommercialIdentity).toEqual({
      brand: "Marca B", productVariant: "Desnatado",
    });
    const reread = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    expect(reread.items[0]).toMatchObject({
      foodName: "Iogurte natural", calories: 85, protein: 9, carbs: 11, fat: 0.5,
    });
  });

  it("A-037 fails closed when direct catalog nutrition is absent or mismatched", async () => {
    const original = savedItem(21);
    for (const catalog of [[], [catalogFood(900, { name: "Outro alimento" })],
      [catalogFood(900, { status: "deprecated" })],
      [catalogFood(900, { createdByUserId: 999 })],
      [catalogFood(900, { calories: Number.NaN })],
      [catalogFood(900, { gramsPerServing: 0 })]]) {
      const state = fixture([original], catalog);
      const item = { ...publicItem(original), foodName: "Iogurte", canonicalName: "Iogurte",
        brand: "Marca B", foodCatalogId: 900 };
      await expect(state.update([item] as never, "Jantar",
        new Map([[foodCatalogDirectKey(900), 900]]))).rejects.toThrow(/Recalcule/);
      expect(state.writes).toEqual([]);
      expect(state.items()[0]).toEqual(original);
    }
  });

  it("A-037 preserves same-food edits and pure additions without copying a displaced food", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    await state.update([{ ...publicItem(original), portionText: "2 copos",
      quantity: 2, estimatedGrams: 400, calories: 160 }]);
    expect(state.items()[0]).toMatchObject({ calories: 160, foodVariantId: 121 });
    const added = { ...publicItem(original), foodName: "Iogurte", canonicalName: "Iogurte",
      foodCatalogId: 900, brand: "Marca B", calories: 85, protein: 9, carbs: 11, fat: 0.5 };
    const extra = fixture([original]);
    await extra.update([publicItem(original), added] as never, "Jantar",
      new Map([[foodCatalogDirectKey(900), 900]]));
    expect(extra.items()[1]).toMatchObject({ foodName: "Iogurte", calories: 85, foodCatalogId: 900 });
    expect(extra.items()[0].foodVariantId).toBe(121);
  });

  it("A-037 recalculates individual edits and moves from the new catalog without stale macros", async () => {
    const original = savedItem(21);
    const newItem = { ...publicItem(original), foodName: "Iogurte", canonicalName: "Iogurte",
      foodCatalogId: 900, brand: "Marca B", productVariant: "Desnatado",
      // The old editor can replay a versioned, invalid-on-input classification.
      // It must be discarded before either replacement path validates nutrition.
      classification, resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
      estimatedGrams: 100, calories: 80, protein: 7, carbs: 9, fat: 4 } as never;
    const resolved = new Map([[foodCatalogDirectKey(900), 900]]);
    const row = catalogFood(900, { productVariant: "Desnatado" });
    const state = fixture([original], [row]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.repository.updateMealItem({
      userId: 9, meal: loaded, itemIndex: 0, updatedItem: newItem,
      mealLabel: "Lanche", occurredAt: dated.getTime(), resolvedCatalogIds: resolved,
    });
    expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
    expect(state.items()[0]).toMatchObject({ id: 21, calories: 70,
      protein: 5, carbs: 6, fat: 3, grams: 100,
      foodCatalogId: 900, foodVariantId: null });
    expect(JSON.parse(state.items()[0].foodSnapshotJson!).classification).toBeUndefined();
    expect(JSON.parse(state.items()[0].foodSnapshotJson!).resolution).toBeUndefined();
    const movedState = fixture([original], [row]);
    const beforeMove = (await movedState.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    const moved = await movedState.repository.moveMealItem({
      userId: 9, sourceMeal: beforeMove, itemIndex: 0, updatedItem: newItem,
      targetMeal: { mealLabel: "Jantar", occurredAt: dated.getTime() },
      resolvedCatalogIds: resolved,
    });
    expect(moved?.targetMealId).toBe(8);
    expect(movedState.items()[0]).toMatchObject({ id: 21, mealId: 8,
      calories: 70, protein: 5, carbs: 6, fat: 3, foodCatalogId: 900,
      foodVariantId: null, source: "catalog" });
    expect(JSON.parse(movedState.items()[0].foodSnapshotJson!).classification).toBeUndefined();
    expect(JSON.parse(movedState.items()[0].foodSnapshotJson!).resolution).toBeUndefined();
  });

  it("A-037 uses a new V2 calculated snapshot and never an old classification", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    const calculated = { caloriesKcal: 123, proteinG: 11, carbG: 14, fatG: 3,
      fiberG: 1.4, sodiumMg: 6 };
    await state.update([{ ...loaded.items[0], foodName: "Iogurte", canonicalName: "Iogurte",
      foodId: 45, foodCatalogId: null, source: "catalog", classification,
      calories: 80, protein: 7, carbs: 9, fat: 4,
      foodSnapshotJson: JSON.stringify({ foodId: 45, name: "Iogurte", grams: 200,
        calculated, classification }),
    } as never]);
    const saved = state.items()[0];
    expect(saved).toMatchObject({ foodId: 45, foodCatalogId: null,
      calories: 123, protein: 11, carbs: 14, fat: 3,
      caloriesKcal: 123, proteinG: 11, carbG: 14, fatG: 3 });
    expect(JSON.parse(saved.foodSnapshotJson!).classification).toBeUndefined();
    expect(JSON.parse(saved.foodSnapshotJson!).calculated).toEqual(calculated);
  });

  it("A-035 keeps a verified direct catalog even when a sibling already uses that ID", async () => {
    const first = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { nutritionOrigin: "catalog", nutritionVerified: true },
    }) });
    const sibling = savedItem(22, { foodCatalogId: 900, foodId: 20,
      foodSnapshotJson: JSON.stringify({ confirmedCommercialIdentity: { brand: "Marca B" } }),
    });
    const state = fixture([first, sibling], [catalogFood(900, { name: "Leite" })]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.update([
      { ...loaded.items[0], brand: "Marca B", foodCatalogId: 900 } as never,
      loaded.items[1] as never,
    ], "Jantar", new Map([[foodCatalogDirectKey(900), 900], ["Leite", 500]]));
    const [changed, untouched] = state.items();
    expect(changed).toMatchObject({ foodCatalogId: 900, foodId: null,
      calories: 140, protein: 10, carbs: 12, fat: 6 });
    expect(JSON.parse(changed.foodSnapshotJson!).confirmedCommercialIdentity).toEqual({ brand: "Marca B" });
    expect(untouched.foodCatalogId).toBe(900);
    expect(untouched.foodVariantId).toBe(122);
    expect(untouched.foodSnapshotJson).toBe(sibling.foodSnapshotJson);
    expect(untouched.calories).toBe(sibling.calories);
  });
  it("A-035 rejects stale V1 provenance when name and commercial identity change together", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral",
        nutritionOrigin: "catalog", nutritionVerified: true }, classification,
    }) });
    const sibling = savedItem(22, { foodName: "Banana", canonicalName: "Banana",
      foodCatalogId: 700, foodId: 20,
      foodSnapshotJson: JSON.stringify({ classification }),
    });
    const state = fixture([original, sibling]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await expect(state.update([
      { ...loaded.items[0], foodName: "Iogurte", canonicalName: "Iogurte natural",
        brand: "Marca B", productVariant: "Desnatado" } as never,
      loaded.items[1] as never,
    ])).rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()).toEqual([original, sibling]);
  });
  it("A-035 rejects a stale catalog source on name-only replacement", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await expect(state.update([{ ...loaded.items[0],
      foodName: "Iogurte", canonicalName: "Iogurte natural" } as never]))
      .rejects.toThrow(/Recalcule/);
    expect(state.writes).toEqual([]);
    expect(state.items()[0]).toEqual(original);
  });
  it("A-035 preserves an added food with its own evidence when nothing was displaced", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    const added = { ...publicItem(original), foodName: "Iogurte", canonicalName: "Iogurte",
      brand: "Marca B", foodCatalogId: 900,
      resolution: { productVariant: "Natural", nutritionOrigin: "catalog", nutritionVerified: true } };
    await state.update([publicItem(original), added] as never,
      "Jantar", new Map([[foodCatalogDirectKey(900), 900], ["Leite", 500]]));
    const [unchanged, inserted] = state.items();
    expect(unchanged.foodVariantId).toBe(121);
    expect(unchanged.foodSnapshotJson).toBe(original.foodSnapshotJson);
    expect(inserted).toMatchObject({ foodName: "Iogurte", foodCatalogId: 900, source: "catalog" });
    expect(JSON.parse(inserted.foodSnapshotJson!)).toEqual({
      kind: "meal_item_resolution", resolution: added.resolution,
      confirmedCommercialIdentity: { brand: "Marca B" },
    });
  });

  it("A-036 persists commercial confirmation from legacy without changing macros or portion", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", resolution: { productVariant: "Integral",
        nutritionOrigin: "catalog", nutritionVerified: true }, classification,
    }) });
    const state = fixture([original]);
    const item = { ...publicItem(original), brand: "Marca A", productVariant: "Integral" };
    await state.update([item] as never);
    expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
    const saved = state.items()[0];
    expect(saved).toMatchObject({ id: 21, foodVariantId: 121, nutritionProfileId: 221,
      foodCatalogId: 500, calories: 80, portionText: "1 copo" });
    expect(JSON.parse(saved.foodSnapshotJson!)).toMatchObject({
      brandName: "Marca A", classification,
      confirmedCommercialIdentity: { brand: "Marca A", productVariant: "Integral" },
      resolution: { productVariant: "Integral", nutritionVerified: true },
    });
    // Once the confirmation is typed, an identical update must be write-free.
    const again = fixture([saved]);
    await again.update([item] as never);
    expect(again.writes).toEqual([]);
  });

  it("A-036 supports brand-only and variant-only confirmations independently", async () => {
    const legacy = JSON.stringify({ brandName: "Marca A", resolution: {
      productVariant: "Integral", nutritionOrigin: "catalog", nutritionVerified: true,
    } });
    for (const input of [{ brand: "Marca A" }, { productVariant: "Integral" }]) {
      const original = savedItem(21, { foodSnapshotJson: legacy });
      const state = fixture([original]);
      await state.update([{ ...publicItem(original), ...input }] as never);
      expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
      expect(JSON.parse(state.items()[0].foodSnapshotJson!).confirmedCommercialIdentity)
        .toEqual(input);
    }
  });

  it("A-036 confirms only one homonym, retaining the sibling's separate identity", async () => {
    const first = savedItem(21, { foodSnapshotJson: JSON.stringify({ brandName: "Marca A" }) });
    const sibling = savedItem(22, { foodSnapshotJson: JSON.stringify({ brandName: "Marca B" }) });
    const state = fixture([first, sibling]);
    await state.update([{ ...publicItem(first), brand: "Marca A" }, publicItem(sibling)] as never);
    expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
    const [confirmed, unchanged] = state.items();
    expect(confirmed.foodVariantId).toBe(121);
    expect(JSON.parse(confirmed.foodSnapshotJson!).confirmedCommercialIdentity).toEqual({ brand: "Marca A" });
    expect(unchanged).toEqual(sibling);
  });

  it("A-031 preserves V2 identity and confirmed classification on a one-item portion edit", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.repository.updateMealItem({
      userId: 9, meal: loaded, itemIndex: 0,
      updatedItem: {
        ...publicItem(original), portionText: "2 copos", quantity: 2, estimatedGrams: 400,
        calories: 160, foodSnapshotJson: JSON.stringify({ kind: "new_nutrition", caloriesKcal: 160 }),
      } as never,
      mealLabel: "Lanche", occurredAt: dated.getTime(),
      resolvedCatalogIds: new Map([["Leite", 999]]),
    });
    const item = state.items()[0];
    expect(item).toMatchObject({
      id: 21, foodId: 10, foodCatalogId: 500, foodVariantId: 121, nutritionProfileId: 221,
      foodPortionId: 321, calories: 160, caloriesKcal: 160, grams: 400,
    });
    const snapshot = JSON.parse(item.foodSnapshotJson!);
    expect(snapshot.kind).toBe("new_nutrition");
    expect(snapshot.classification).toEqual(classification);
  });

  it("A-031 clears stale food references, fiber and classification on a one-item food replacement", async () => {
    const original = savedItem(21);
    const state = fixture([original], [catalogFood(700, {
      name: "Queijo", brandName: null, calories: 110, protein: 8, carbs: 1, fat: 9,
      gramsPerServing: 40, fiber: null,
    })]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await state.repository.updateMealItem({
      userId: 9, meal: loaded, itemIndex: 0,
      updatedItem: {
        ...publicItem(original), foodName: "Queijo", canonicalName: "Queijo",
        foodCatalogId: 700, calories: 80, estimatedGrams: 40,
      } as never,
      mealLabel: "Lanche", occurredAt: dated.getTime(),
      resolvedCatalogIds: new Map([[foodCatalogDirectKey(700), 700], ["Queijo", 700]]),
    });
    expect(state.items()[0]).toMatchObject({
      id: 21, foodName: "Queijo", foodCatalogId: 700, foodId: null,
      foodVariantId: null, nutritionProfileId: null, foodPortionId: null,
      recipeId: null, portionId: null, itemType: "food", fiberG: null, sodiumMg: null,
      calories: 110, caloriesKcal: 110, protein: 8, carbs: 1, fat: 9, grams: 40,
    });
    expect(JSON.parse(state.items()[0].foodSnapshotJson!).classification).toBeUndefined();
  });
  it("A-031 rejects commercial-variant inheritance during individual edit and move", async () => {
    const original = savedItem(21, { foodSnapshotJson: JSON.stringify({
      brandName: "Marca A", kind: "meal_item_resolution",
      resolution: { nutritionOrigin: "catalog" }, classification,
    }) });
    const changed = {
      ...publicItem(original), foodId: 10, brand: "Marca B",
      foodSnapshotJson: JSON.stringify({ brandName: "Marca A", calculated: { caloriesKcal: 80 } }),
    } as never;
    const state = fixture([original]);
    const loaded = (await state.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await expect(state.repository.updateMealItem({
      userId: 9, meal: loaded, itemIndex: 0, updatedItem: changed,
      mealLabel: "Lanche", occurredAt: dated.getTime(),
      resolvedCatalogIds: new Map([["Leite", 500]]),
    })).rejects.toThrow(/Recalcule/);
    expect(state.items()[0]).toEqual(original);
    const moveState = fixture([original]);
    const beforeMove = (await moveState.repository.findConfirmedByUserId(9, { includeMedia: false }))![0];
    await expect(moveState.repository.moveMealItem({
      userId: 9, sourceMeal: beforeMove, itemIndex: 0, updatedItem: changed,
      targetMeal: { mealLabel: "Jantar", occurredAt: dated.getTime() },
      resolvedCatalogIds: new Map([["Leite", 500]]),
    })).rejects.toThrow(/Recalcule/);
    expect(moveState.items()[0]).toEqual(original);
  });
  it("A-032 keeps independent snapshots on equal-name/equal-portion foods in the transactional writer", async () => {
    const original = savedItem(21, { foodId: 10 });
    const other = savedItem(22, { foodId: 20, foodVariantId: 122 });
    const firstClass = {
      processingLevel: "processed" as const, isFruit: false, isVegetable: false, fiberGrams: 2.6,
    };
    const secondClass = { ...firstClass, processingLevel: "ultra_processed" as const };
    const state = fixture([original, other]);
    await state.update([
      {
        ...publicItem(original), foodId: 10, classification: firstClass,
        foodSnapshotJson: JSON.stringify({ kind: "nutrition_a" }),
      } as never,
      {
        ...publicItem(other), foodId: 20, classification: secondClass,
        foodSnapshotJson: JSON.stringify({ kind: "nutrition_b" }),
      } as never,
    ]);
    expect(state.writes.map(write => write.op)).toEqual(["update-item", "update-item"]);
    const [first, second] = state.items();
    expect(first).toMatchObject({ id: 21, foodId: 10, foodVariantId: 121, nutritionProfileId: 221 });
    expect(second).toMatchObject({ id: 22, foodId: 20, foodVariantId: 122, nutritionProfileId: 222 });
    expect(JSON.parse(first.foodSnapshotJson!)).toMatchObject({
      kind: "nutrition_a", classification: { schemaVersion: 1, ...firstClass },
    });
    expect(JSON.parse(second.foodSnapshotJson!)).toMatchObject({
      kind: "nutrition_b", classification: { schemaVersion: 1, ...secondClass },
    });
  });

  it("A-032 keeps each homonym's classification during a refreshed snapshot without explicit classification", async () => {
    const first = savedItem(21);
    const second = savedItem(22, {
      foodId: 20, foodSnapshotJson: JSON.stringify({
        classification: { ...classification, processingLevel: "ultra_processed", isFruit: false },
      }),
    });
    const state = fixture([first, second]);
    await state.update([
      { ...publicItem(first), foodSnapshotJson: JSON.stringify({ sourceVersion: "updated-a" }) } as never,
      { ...publicItem(second), foodSnapshotJson: JSON.stringify({ sourceVersion: "updated-b" }) } as never,
    ]);
    const [a, b] = state.items();
    expect(JSON.parse(a.foodSnapshotJson!)).toMatchObject({
      sourceVersion: "updated-a", classification,
    });
    expect(JSON.parse(b.foodSnapshotJson!)).toMatchObject({
      sourceVersion: "updated-b",
      classification: { ...classification, processingLevel: "ultra_processed", isFruit: false },
    });
  });

  it("clears a confirmed classification only on explicit null, leaving the item reference intact", async () => {
    const original = savedItem(21);
    const state = fixture([original]);
    await state.update([{ ...publicItem(original), classification: null } as never]);
    expect(state.writes.map(write => write.op)).toEqual(["update-item"]);
    expect(state.items()[0].foodVariantId).toBe(121);
    const snapshot = JSON.parse(state.items()[0].foodSnapshotJson!);
    expect(snapshot.classification).toBeUndefined();
    expect(snapshot.resolution).toEqual({ nutritionOrigin: "catalog", nutritionVerified: true });
  });
});
