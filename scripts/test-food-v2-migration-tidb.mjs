import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
const mode = process.env.FOOD_V2_TEST_MODE;
if (process.env.FOOD_V2_TEST_DB_ISOLATED !== "1" || !databaseUrl || !["upgrade", "rollback"].includes(mode)) {
  throw new Error("An isolated database, DATABASE_URL and FOOD_V2_TEST_MODE=upgrade|rollback are required.");
}
const dbName = new URL(databaseUrl).pathname.replace(/^\//, "");
if (dbName !== `ci_foodv2_${mode}`) throw new Error("Refusing to change a database outside the dedicated CI fixture.");
const connection = await mysql.createConnection({ uri: databaseUrl, multipleStatements: false });
const [[checkSetting]] = await connection.query("SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'");
if (checkSetting && String(checkSetting.Value).toUpperCase() !== "ON") {
  await connection.end();
  throw new Error("TiDB CHECK enforcement is OFF; the V2 migration cannot be safely accepted.");
}
const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 4 });

const seed = async () => {
  const [u] = await connection.query(
    "INSERT INTO users (openId, name, email) VALUES ('ci-foodv2-user', 'Food V2 test', 'ci-foodv2@example.invalid')"
  );
  const userId = u.insertId;
  const [f] = await connection.query(
    "INSERT INTO foods (owner_user_id, name, normalized_name, calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g) VALUES (?, 'Pão integral', 'pao integral', 250, 9, 48, 3)",
    [userId]
  );
  const foodId = f.insertId;
  const [m] = await connection.query("INSERT INTO meals (userId, mealLabel) VALUES (?, 'café da manhã')", [userId]);
  const snapshot = JSON.stringify({ foodId, calories: 125, protein: 4.5, carbs: 24, fat: 1.5, source: "legacy" });
  const [i] = await connection.query(
    "INSERT INTO mealItems (mealId, foodId, itemType, foodName, canonicalName, portionText, calories, protein, carbs, fat, foodSnapshotJson) VALUES (?, ?, 'food', 'Pão integral', 'Pão integral', '50 g', 125, 4.5, 24, 1.5, ?)",
    [m.insertId, foodId, snapshot]
  );
  const [src] = await connection.query("INSERT INTO food_sources (slug, name, version) VALUES ('ci-foodv2', 'CI Food V2', 'v1')");
  return { userId, foodId, mealItemId: i.insertId, sourceId: src.insertId, snapshot };
};
const queryRows = async (sql, args = []) => (await connection.query(sql, args))[0];
const assertLegacy = async (fixture, afterMigration) => {
  const [item] = await queryRows(
    "SELECT foodId, foodName, calories, protein, carbs, fat, foodSnapshotJson FROM mealItems WHERE id=?",
    [fixture.mealItemId]
  );
  assert.equal(item.foodId, fixture.foodId);
  assert.equal(item.foodName, "Pão integral");
  assert.deepEqual([item.calories, item.protein, item.carbs, item.fat].map(Number), [125, 4.5, 24, 1.5]);
  assert.equal(item.foodSnapshotJson, fixture.snapshot);
  if (afterMigration) {
    const [food] = await queryRows("SELECT canonical_key, scope FROM foods WHERE id=?", [fixture.foodId]);
    assert.equal(food.canonical_key, `legacy:food:${fixture.foodId}`);
    assert.equal(food.scope, "user");
  }
};
const applyFile = async path => {
  const contents = readFileSync(new URL(path, import.meta.url), "utf8");
  const statements = contents.split(/--> statement-breakpoint/).map(s => s.trim()).filter(Boolean);
  for (const [i, statement] of statements.entries()) {
    try { await connection.query(statement); }
    catch (error) { throw new Error(`Migration statement ${i + 1}/${statements.length} failed (${error.code || "unknown"}): ${statement.slice(0, 150)}`, { cause: error }); }
  }
  return statements.length;
};
const mustReject = async (promise, label) => {
  await assert.rejects(promise, error =>
    ["ER_DUP_ENTRY", "ER_CHECK_CONSTRAINT_VIOLATED", "ER_ROW_IS_REFERENCED_2", "ER_NO_REFERENCED_ROW_2"].includes(error.code) ||
    /duplicate|check constraint|foreign key/i.test(String(error.message))
  , label);
};
// Negative regression control: V1 continues creating foods after B1 without V2 fields.
// Unreconciled V1 records must remain explicitly unscoped and ineligible for V2.
const assertLegacyWritesAfterMigration = async f => {
  const insertSql = "INSERT INTO foods (owner_user_id, name, normalized_name, calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g) VALUES (?, ?, ?, 250, 9, 48, 3)";
  const [first] = await connection.query(insertSql, [f.userId, "Pão legado novo A", "pao legado novo a"]);
  const [second] = await connection.query(insertSql, [f.userId, "Pão legado novo B", "pao legado novo b"]);
  const rows = await queryRows("SELECT id, owner_user_id, scope, canonical_name, canonical_key FROM foods WHERE id IN (?, ?) ORDER BY id", [first.insertId, second.insertId]);
  assert.equal(rows.length, 2, "V1 must accept two legacy inserts after the V2 migration");
  for (const row of rows) {
    assert.equal(row.owner_user_id, f.userId);
    assert.equal(row.scope, null, "unreconciled personal records must not be implicitly global");
    assert.equal(row.canonical_name, null, "legacy identity must not be fabricated");
    assert.equal(row.canonical_key, null, "legacy records must not impersonate V2 canonical identities");
  }
  if (mode === "upgrade") {
    await connection.query("UPDATE foods SET scope='user', canonical_name='Pão legado novo A', canonical_key='ci-foodv2:reconciled' WHERE id=?", [first.insertId]);
    await mustReject(
      connection.query("UPDATE foods SET scope='user', canonical_name='Pão legado novo B', canonical_key='ci-foodv2:reconciled' WHERE id=?", [second.insertId]),
      "explicitly reconciled V2 canonical keys must still be unique"
    );
  }
  await assertLegacy(f, true);
};

const testUpgrade = async f => {
  const [v] = await connection.query(
    "INSERT INTO food_variants (food_id, variant_type, display_name, normalized_name, identity_key, status) VALUES (?, 'branded', 'Pão integral', 'pao integral', 'ci-foodv2:variant', 'active')",
    [f.foodId]
  );
  const variantId = v.insertId;
  const contenders = await Promise.allSettled([
    pool.query("INSERT INTO food_variants (food_id, variant_type, display_name, normalized_name, identity_key) VALUES (?, 'generic', 'A', 'a', 'ci-foodv2:race')", [f.foodId]),
    pool.query("INSERT INTO food_variants (food_id, variant_type, display_name, normalized_name, identity_key) VALUES (?, 'generic', 'B', 'b', 'ci-foodv2:race')", [f.foodId]),
  ]);
  assert.equal(contenders.filter(c => c.status === "fulfilled").length, 1, "duplicate food identity must be excluded");
  const profiles = [
    [variantId, f.sourceId, "ci-foodv2:profile", 1, "a".repeat(64)],
    [variantId, f.sourceId, "ci-foodv2:profile", 2, "b".repeat(64)],
  ];
  const addProfile = row => pool.query(
    "INSERT INTO food_nutrition_profiles (food_variant_id, source_id, profile_key, version, basis_quantity, basis_unit, calories_kcal, protein_g, carb_g, fat_g, content_hash, current_slot) VALUES (?, ?, ?, ?, 100, 'g', 250, 9, 48, 3, ?, 1)",
    row
  );
  const outcomes = await Promise.allSettled(profiles.map(addProfile));
  assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1, "only one current profile per key");
  const [profile] = await queryRows("SELECT id FROM food_nutrition_profiles WHERE profile_key='ci-foodv2:profile'");
  await connection.query("UPDATE mealItems SET foodVariantId=?, nutritionProfileId=? WHERE id=?", [variantId, profile.id, f.mealItemId]);
  await mustReject(connection.query("DELETE FROM food_nutrition_profiles WHERE id=?", [profile.id]), "referenced nutrition profile cannot disappear");
  await assertLegacy(f, true);
  await connection.query(
    "INSERT INTO user_food_aliases (user_id, food_variant_id, alias, normalized_alias, source) VALUES (?, ?, 'meu pão', 'meu pao', 'user_confirmed')",
    [f.userId, variantId]
  );
  await mustReject(connection.query(
    "INSERT INTO user_food_aliases (user_id, food_variant_id, alias, normalized_alias, source) VALUES (?, ?, 'Meu pão', 'meu pao', 'user_confirmed')",
    [f.userId, variantId]), "personal alias must be unique per user");
  await mustReject(connection.query(
    "INSERT INTO food_review_cases (case_key, case_type, status, target_artifact_type, target_artifact_id, target_revision, target_content_hash) VALUES ('ci-foodv2:invalid', 'profile', 'closed', 'nutrition_profile', ?, 1, ?)",
    [String(profile.id), "a".repeat(64)]), "closed review must require an outcome");
  const [c] = await connection.query(
    "INSERT INTO food_review_cases (case_key, case_type, target_artifact_type, target_artifact_id, target_revision, target_content_hash) VALUES ('ci-foodv2:review', 'profile', 'nutrition_profile', ?, 1, ?)",
    [String(profile.id), "a".repeat(64)]
  );
  const eventArgs = [c.insertId, "req-1", String(profile.id), "a".repeat(64)];
  const eventSql = "INSERT INTO food_review_events (case_id, review_cycle, request_key, action, actor_id, new_status, target_artifact_type, target_artifact_id, target_revision, target_content_hash, request_hash, policy_version) VALUES (?, 1, ?, 'open', 'ci-actor', 'open', 'nutrition_profile', ?, 1, ?, 'hash', 'ci-policy')";
  await connection.query(eventSql, eventArgs);
  await mustReject(connection.query(eventSql, eventArgs), "review event retry must be idempotent");
  const [events] = await queryRows("SELECT COUNT(*) AS c FROM food_review_events WHERE case_id=?", [c.insertId]);
  assert.equal(Number(events.c), 1);
  // Explicit profile supersession is transactional; historical meal references stay pinned.
  const [replacement] = await connection.query(
    "INSERT INTO food_nutrition_profiles (food_variant_id, source_id, profile_key, version, basis_quantity, basis_unit, calories_kcal, protein_g, carb_g, fat_g, content_hash, supersedes_profile_id) VALUES (?, ?, 'ci-foodv2:profile', 2, 100, 'g', 260, 10, 48, 3, ?, ?)",
    [variantId, f.sourceId, "c".repeat(64), profile.id]
  );
  await connection.beginTransaction();
  try {
    await connection.query(
      "UPDATE food_nutrition_profiles SET current_slot=NULL, valid_to=NOW(), status='revoked' WHERE id=?",
      [profile.id]
    );
    await connection.query(
      "UPDATE food_nutrition_profiles SET current_slot=1, status='verified', verified_at=NOW() WHERE id=?",
      [replacement.insertId]
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }
  await mustReject(pool.query(
    "UPDATE food_nutrition_profiles SET current_slot=1, valid_to=NULL WHERE id=?",
    [profile.id]
  ), "former version cannot become current while its successor is current");
  const [legacyProfile] = await queryRows(
    "SELECT status, current_slot FROM food_nutrition_profiles WHERE id=?",
    [profile.id]
  );
  assert.equal(legacyProfile.status, "revoked");
  assert.equal(legacyProfile.current_slot, null);
  const [historicalMeal] = await queryRows(
    "SELECT nutritionProfileId FROM mealItems WHERE id=?",
    [f.mealItemId]
  );
  assert.equal(historicalMeal.nutritionProfileId, profile.id, "historical meal remains bound to its original profile");
  await assertLegacy(f, true);

  // Revocation must preserve the retired personal alias and allow a new current record.
  await connection.query(
    "UPDATE user_food_aliases SET status='revoked', current_slot=NULL, revoked_at=NOW() WHERE user_id=? AND normalized_alias='meu pao'",
    [f.userId]
  );
  await connection.query(
    "INSERT INTO user_food_aliases (user_id, food_variant_id, alias, normalized_alias, source) VALUES (?, ?, 'meu pão', 'meu pao', 'user_confirmed')",
    [f.userId, variantId]
  );
  const [aliasHistory] = await queryRows(
    "SELECT COUNT(*) AS total, SUM(status='active') AS active FROM user_food_aliases WHERE user_id=? AND normalized_alias='meu pao'",
    [f.userId]
  );
  assert.equal(Number(aliasHistory.total), 2);
  assert.equal(Number(aliasHistory.active), 1);

  console.log(JSON.stringify({ event: "food_v2_migration_integration.passed", mode, variantId, currentProfileId: profile.id, reviewEvents: 1, successorProfileId: replacement.insertId, aliasHistoryCount: 2 }));
};

try {
  const [before] = await queryRows("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='food_variants'");
  assert.equal(Number(before.c), 0, "test requires pre-V2 baseline schema");
  const fixture = await seed();
  await assertLegacy(fixture, false);
  const forwardStatements = await applyFile("../drizzle/0055_food_intelligence_v2_persistence.sql");
  await assertLegacy(fixture, true);
  await assertLegacyWritesAfterMigration(fixture);
  if (mode === "upgrade") await testUpgrade(fixture);
  else {
    const reversed = await applyFile("../drizzle/rollback/0055_food_intelligence_v2_persistence.sql");
    const [stillThere] = await queryRows("SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='food_variants'");
    assert.equal(Number(stillThere.c), 0);
    await assertLegacy(fixture, false);
    console.log(JSON.stringify({ event: "food_v2_migration_integration.passed", mode, forwardStatements, reversed }));
  }
} finally { await pool.end(); await connection.end(); }
