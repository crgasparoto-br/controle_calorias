// Fixture-only lifecycle checks for the disposable Food V2 migration gate.
// This module does not open a database connection.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migrationSql = readFileSync(new URL("../drizzle/0057_food_v2_current_slot_checks.sql", import.meta.url), "utf8");

export async function prepareCurrentSlotFixtures(connection, fixture) {
  const [variant] = await connection.query(
    "INSERT INTO food_variants (food_id, variant_type, display_name, normalized_name, identity_key) VALUES (?, 'generic', 'CI lifecycle', 'ci lifecycle', 'ci-v2:slot-variant')",
    [fixture.foodId],
  );
  const [attribute] = await connection.query(
    "INSERT INTO food_attributes (code, label, value_kind) VALUES ('ci_slot_attribute', 'CI lifecycle', 'enumerated')",
  );
  const aliasArgs = [fixture.userId, variant.insertId];
  const lexicalArgs = [fixture.userId];
  const overrideArgs = [fixture.foodId, attribute.insertId];
  const cases = [
    {
      table: "user_food_aliases", previous: "user_food_aliases_ck0", added: "user_food_aliases_current_ck",
      read: "user_id=? AND normalized_alias='ci current alias'", args: lexicalArgs, revokedAt: true,
      insert: "INSERT INTO user_food_aliases (user_id, food_variant_id, alias, normalized_alias, source, status, current_slot) VALUES (?, ?, 'CI current alias', 'ci current alias', 'user_confirmed', ?, ?)",
      insertArgs: aliasArgs,
    },
    {
      table: "user_food_lexicon_entries", previous: "user_food_lexicon_entri_ck0", added: "user_food_lexicon_current_ck",
      read: "user_id=? AND normalized_term='ci current term'", args: lexicalArgs, revokedAt: true,
      insert: "INSERT INTO user_food_lexicon_entries (user_id, term, normalized_term, kind, target_type, source, status, current_slot, confirmed_at) VALUES (?, 'CI current term', 'ci current term', 'alias_surface', 'none', 'user_confirmed', ?, ?, NOW())",
      insertArgs: lexicalArgs,
    },
    {
      table: "food_attribute_materiality_overrides", previous: "food_attr_override_ck0", added: "food_attr_override_current_ck",
      read: "food_id=? AND attribute_id=?", args: overrideArgs, revokedAt: false,
      insert: "INSERT INTO food_attribute_materiality_overrides (food_id, attribute_id, materiality, justification, author, status, current_slot) VALUES (?, ?, 'identity', 'Isolated lifecycle fixture', 'ci', ?, ?)",
      insertArgs: overrideArgs,
    },
  ];
  for (const testCase of cases) {
    await connection.query(testCase.insert, [...testCase.insertArgs, "revoked", null]);
    const [active] = await connection.query(testCase.insert, [...testCase.insertArgs, "active", 1]);
    testCase.activeId = active.insertId;
  }
  const readRows = async ({ table, read, args }) =>
    (await connection.query(`SELECT * FROM \`${table}\` WHERE ${read} ORDER BY id`, args))[0];
  const before = await Promise.all(cases.map(readRows));
  for (const [index, { table, added }] of cases.entries()) {
    assert.deepEqual(before[index].map(({ status, current_slot }) => [status, current_slot]),
      [["revoked", null], ["active", 1]]);
    const check = migrationSql.split("--> statement-breakpoint")
      .find(statement => statement.includes("ADD CONSTRAINT `" + added + "`"));
    const predicate = check?.match(/ CHECK \((.+)\);/)?.[1];
    assert.ok(predicate, "expected the exact 0057 predicate for " + table);
    // TiDB 8.5.1 validates preexisting records by prefixing the stored expression with NOT.
    const [violations] = await connection.query("SELECT 1 FROM `" + table + "` WHERE NOT " + predicate + " LIMIT 1");
    assert.deepEqual(violations, [], "the complete check must accept both legitimate states: " + table);
  }

  return {
    async verifySchemaAndRows(installed) {
      for (const [index, testCase] of cases.entries()) {
        const [rows] = await connection.query(`SHOW CREATE TABLE \`${testCase.table}\``);
        const ddl = rows[0]["Create Table"];
        assert.ok(ddl.includes(`CONSTRAINT \`${testCase.previous}\` CHECK`), "keep 0055 check");
        const checkLine = ddl.split("\n").find(line => line.includes(`CONSTRAINT \`${testCase.added}\` CHECK`));
        if (installed) {
          assert.ok(checkLine, "0057 check must be installed");
          assert.doesNotMatch(checkLine, /NOT ENFORCED/i);
        } else {
          assert.equal(checkLine, undefined, "rollback removes only the added check");
        }
        assert.deepEqual(await readRows(testCase), before[index], "DDL preserves current and historical rows");
      }
    },

    async verifyCurrentRotation() {
      for (const testCase of cases) {
        const revocation = testCase.revokedAt ? ", revoked_at=NOW()" : "";
        await connection.beginTransaction();
        try {
          await connection.query(
            `UPDATE \`${testCase.table}\` SET status='revoked', current_slot=NULL${revocation} WHERE id=?`,
            [testCase.activeId],
          );
          await connection.query(testCase.insert, [...testCase.insertArgs, "active", 1]);
          await connection.commit();
        } catch (error) {
          await connection.rollback();
          throw error;
        }
        const rows = await readRows(testCase);
        assert.deepEqual(rows.map(({ status, current_slot }) => [status, current_slot]),
          [["revoked", null], ["revoked", null], ["active", 1]]);
      }
    },
  };
}
