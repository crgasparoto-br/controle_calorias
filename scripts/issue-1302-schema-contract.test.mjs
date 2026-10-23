import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = p => readFileSync(new URL(p, import.meta.url), "utf8");
const migration = source("../drizzle/0056_food_v2_source_governance.sql");
const rollback = source("../drizzle/rollback/0056_food_v2_source_governance.sql");
const schema = source("../drizzle/food-intelligence-v2-schema.ts");
const legacySchema = source("../drizzle/schema.ts");
const snapshot = JSON.parse(source("../drizzle/meta/0056_snapshot.json"));
const journal = JSON.parse(source("../drizzle/meta/_journal.json"));

test("B2 grants are migrated only with deny-by-default permissions", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS food_source_read_grants/);
  assert.match(migration, /allow_read INT NOT NULL DEFAULT 0/);
  assert.match(migration, /allow_persist_evidence INT NOT NULL DEFAULT 0/);
  assert.match(migration, /allow_global_publication INT NOT NULL DEFAULT 0/);
  assert.match(migration, /retention_days IS NOT NULL AND retention_days BETWEEN 1 AND 365/);
  assert.match(schema, /export const foodSourceReadGrants = mysqlTable\("food_source_read_grants"/);
  assert.match(schema, /status: mysqlEnum\("status", \["pending", "approved", "revoked"\]\)/);
  assert.equal(snapshot.tables.food_source_read_grants.columns.source_version.type, "varchar(80)");
  assert.ok(snapshot.tables.food_source_read_grants.checkConstraint.food_source_read_grants_ck0);
});

test("AUD-1302-020 private quarantine has scoped owner, finite retention and no global review case", () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS food_personal_reconciliation_quarantine/);
  assert.match(migration, /FOREIGN KEY \(owner_user_id\) REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(migration, /retention_until TIMESTAMP NOT NULL/);
  assert.match(schema, /export const foodPersonalReconciliationQuarantine = mysqlTable/);
  assert.ok(snapshot.tables.food_personal_reconciliation_quarantine);
  assert.equal(snapshot.tables.food_personal_reconciliation_quarantine.columns.scope_guard.notNull, true);
  assert.match(migration, /scope_guard INT GENERATED ALWAYS AS/);
  assert.match(rollback, /DROP TABLE `food_personal_reconciliation_quarantine`/);
});

test("B2 evidence idempotency has matching index in migration and snapshot", () => {
  assert.match(migration, /ADD UNIQUE KEY food_evidence_cache_u0 \(owner_user_id, subject_key, content_hash\)/);
  assert.match(schema, /uniqueIndex\("food_evidence_cache_u0"\)\.on\(table.ownerUserId, table.subjectKey, table.contentHash\)/);
  assert.deepEqual(snapshot.tables.food_evidence.indexes.food_evidence_cache_u0, {
    name: "food_evidence_cache_u0", columns: ["owner_user_id","subject_key","content_hash"], isUnique: true,
  });
});

test("B2 rollback is additive-safe and recorded in drizzle journal", () => {
  assert.doesNotMatch(migration, /\bDELETE FROM\b|\bUPDATE `?(?:mealItems|foodCatalog)`?\b|\bDROP TABLE\b/i);
  assert.match(rollback, /DROP TABLE `food_source_read_grants`/);
  assert.match(rollback, /DROP INDEX `food_evidence_cache_u0`/);
  assert.doesNotMatch(rollback, /DROP TABLE `(?:foods|foodCatalog|mealItems|food_evidence)`/);
  assert.equal(journal.entries.at(-1).tag, "0056_food_v2_source_governance");
  assert.equal(snapshot.prevId, "12510000-0000-4000-8000-000000000055");
});


test("AUD-1302-026: profile/portion revision is persisted but never invented", () => {
  assert.match(migration, /ALTER TABLE food_nutrition_profiles ADD COLUMN source_version VARCHAR\(80\) NULL/);
  assert.match(migration, /ALTER TABLE food_portions ADD COLUMN source_version VARCHAR\(80\) NULL/);
  assert.match(schema, /sourceVersion: varchar\("source_version", \{ length: 80 \}\)/);
  assert.match(legacySchema, /sourceVersion: varchar\("source_version", \{ length: 80 \}\)/);
  for (const table of ["food_nutrition_profiles", "food_portions", "food_aliases"]) {
    assert.deepEqual(snapshot.tables[table].columns.source_version, {
      name: "source_version", type: "varchar(80)", primaryKey: false,
      notNull: false, autoincrement: false,
    });
    assert.match(rollback, new RegExp("ALTER TABLE " + table + " DROP COLUMN source_version"));
  }
  assert.doesNotMatch(migration, /UPDATE\s+(?:food_nutrition_profiles|food_portions|food_aliases)\s+SET\s+source_version/i);
});
