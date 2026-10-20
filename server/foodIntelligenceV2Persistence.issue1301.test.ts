import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/0055_food_intelligence_v2_persistence.sql", import.meta.url), "utf8");
const rollback = readFileSync(new URL("../drizzle/rollback/0055_food_intelligence_v2_persistence.sql", import.meta.url), "utf8");
const snapshot = JSON.parse(readFileSync(new URL("../drizzle/meta/0055_snapshot.json", import.meta.url), "utf8")) as { tables: Record<string, { columns: Record<string, unknown>; indexes: Record<string, { columns: string[]; isUnique: boolean }>; foreignKeys: Record<string, { tableTo: string; columnsFrom: string[]; onDelete: string }> }> };
const legacy = readFileSync(new URL("../drizzle/schema.ts", import.meta.url), "utf8");
const expected = [
  "food_variants", "food_variant_sources", "food_nutrition_profiles", "food_variant_classifications",
  "user_food_aliases", "food_barcodes", "food_evidence", "food_review_cases", "food_review_events",
  "food_resolution_events", "food_lexicon_entries", "user_food_lexicon_entries", "food_attributes",
  "food_variant_attributes", "food_attribute_materiality", "food_attribute_materiality_overrides",
];
function hasUnique(table: string, cols: string[]) {
  return Object.values(snapshot.tables[table]?.indexes ?? {}).some(
    i => i.isUnique && JSON.stringify(i.columns) === JSON.stringify(cols)
  );
}
describe("#1301 V2 migration invariants", () => {
  it("adds every approved V2 table and keeps snapshot in lockstep", () => {
    const names = [...migration.matchAll(/CREATE TABLE `([^`]+)`/g)].map(m => m[1]);
    expect(names.sort()).toEqual([...expected].sort());
    expect(expected.every(name => Boolean(snapshot.tables[name]))).toBe(true);
    expect(snapshot.tables.food_resolution_events.columns.id).toMatchObject({ type: "bigint" });
  });
  it("preserves existing meal items and legacy catalog while adding restricted V2 references", () => {
    expect(migration).not.toMatch(/DROP (TABLE|COLUMN)|DELETE FROM|UPDATE `mealItems`|UPDATE `foodCatalog`/i);
    for (const field of ["foodVariantId", "nutritionProfileId", "foodPortionId", "foodSnapshotJson"]) {
      expect(legacy).toContain(field);
    }
    for (const table of ["food_variants", "food_nutrition_profiles", "food_portions"]) {
      const fks = Object.values(snapshot.tables.mealItems.foreignKeys);
      expect(fks.some(fk => fk.tableTo === table && fk.onDelete === "restrict")).toBe(true);
    }
  });
  it("keeps unreconciled V1 food writes possible and fails closed for absent V2 identity", () => {
    const foodColumns = snapshot.tables.foods.columns as Record<string, { notNull: boolean; default?: string }>;
    for (const column of ["scope", "canonical_name", "canonical_key"]) {
      expect(foodColumns[column].notNull).toBe(false);
    }
    expect(foodColumns.scope).not.toHaveProperty("default");
    expect(migration).not.toMatch(/MODIFY COLUMN `canonical_(?:name|key)`[^;]*NOT NULL/i);
    expect(migration).toContain("UPDATE `foods` SET `canonical_name`=`name`");
    expect(hasUnique("foods", ["canonical_key"])).toBe(true);
  });
  it("prevents duplicate canonical variants and current nutrient/profile revisions", () => {
    expect(hasUnique("food_variants", ["identity_key"])).toBe(true);
    expect(hasUnique("food_nutrition_profiles", ["profile_key", "version"])).toBe(true);
    expect(hasUnique("food_nutrition_profiles", ["profile_key", "current_slot"])).toBe(true);
    expect(hasUnique("food_variant_classifications", ["food_variant_id", "current_slot"])).toBe(true);
    expect(hasUnique("food_variant_attributes", ["food_variant_id", "attribute_id", "current_slot"])).toBe(true);
  });
  it("keeps private vocabulary unique by owner without polluting the global registry", () => {
    expect(hasUnique("user_food_aliases", ["user_id", "normalized_alias", "current_slot"])).toBe(true);
    expect(hasUnique("user_food_lexicon_entries", ["user_id", "locale", "normalized_term", "kind", "current_slot"])).toBe(true);
    expect(hasUnique("food_lexicon_entries", ["locale", "normalized_term", "kind", "current_slot"])).toBe(true);
    expect(snapshot.tables.food_lexicon_entries.columns).not.toHaveProperty("user_id");
  });
  it("distinguishes task, outcome, availability and evidence governance", () => {
    expect(snapshot.tables.food_review_cases.columns).toHaveProperty("outcome");
    expect(snapshot.tables.food_review_cases.columns).toHaveProperty("review_cycle");
    expect(snapshot.tables.food_variants.columns).toHaveProperty("governance_status");
    expect(snapshot.tables.food_aliases.columns).toHaveProperty("governance_status");
    expect(hasUnique("food_review_events", ["case_id", "review_cycle", "request_key"])).toBe(true);
    expect(migration).toContain("status='closed' AND outcome IS NOT NULL AND closed_at IS NOT NULL");
    expect(snapshot.tables.food_evidence.columns).toHaveProperty("retention_until");
    expect(snapshot.tables.food_evidence.columns).toHaveProperty("owner_user_id");
  });
  it("contains a guarded reverse migration that never deletes legacy food tables", () => {
    for (const table of expected) expect(rollback).toContain("DROP TABLE `" + table + "`");
    expect(rollback).not.toMatch(/DROP TABLE `(?:foods|foodCatalog|mealItems|food_aliases|food_portions)`/);
    expect(rollback.indexOf("DROP TABLE `food_nutrition_profiles`")).toBeLessThan(rollback.indexOf("DROP TABLE `food_variant_sources`"));
  });
});
