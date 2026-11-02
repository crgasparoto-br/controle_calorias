/**
 * #1308: real TiDB transaction/readback gate for synthetic D1 data.
 * Does not enable a production flag or count as Gate A (#1335).
 */
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { buildFoodOperationEnvelopeFixture, buildFoodResolutionDecisionFixture } from "../server/modules/foodIntelligenceV2/fixtures";
import { prepareFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistence";
import { commitFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistenceRepository";
import { createFoodD1RouteDbStore } from "../server/modules/foodIntelligenceV2/entrypointRouteRepository";
import { routeFoodD1Operation } from "../server/modules/foodIntelligenceV2/entrypointRouting";
import type { FoodD1Result } from "../server/modules/foodIntelligenceV2/entrypointMigration";
import type { FoodOperationEnvelope, FoodResolutionDecision } from "../server/modules/foodIntelligenceV2/schemas";

const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== "test" ||
    process.env.FOOD_V2_TEST_DB_ISOLATED !== "1" ||
    !url || new URL(url).pathname !== "/ci_foodv2_upgrade") {
  throw new Error("D1 TiDB runtime test requires the isolated upgrade fixture");
}
const sql = await mysql.createConnection(url);
const insert = async (statement: string, values: unknown[] = []) => {
  const [result] = await sql.query(statement, values);
  return (result as { insertId: number }).insertId;
};
const rows = async (statement: string, values: unknown[] = []) => {
  const [result] = await sql.query(statement, values);
  return result as Array<Record<string, unknown>>;
};
const expectedSha = "a".repeat(40);
const approval = {
  status: "approved" as const, gateAReference: "ci:fixture-only-gate-a",
  rolloutReference: "ci:fixture-only-rollout", auditedBaseSha: expectedSha,
};

const userId = await insert(
  "INSERT INTO users (openId, name, email) VALUES ('ci-d1-user', 'D1 Synthetic', 'ci-d1@example.invalid')",
);
const foodId = await insert(
  "INSERT INTO foods (owner_user_id, name, normalized_name, calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g) VALUES (?, 'CI D1 Food', 'ci d1 food', 270, 12, 3, 23)",
  [userId],
);
const sourceId = await insert(
  "INSERT INTO food_sources (slug, name, version) VALUES ('ci-d1-source', 'CI D1 Source', 'v1')",
);
await sql.query(
  "INSERT INTO food_source_read_grants (source_id, source_version, status, allow_read, license_reference, approval_reference, approved_at) VALUES (?, 'v1', 'approved', 1, 'https://example.invalid/licence', 'ci-approval', NOW())",
  [sourceId],
);
const seedVariant = async (tag: string) => {
  const variantId = await insert(
    "INSERT INTO food_variants (food_id, variant_type, display_name, normalized_name, identity_key, status, governance_status) VALUES (?, 'generic', ?, ?, ?, 'active', 'verified')",
    [foodId, tag, tag.toLowerCase(), "ci-d1:" + tag],
  );
  const profileId = await insert(
    "INSERT INTO food_nutrition_profiles (food_variant_id, source_id, source_version, profile_key, version, status, basis_quantity, basis_unit, calories_kcal, protein_g, carb_g, fat_g, content_hash, current_slot, verified_at) VALUES (?, ?, 'v1', ?, 1, 'verified', 100, 'g', 270, 12, 3, 23, ?, 1, NOW())",
    [variantId, sourceId, "ci-d1:" + tag, "a".repeat(64)],
  );
  return { variantId, profileId, tag };
};
const first = await seedVariant("Mortadela");
const replacement = await seedVariant("Mortadela substituta");
const makeEnvelope = (operationKey: string): FoodOperationEnvelope =>
  buildFoodOperationEnvelopeFixture({
    ownerUserId: userId, idempotencyKey: operationKey,
  }) as FoodOperationEnvelope;
const makeDecision = (observationId: string, variant = first): FoodResolutionDecision =>
  buildFoodResolutionDecisionFixture({
    ownerUserId: userId, observationIds: [observationId],
    identity: { foodEntityId: foodId, variantId: variant.variantId,
      canonicalName: variant.tag },
    nutrition: { profileId: variant.profileId, sourceId,
      snapshotHash: "sha256:ci-d1-verified" },
    evidence: [{}, {}, { sourceId }],
  }) as FoodResolutionDecision;
const result = (entrypoint: FoodD1Result["entrypoint"], observationId: string,
  variant = first, target: number | null = null): FoodD1Result => ({
    schemaVersion: 2, operationKey: "", traceId: "trace-1",
    entrypoint, committed: false, registeredCount: 0,
    items: [{ observationId, mealItemId: target === null ? null : String(target),
      decision: makeDecision(observationId, variant),
      disposition: "ready", reasonCodes: [] }],
    readyCount: 1, skippedCount: 0,
  });
const occurredAt = new Date("2026-10-05T12:00:00Z");
const prepare = (env: FoodOperationEnvelope, batch: FoodD1Result) =>
  prepareFoodD1NativeWrite({
    envelope: env, authenticatedUserId: userId,
    result: { ...batch, operationKey: env.idempotencyKey },
    source: "web", occurredAt,
  });
const commit = async (env: FoodOperationEnvelope,
  entrypoint: FoodD1Result["entrypoint"],
  plan: ReturnType<typeof prepareFoodD1NativeWrite>) =>
  routeFoodD1Operation({
    envelope: env, authenticatedUserId: userId, entrypoint,
    source: "web" as const, store: createFoodD1RouteDbStore(),
    expectedAuditedBaseSha: expectedSha, verifyGates: async () => approval,
    enabled: true,
    runV1: async () => { throw new Error("V1 must never execute in the fixture"); },
    runV2: async () => commitFoodD1NativeWrite({
      plan, testEnabled: true, verifyCurrentGate: async () => true,
    }),
  });

try {
  const env = makeEnvelope("ci-d1-native-add");
  const batch = result("addition", "ci-d1-obs-1");
  batch.items.push({ observationId: "ci-d1-missing", mealItemId: null,
    decision: makeDecision("ci-d1-missing"),
    disposition: "deferred", reasonCodes: ["quantity_missing"] });
  batch.skippedCount = 1;
  const plan = prepare(env, batch);
  const firstCommit = await commit(env, "addition", plan);
  assert.equal(firstCommit.recordedItemIds.length, 1);
  assert.equal(firstCommit.skipped.length, 1);
  const itemId = firstCommit.recordedItemIds[0];
  const retry = await commit(env, "addition", plan);
  assert.deepEqual(retry.recordedItemIds, [itemId], "restart-style reentry uses the durable receipt");
  const [created] = await rows(
    "SELECT id, mealId, foodVariantId, calories, foodSnapshotJson FROM mealItems WHERE id=?",
    [itemId],
  );
  assert.equal(Number(created.foodVariantId), first.variantId);
  assert.equal(Number(created.calories), 81);
  assert.equal(JSON.parse(String(created.foodSnapshotJson)).schemaVersion, 2);
  const [meal] = await rows("SELECT id, status, sourceText, transcript FROM meals WHERE id=?", [created.mealId]);
  assert.equal(meal.status, "confirmed");
  assert.equal(meal.sourceText, null);
  assert.equal(meal.transcript, null);
  const [receipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, env.idempotencyKey],
  );
  assert.equal(Number(receipts.c), 1);
  await assert.rejects(commit({ ...env, mealOperation: {
    ...env.mealOperation!, targetMeal: "jantar" } }, "addition", plan),
    /operation-scope-changed/);
  const [stillOne] = await rows("SELECT COUNT(*) AS c FROM mealItems WHERE mealId=?", [created.mealId]);
  assert.equal(Number(stillOne.c), 1, "changed-scope retry must not duplicate a meal");

  const editEnv = makeEnvelope("ci-d1-native-edit");
  const editPlan = prepare(editEnv, result("edit", "ci-d1-obs-edit", replacement, itemId));
  const edited = await commit(editEnv, "edit", editPlan);
  assert.deepEqual(edited.recordedItemIds, [itemId]);
  const [updated] = await rows("SELECT foodVariantId, calories FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(updated.foodVariantId), replacement.variantId,
    "edit replaces the physical item in place");
  const labelEnv = makeEnvelope("ci-d1-native-label");
  const oldLabel = prepare(labelEnv, result("nutrition_label", "ci-d1-obs-label", first, itemId));
  await assert.rejects(commit(labelEnv, "nutrition_label", oldLabel),
    /target-stale-or-foreign/, "label must not silently change a selected food");
  const [unchanged] = await rows("SELECT foodVariantId FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(unchanged.foodVariantId), replacement.variantId);
  const [total] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(total.c), 1, "label and edit must not create another meal");

  await sql.query(
    "UPDATE food_source_read_grants SET status='revoked', revoked_at=NOW(), allow_read=0 WHERE source_id=?",
    [sourceId],
  );
  const revokedEnv = makeEnvelope("ci-d1-revoked-source");
  await assert.rejects(commit(revokedEnv, "addition",
    prepare(revokedEnv, result("addition", "ci-d1-obs-revoked"))),
    /source-revoked-or-unlicensed/);
  const [afterRevoke] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(afterRevoke.c), 1, "source revocation is checked in the write transaction");
  console.log("PASS: D1 TiDB native transaction/retry/scope/edit/label/source revocation", {
    userId, mealId: created.mealId, itemId,
  });
} catch (error) {
  console.error("FAIL: D1 TiDB native runtime", error);
  process.exitCode = 1;
} finally {
  await sql.end();
  // CI owns a dedicated, disposable process (the Drizzle pool is long-lived).
  process.exit(process.exitCode || 0);
}
