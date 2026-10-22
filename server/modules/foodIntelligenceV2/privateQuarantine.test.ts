import { describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { foodPersonalReconciliationQuarantine } from "../../../drizzle/food-intelligence-v2-schema";
import { reconcileLegacyFoodKnowledge } from "./legacyReconciliationRepository";

vi.mock("../../db", () => ({ getDb: vi.fn() }));

function dbFixture() {
  const personalFood = {
    id: 11, name: "pao pessoal", normalizedName: "pao pessoal",
    status: "active", scope: "user", ownerUserId: 41,
    canonicalKey: null, brandName: null, sourceId: null, sourceFoodCode: null,
    caloriesKcalPer100g: 245, proteinGramsPer100g: 8,
    carbsGramsPer100g: 48, fatGramsPer100g: 2,
  };
  const orphanFood = { ...personalFood, id: 12, name: "origem desconhecida",
    normalizedName: "origem desconhecida", scope: null, ownerUserId: null };
  const catalog = (id: number, owner: number | null) => ({
    id, name: "produto pessoal", status: "active", isUserCreated: 1,
    createdByUserId: owner, brandName: null, sourceId: null,
    calories: 220, protein: 5, carbs: 25, fat: 3,
  });
  const originalPages = () => [
    [personalFood, orphanFood], [catalog(21, 41), catalog(22, null)],
    [], // no source grants (private quarantine needs no publication grant)
    [], // brands
    [], // V1 global aliases
    [], // V1 portions
    [
      { id: 31, foodCatalogId: 21, label: "1 fatia", unit: "serving", quantity: 1, grams: 25 },
      { id: 32, foodCatalogId: 22, label: "1 fatia", unit: "serving", quantity: 1, grams: 25 },
    ],
    [], // no revision attestations for personal/orphan historical rows
  ];
  const rows: Array<Record<string, unknown>> = [];
  let lastAttempt: Record<string, unknown> | null = null;
  const insert = vi.fn(table => {
    expect(table).toBe(foodPersonalReconciliationQuarantine);
    return {
      values(values: Record<string, unknown>) {
        lastAttempt = values;
        return {
          async onDuplicateKeyUpdate() {
            // Simulate a DB unique key: exact replay must not increase TTL.
            const prior = rows.find(r => r.legacyTable === values.legacyTable &&
              r.legacyRowId === values.legacyRowId);
            if (!prior) rows.push({ ...values });
          },
        };
      },
    };
  });
  const tx = {
    insert,
    select() {
      return {
        from(table: unknown) {
          expect(table).toBe(foodPersonalReconciliationQuarantine);
          return this;
        },
        where() { return this; },
        async limit() {
          return rows.filter(row => lastAttempt !== null &&
            row.legacyTable === lastAttempt.legacyTable &&
            row.legacyRowId === lastAttempt.legacyRowId).slice(0, 1);
        },
      };
    },
  };
  const transaction = vi.fn(async (fn: (tx: typeof tx) => Promise<unknown>) => fn(tx));
  const db = () => {
    let pages = originalPages();
    return {
      select() {
        // Bind the result at query creation. Drizzle's innerJoin query is
        // thenable even without limit(); resolving pages only in limit()
        // misaligns the concurrent Promise.all inventory queries.
        const page = pages.shift() ?? [];
        return {
          from() { return this; }, innerJoin() { return this; },
          where() { return this; },
          async limit() { return page; },
          then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve(page).then(resolve, reject);
          },
        };
      },
      transaction,
    };
  };
  vi.mocked(getDb).mockImplementation(async () => db() as never);
  return { insert, transaction, get rows() { return rows; } };
}

describe("AUD-1302-020 private staging", () => {
  it("preview reconciles each personal/orphan source without leaking to the public queue", async () => {
    const f = dbFixture();
    const preview = await reconcileLegacyFoodKnowledge("preview");
    expect(preview.totals).toEqual({ input: 4, mapped: 0, merged: 0, quarantined: 4 });
    expect(preview.catalogPortions.totals.quarantined).toBe(2);
    expect(f.transaction).not.toHaveBeenCalled();
    expect(f.rows).toHaveLength(0);

    const staged = await reconcileLegacyFoodKnowledge("stage");
    expect(staged.totals).toEqual(preview.totals);
    expect(f.rows).toHaveLength(6); // 4 source rows + their 2 catalog portions
    expect(f.rows.map(row => [row.legacyTable, row.legacyRowId])).toEqual([
      ["foodCatalog", 21], ["portions", 31], ["foodCatalog", 22],
      ["portions", 32], ["foods", 11], ["foods", 12],
    ]);
    expect(f.rows.filter(row => row.scope === "user" && row.ownerUserId === 41)).toHaveLength(3);
    expect(f.rows.filter(row => row.scope === "orphan" && row.ownerUserId === null)).toHaveLength(3);
    for (const row of f.rows) {
      expect(row.reason).toBeTruthy();
      expect(row.retentionUntil).toBeInstanceOf(Date);
      expect(Object.keys(row).sort()).toEqual([
        "legacyRowId", "legacyTable", "ownerUserId", "reason", "retentionUntil", "scope",
      ].sort()); // no personal text / macros / URLs
    }
    const firstDeadlines = f.rows.map(row => (row.retentionUntil as Date).getTime());
    await reconcileLegacyFoodKnowledge("stage");
    expect(f.rows).toHaveLength(6); // idempotent stage
    expect(f.rows.map(row => (row.retentionUntil as Date).getTime()))
      .toEqual(firstDeadlines); // replay cannot extend private retention
    expect(f.insert).toHaveBeenCalledTimes(12);
  });
});
