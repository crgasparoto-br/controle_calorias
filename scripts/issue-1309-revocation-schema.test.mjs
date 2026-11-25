import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const file = path => readFileSync(new URL(path, import.meta.url), "utf8");
const name = "0058_food_v2_personal_alias_revocation_receipt";
const column = "revocation_request_hash";
const check = "user_food_aliases_revocation_ck";
const table = "user_food_aliases";
const predicate = "(revocation_request_hash IS NULL OR (status='revoked' AND revoked_at IS NOT NULL AND current_slot IS NULL))";

test("E1 migration and rollback only add/remove the nullable private idempotency receipt and its CHECK", () => {
  const forward = file(`../drizzle/${name}.sql`).trim().split(/\s+--> statement-breakpoint\s+/);
  assert.deepEqual(forward, [
    `ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` varchar(64);`,
    `ALTER TABLE \`${table}\` ADD CONSTRAINT \`${check}\` CHECK (${predicate});`,
  ]);
  const down = file(`../drizzle/rollback/${name}.sql`).trim().split(/\s+--> statement-breakpoint\s+/);
  assert.deepEqual(down, [
    `ALTER TABLE \`${table}\` DROP CONSTRAINT \`${check}\`;`,
    `ALTER TABLE \`${table}\` DROP COLUMN \`${column}\`;`,
  ]);
});

test("E1 Drizzle metadata differs only in the nullable receipt and its constraint", () => {
  const base = JSON.parse(file("../drizzle/meta/0057_snapshot.json"));
  const after = JSON.parse(file("../drizzle/meta/0058_snapshot.json"));
  assert.equal(after.prevId, base.id);
  const row = after.tables[table];
  assert.deepEqual(row.columns[column], { name: column, type: "varchar(64)", primaryKey: false, notNull: false, autoincrement: false });
  assert.deepEqual(row.checkConstraint[check], { name: check, value: predicate });
  delete row.columns[column];
  delete row.checkConstraint[check];
  assert.deepEqual({ ...after, id: base.id, prevId: base.prevId }, base);
  const journal = JSON.parse(file("../drizzle/meta/_journal.json"));
  const prior = journal.entries.at(-2);
  assert.equal(prior.idx, 57);
  assert.deepEqual(journal.entries.at(-1), { idx: 58, version: "5", when: 1795654500000, tag: name, breakpoints: true });
});
