/**
 * #1308: real TiDB transaction/readback gate for synthetic D1 data.
 * Does not enable a production flag or count as Gate A (#1335).
 */
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { buildFoodObservationFixture, buildFoodOperationEnvelopeFixture, buildFoodResolutionDecisionFixture } from "../server/modules/foodIntelligenceV2/fixtures";
import { prepareFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistence";
import { commitFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistenceRepository";
import { createFoodD1RouteDbStore } from "../server/modules/foodIntelligenceV2/entrypointRouteRepository";
import { hashFoodD1OperationScope, routeFoodD1Operation } from "../server/modules/foodIntelligenceV2/entrypointRouting";
import { getFoodD1WebDraftByOperationKey, saveFoodD1WebDraft } from "../server/modules/foodIntelligenceV2/publicWebDraftRepository";
import { checkedFoodD1WebReplay, traceFoodD1WebSubmission } from "../server/modules/foodIntelligenceV2/publicWebDraftIdentity";
import { hasActiveWhatsappPendingInDb } from "../server/modules/foodIntelligenceV2/publicSimulator";
import { readActiveFoodD1WhatsAppPending, stageFoodD1WhatsAppPending,
  updateFoodD1WhatsAppPending, consumeFoodD1WhatsAppPending } from "../server/modules/foodIntelligenceV2/publicWhatsAppPendingRepository";
import { foodD1WhatsAppReplayFence } from "../server/modules/foodIntelligenceV2/publicWhatsAppReplayFence";
import { createWhatsAppD1RegistrationService } from "../server/modules/whatsapp/confirmedMealRegistration";
import { readFoodD1PublicContextSources } from "../server/modules/foodIntelligenceV2/publicContextSources";
import { createFoodV2KnowledgeRepository } from "../server/modules/foodIntelligenceV2/repository";
import { createFoodD1PublicWebDraft } from "../server/modules/foodIntelligenceV2/publicWebDraft";
import { createDrizzleMealsRepository } from "../server/repositories/mealsRepository";
import { getDb } from "../server/db";
import { createManualMeal, listMeals } from "../server/modules/meals/service";
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
  "INSERT INTO foods (owner_user_id, scope, name, normalized_name, calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g) VALUES (?, 'user', 'CI D1 Food', 'ci d1 food', 270, 12, 3, 23)",
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
      canonicalName: variant.tag, variant: variant.tag },
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
  // Exercise the same persisted pending lookup used by the public simulator,
  // in the disposable TiDB fixture, not a mocked repository or process Map.
  const pendingCheckAt = new Date("2026-11-03T14:00:00Z");
  assert.equal(await hasActiveWhatsappPendingInDb(userId, pendingCheckAt), false);
  const pendingId = await insert(
    "INSERT INTO whatsappPendingOperations (userId, type, target, origin, state, expiresAt) VALUES (?, 'food_clarification', '{}', 'ci-d1', 'active', '2030-01-01 00:00:00')",
    [userId],
  );
  assert.equal(await hasActiveWhatsappPendingInDb(userId, pendingCheckAt), true,
    "a durable pending survives the conversation process and prevents V2 reinterpretation");
  const foreignPendingUserId = await insert(
    "INSERT INTO users (openId, name, email) VALUES ('ci-d1-pending-owner', 'Other Pending Owner', 'ci-d1-pending-owner@example.invalid')",
  );
  const foreignPendingId = await insert(
    "INSERT INTO whatsappPendingOperations (userId, type, target, origin, state, expiresAt) VALUES (?, 'food_clarification', '{}', 'ci-d1', 'active', '2030-01-01 00:00:00')",
    [foreignPendingUserId],
  );
  assert.equal(await hasActiveWhatsappPendingInDb(foreignPendingUserId, pendingCheckAt), true);
  await sql.query("UPDATE whatsappPendingOperations SET state='consumed' WHERE id=?", [pendingId]);
  assert.equal(await hasActiveWhatsappPendingInDb(userId, pendingCheckAt), false,
    "an active pending owned by another user cannot affect the current user");
  assert.equal(await hasActiveWhatsappPendingInDb(foreignPendingUserId, pendingCheckAt), true,
    "a different owner keeps its own durable pending");
  const expiredPendingId = await insert(
    "INSERT INTO whatsappPendingOperations (userId, type, target, origin, state, expiresAt) VALUES (?, 'food_clarification', '{}', 'ci-d1', 'active', '2025-01-01 00:00:00')",
    [userId],
  );
  assert.equal(await hasActiveWhatsappPendingInDb(userId, pendingCheckAt), false,
    "expired pending must not block a future new operation");
  await sql.query("UPDATE whatsappPendingOperations SET state='consumed' WHERE id IN (?, ?)",
    [foreignPendingId, expiredPendingId]);

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

  const newSibling = prepare(env, result("addition", "ci-d1-injected"));
  await assert.rejects(commit(env, "addition", newSibling),
    /observation-not-in-original-operation/,
    "same idempotency key must not allow invented sibling observations");
  const deferred = result("continuation", "ci-d1-missing");
  deferred.items[0].decision.revision = 2;
  const deferredPlan = prepare(env, deferred);
  const completed = await commit(env, "continuation", deferredPlan);
  assert.equal(completed.mealId, Number(created.mealId),
    "the deferred sibling must use the original physical meal");
  assert.equal(completed.recordedItemIds.length, 1);
  assert.notEqual(completed.recordedItemIds[0], itemId);
  const repeated = await commit(env, "continuation", deferredPlan);
  assert.deepEqual(repeated.recordedItemIds, completed.recordedItemIds,
    "retry after continuation must return exactly the same physical item");
  const [twoSiblings] = await rows(
    "SELECT COUNT(*) AS c FROM mealItems WHERE mealId=?", [created.mealId]);
  assert.equal(Number(twoSiblings.c), 2, "only the original two siblings may be persisted");
  const [twoReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, env.idempotencyKey]);
  assert.equal(Number(twoReceipts.c), 2);

  // An initially eligible V2 result cannot cross a family ownership or
  // lifecycle change that happens before the definitive write transaction.
  const otherUser = await insert(
    "INSERT INTO users (openId, name, email) VALUES ('ci-d1-foreign', 'Foreign Fixture', 'ci-d1-foreign@example.invalid')",
  );
  await sql.query("UPDATE foods SET owner_user_id=? WHERE id=?", [otherUser, foodId]);
  const foreignEnv = makeEnvelope("ci-d1-stale-family-owner");
  await assert.rejects(
    commit(foreignEnv, "addition", prepare(foreignEnv, result("addition", "ci-d1-foreign-observation"))),
    /family-ineligible/,
    "changed food family ownership must not leak another user's identity");
  await sql.query("UPDATE foods SET owner_user_id=? WHERE id=?", [userId, foodId]);
  await sql.query("UPDATE foods SET status='deprecated' WHERE id=?", [foodId]);
  const retiredEnv = makeEnvelope("ci-d1-stale-family-status");
  await assert.rejects(
    commit(retiredEnv, "addition", prepare(retiredEnv, result("addition", "ci-d1-retired-observation"))),
    /family-ineligible/,
    "retired food family must not be written from an old resolver decision");
  await sql.query("UPDATE foods SET status='active' WHERE id=?", [foodId]);
  const [unchangedFamilyWrites] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(unchangedFamilyWrites.c), 1,
    "family revocation must not leave a partial meal");

  const orphanEnv = makeEnvelope("ci-d1-continuation-without-original");
  const orphan = result("continuation", "ci-d1-orphan");
  orphan.items[0].decision.revision = 2;
  await assert.rejects(
    commit(orphanEnv, "continuation", prepare(orphanEnv, orphan)),
    /food-d1-orphan-continuation/,
    "a new operation must never be bootstrapped from a forged previous decision");

  // Cross-meal negative: an item ID belonging to the same user must not
  // override the destination named in the canonical operation.
  const wrongMealEnv = makeEnvelope("ci-d1-edit-wrong-meal");
  wrongMealEnv.mealOperation = {
    ...wrongMealEnv.mealOperation!, targetMeal: "jantar",
  };
  await assert.rejects(
    commit(wrongMealEnv, "edit",
      prepare(wrongMealEnv, result("edit", "ci-d1-wrong-meal-obs", replacement, itemId))),
    /target-meal-mismatch/,
    "a valid physical target owned by this user still belongs to another meal",
  );
  const [afterWrongMeal] = await rows(
    "SELECT foodVariantId FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(afterWrongMeal.foodVariantId), first.variantId,
    "failed wrong-meal edit must not modify the existing physical item");
  const [afterWrongMealReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, wrongMealEnv.idempotencyKey]);
  assert.equal(Number(afterWrongMealReceipts.c), 0,
    "failed wrong-meal edit must not write a durable effect receipt");

  // Same label, other day: a stale physical ID may not override the
  // operation's canonical date, even when the owner and food both match.
  const wrongDateEnv = makeEnvelope("ci-d1-edit-wrong-date");
  wrongDateEnv.mealOperation = {
    ...wrongDateEnv.mealOperation!, date: "2026-10-06",
  };
  const wrongDatePlan = prepareFoodD1NativeWrite({
    envelope: wrongDateEnv, authenticatedUserId: userId,
    result: { ...result("edit", "ci-d1-wrong-date-obs", replacement, itemId),
      operationKey: wrongDateEnv.idempotencyKey },
    source: "web", occurredAt: new Date("2026-10-06T12:00:00Z"),
  });
  await assert.rejects(
    commit(wrongDateEnv, "edit", wrongDatePlan),
    /target-meal-mismatch/,
    "an item from yesterday cannot be modified as today's meal",
  );
  const [afterWrongDate] = await rows(
    "SELECT foodVariantId FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(afterWrongDate.foodVariantId), first.variantId);
  const [afterWrongDateReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, wrongDateEnv.idempotencyKey]);
  assert.equal(Number(afterWrongDateReceipts.c), 0);

  const editEnv = makeEnvelope("ci-d1-native-edit");
  // A second interaction later on the SAME local day must still edit in place.
  const editPlan = prepareFoodD1NativeWrite({
    envelope: editEnv, authenticatedUserId: userId,
    result: { ...result("edit", "ci-d1-obs-edit", replacement, itemId),
      operationKey: editEnv.idempotencyKey },
    source: "web", occurredAt: new Date("2026-10-05T18:30:00Z"),
  });
  const edited = await commit(editEnv, "edit", editPlan);
  assert.deepEqual(edited.recordedItemIds, [itemId]);
  const [updated] = await rows("SELECT foodVariantId, calories FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(updated.foodVariantId), replacement.variantId,
    "edit replaces the physical item in place");
  const deferredEditEnv = makeEnvelope("ci-d1-edit-deferred");
  const deferredEdit = result("edit", "ci-d1-edit-deferred-obs", replacement, itemId);
  deferredEdit.items[0].disposition = "deferred";
  deferredEdit.items[0].reasonCodes = ["quantity_missing"];
  deferredEdit.readyCount = 0;
  deferredEdit.skippedCount = 1;
  const deferredEditResult = await commit(deferredEditEnv, "edit",
    prepare(deferredEditEnv, deferredEdit));
  assert.equal(deferredEditResult.committed, false);
  const forbiddenContinuation = result("continuation",
    "ci-d1-edit-deferred-obs", replacement);
  forbiddenContinuation.items[0].decision.revision = 2;
  await assert.rejects(
    commit(deferredEditEnv, "continuation",
      prepare(deferredEditEnv, forbiddenContinuation)),
    /deferred-sibling-origin-not-addition/,
    "a pending edit must not be converted into an unrelated meal addition");

  const labelEnv = makeEnvelope("ci-d1-native-label");
  const oldLabel = prepare(labelEnv, result("nutrition_label", "ci-d1-obs-label", first, itemId));
  await assert.rejects(commit(labelEnv, "nutrition_label", oldLabel),
    /target-stale-or-foreign/, "label must not silently change a selected food");
  const [unchanged] = await rows("SELECT foodVariantId FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(unchanged.foodVariantId), replacement.variantId);
  const matchingLabelEnv = makeEnvelope("ci-d1-native-verified-label");
  const matchingLabelPlan = prepare(matchingLabelEnv,
    result("nutrition_label", "ci-d1-label-positive", replacement, itemId));
  const matchingLabel = await commit(matchingLabelEnv, "nutrition_label", matchingLabelPlan);
  assert.deepEqual(matchingLabel.recordedItemIds, [itemId],
    "a verified compatible label must update the existing physical item in place");
  const [matchingLabelReceipt] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, matchingLabelEnv.idempotencyKey]);
  assert.equal(Number(matchingLabelReceipt.c), 1);

  // Verified labels may revise the profile but cannot silently change the
  // quantity a user previously logged: mass/portion edits need a separate
  // explicitly authorized operation. The denial must leave no effect receipt.
  const driftEnv = makeEnvelope("ci-d1-label-quantity-drift");
  const driftBatch = result("nutrition_label", "ci-d1-label-drift-observation", replacement, itemId);
  const driftDecision = driftBatch.items[0].decision;
  driftDecision.quantity = {
    ...driftDecision.quantity, value: 3, grams: 60,
  };
  const gramsEvidence = driftDecision.evidence.find(
    evidence => evidence.evidenceId === "ev-grams",
  );
  if (!gramsEvidence) {
    throw new Error("CI quantity drift fixture requires grams evidence");
  }
  gramsEvidence.value = 60;
  if (!driftDecision.nutrition.consumed) {
    throw new Error("CI verified label fixture requires consumed nutrition");
  }
  driftDecision.nutrition = {
    ...driftDecision.nutrition,
    consumed: {
      ...driftDecision.nutrition.consumed,
      calories: 162, protein: 7.2, carbs: 1.8, fat: 13.8,
      sodiumMg: 540,
    },
  };
  await assert.rejects(
    commit(driftEnv, "nutrition_label", prepare(driftEnv, driftBatch)),
    /food-d1-native-label-quantity-changed/,
    "label OCR must not overwrite the quantity recorded with a confirmed item",
  );
  const [afterQuantityDrift] = await rows(
    "SELECT quantity, grams, estimatedGrams FROM mealItems WHERE id=?", [itemId],
  );
  assert.equal(Number(afterQuantityDrift.quantity), 1.5);
  assert.equal(Number(afterQuantityDrift.grams), 30);
  const [driftReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, driftEnv.idempotencyKey],
  );
  assert.equal(Number(driftReceipts.c), 0,
    "rejected nutrition label drift must not generate a durable effect");

  // A label update is a physical edit too: a different destination cannot
  // silently relabel an otherwise verified item from this same user's meal.
  const wrongLabelMealEnv = makeEnvelope("ci-d1-label-wrong-meal");
  wrongLabelMealEnv.mealOperation = {
    ...wrongLabelMealEnv.mealOperation!, targetMeal: "jantar",
  };
  const wrongLabelPlan = prepare(wrongLabelMealEnv,
    result("nutrition_label", "ci-d1-label-wrong-meal-obs", replacement, itemId));
  await assert.rejects(commit(wrongLabelMealEnv, "nutrition_label", wrongLabelPlan),
    /target-meal-mismatch/);
  const [afterWrongLabel] = await rows(
    "SELECT foodVariantId FROM mealItems WHERE id=?", [itemId]);
  assert.equal(Number(afterWrongLabel.foodVariantId), replacement.variantId);
  const [afterWrongLabelReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, wrongLabelMealEnv.idempotencyKey]);
  assert.equal(Number(afterWrongLabelReceipts.c), 0,
    "wrong meal label update must not leave a receipt");

  const [total] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(total.c), 1, "label and edit must not create another meal");

  // Two separate route-store instances race to commit the very first effect.
  const concurrentEnv = makeEnvelope("ci-d1-native-concurrent");
  const concurrentPlan = prepare(concurrentEnv,
    result("addition", "ci-d1-obs-concurrent"));
  const concurrent = await Promise.all([
    commit(concurrentEnv, "addition", concurrentPlan),
    commit(concurrentEnv, "addition", concurrentPlan),
  ]);
  assert.deepEqual(concurrent[0].recordedItemIds, concurrent[1].recordedItemIds,
    "parallel workers must return one physical receipt");
  const [concurrentItems] = await rows(
    "SELECT COUNT(*) AS c FROM mealItems WHERE id=?",
    [concurrent[0].recordedItemIds[0]],
  );
  assert.equal(Number(concurrentItems.c), 1, "concurrent insert must commit once");
  const [concurrentReceipts] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, concurrentEnv.idempotencyKey],
  );
  assert.equal(Number(concurrentReceipts.c), 1);

  await sql.query(
    "UPDATE food_source_read_grants SET status='revoked', revoked_at=NOW(), allow_read=0 WHERE source_id=?",
    [sourceId],
  );
  const revokedEnv = makeEnvelope("ci-d1-revoked-source");
  await assert.rejects(commit(revokedEnv, "addition",
    prepare(revokedEnv, result("addition", "ci-d1-obs-revoked"))),
    /source-revoked-or-unlicensed/);
  const [afterRevoke] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(afterRevoke.c), 2, "source revocation is checked in the write transaction");
  // Public repository readback of a real D1 transaction, not just a mocked
  // projection. Changing the CURRENT profile must never recompute history.
  const publicReader = createDrizzleMealsRepository({
    getDb,
    onWarning: (scope, error) => {
      throw new Error("food-d1-public-reader-failed:" + scope, { cause: error });
    },
  });
  const beforeProfileChange = await publicReader.findConfirmedByUserId(userId, {
    includeMedia: false,
  });
  const originalMeal = beforeProfileChange?.find(entry => entry.id === Number(created.mealId));
  assert.ok(originalMeal, "D1 committed meal must be visible in the public reader");
  assert.deepEqual(originalMeal.items.map(item => item.historicalRef), [
    "variant:" + replacement.variantId, "variant:" + first.variantId,
  ], "the reader must preserve both exact physical V2 variants");
  assert.deepEqual(originalMeal.items.map(item => item.calories), [81, 81]);
  const exposedMeals = await listMeals(userId);
  const publiclyReturnedMeal = exposedMeals.find(entry => entry.id === Number(created.mealId));
  assert.ok(publiclyReturnedMeal, "the authenticated web meal service must expose persisted V2 history");
  assert.deepEqual(publiclyReturnedMeal.items.map(item => item.historicalRef),
    originalMeal.items.map(item => item.historicalRef),
    "the public service must retain item variant identifiers without a new food lookup");
  assert.deepEqual(publiclyReturnedMeal.items.map(item => item.calories), [81, 81]);
  // This modifies only the disposable CI fixture's current knowledge. No real
  // data, production flags or licensed source records are touched.
  await sql.query(
    "UPDATE food_nutrition_profiles SET calories_kcal=910 WHERE id=?",
    [first.profileId],
  );
  const afterProfileChange = await publicReader.findConfirmedByUserId(userId, {
    includeMedia: false,
  });
  const unchangedMeal = afterProfileChange?.find(entry => entry.id === Number(created.mealId));
  assert.ok(unchangedMeal);
  assert.deepEqual(unchangedMeal.items, originalMeal.items,
    "a current profile change must not rewrite historical identity or macros");
  assert.equal(unchangedMeal.items[1].calories, 81,
    "the historical macro must come from the persisted receipt");

  // Durable D1 web review lookup: real TiDB owner isolation, stable request
  // identity, replay after a new service call and evidence-erasing confirmation.
  const webKey = "d1-web-" + userId + ":ci-web-tidb-replay";
  const webOriginalRequest = {
    source: "web" as const, d1OperationId: "ci-web-tidb-replay",
    mealLabel: "Almoço", occurredAt: "2026-10-05T12:00",
    text: "30 g de mortadela",
  };
  const webTrace = traceFoodD1WebSubmission({
    operationKey: webKey, entrypoint: "text", request: webOriginalRequest,
  });
  const webEnvelope = buildFoodOperationEnvelopeFixture({
    ownerUserId: userId, idempotencyKey: webKey, traceId: webTrace,
    effectiveTimeZone: "UTC",
    mealOperation: { action: "add", targetMeal: "Almoço", date: "2026-10-05" },
    revisions: { code: expectedSha },
  });
  const webObservation = buildFoodObservationFixture({
    observationId: "ci-web-obs-1", rawInput: null, normalizedInput: null,
    lexiconRevision: webEnvelope.revisions.lexicon,
  });
  await createFoodD1RouteDbStore().bindPinnedRoute({
    ownerUserId: userId, operationKey: webKey,
    resolver: "v2", originEntrypoint: "text",
    operationScopeHash: hashFoodD1OperationScope(webEnvelope, "web"),
    versions: webEnvelope.revisions,
  });
  const webDraftId = "ci-web-tidb-draft-01";
  const webDraftPayload = {
    draft: {
      resolver: "food-v2" as const, operationKey: webKey,
      entrypoint: "text" as const, mealLabel: "Almoço",
      occurredAt: occurredAt.toISOString(),
      items: [{
        observationId: webObservation.observationId,
        foodName: "Mortadela", quantity: 30, unit: "g",
        disposition: "ready" as const, reasonCodes: [],
        nutrition: { verified: true, calories: 81,
          protein: 3.6, carbs: 0.9, fat: 6.9 },
      }],
    },
    envelope: webEnvelope, occurredAt, observations: [webObservation],
  };
  await saveFoodD1WebDraft({
    draftId: webDraftId, ownerUserId: userId,
    operationKey: webKey, payload: webDraftPayload,
  });
  const secondSameWeb = await saveFoodD1WebDraft({
    draftId: "ci-web-tidb-racing-02", ownerUserId: userId,
    operationKey: webKey, payload: webDraftPayload,
  });
  assert.equal(secondSameWeb.status, "pending");
  if (secondSameWeb.status !== "pending") {
    throw new Error("Concurrent D1 web draft must retain its first owner");
  }
  assert.equal(secondSameWeb.payload.draft.draftId, webDraftId,
    "a same-operation racing insert must reuse the original public draft ID");
  await assert.rejects(saveFoodD1WebDraft({
    draftId: "ci-web-tidb-conflict-03", ownerUserId: userId,
    operationKey: webKey,
    payload: {
      ...webDraftPayload,
      envelope: { ...webEnvelope, traceId: "d1-trace-changed-media" },
    },
  }), /food-d1-public-web-draft-operation-scope-changed/,
  "a racing conflicting source may not adopt the winning review");
  const [uniqueWeb] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_web_drafts WHERE owner_user_id=? AND operation_key=?",
    [userId, webKey],
  );
  assert.equal(Number(uniqueWeb.c), 1);
  const recoveredWeb = await getFoodD1WebDraftByOperationKey({
    ownerUserId: userId, operationKey: webKey,
  });
  assert.equal(recoveredWeb?.status, "pending");
  if (!recoveredWeb || recoveredWeb.status !== "pending") {
    throw new Error("D1 TiDB web draft must be rehydrated as pending");
  }
  assert.equal(checkedFoodD1WebReplay({
    record: recoveredWeb, operationKey: webKey, traceId: webTrace,
    entrypoint: "text", ownerUserId: userId, mealLabel: "Almoço",
    occurredAt, timeZone: "UTC", revisions: webEnvelope.revisions,
  }).draftId, webDraftId);
  assert.deepEqual(recoveredWeb.payload.observations.map(o => o.observationId),
    [webObservation.observationId]);
  assert.equal(await getFoodD1WebDraftByOperationKey({
    ownerUserId: otherUser, operationKey: webKey,
  }), null, "other users must not read another owner's draft");
  assert.equal(await getFoodD1WebDraftByOperationKey({
    ownerUserId: userId, operationKey: webKey,
    now: new Date(Date.now() + 31 * 60_000),
  }), null, "expired web drafts cannot be rehydrated");
  await assert.rejects(async () => checkedFoodD1WebReplay({
    record: recoveredWeb, operationKey: webKey,
    traceId: traceFoodD1WebSubmission({
      operationKey: webKey, entrypoint: "text",
      request: { ...webOriginalRequest, text: "40 g de mortadela" },
    }),
    entrypoint: "text", ownerUserId: userId, mealLabel: "Almoço",
    occurredAt, timeZone: "UTC", revisions: webEnvelope.revisions,
  }), /operation-scope-changed/);
  // Leave an independent pending review in the disposable TiDB so the
  // separate Node process can prove rehydration without its in-memory caches.
  const restartWebId = "ci-web-cross-process";
  const restartWebKey = "d1-web-" + userId + ":" + restartWebId;
  const restartRequest = { ...webOriginalRequest, d1OperationId: restartWebId };
  const restartTrace = traceFoodD1WebSubmission({
    operationKey: restartWebKey, entrypoint: "text",
    request: restartRequest,
  });
  const restartEnvelope = {
    ...webEnvelope, idempotencyKey: restartWebKey, traceId: restartTrace,
  };
  await createFoodD1RouteDbStore().bindPinnedRoute({
    ownerUserId: userId, operationKey: restartWebKey,
    resolver: "v2", originEntrypoint: "text",
    operationScopeHash: hashFoodD1OperationScope(restartEnvelope, "web"),
    versions: restartEnvelope.revisions,
  });
  await saveFoodD1WebDraft({
    draftId: "ci-web-cross-process-draft", ownerUserId: userId,
    operationKey: restartWebKey,
    payload: {
      ...webDraftPayload,
      envelope: restartEnvelope,
      draft: { ...webDraftPayload.draft, operationKey: restartWebKey },
    },
  });

  const confirmedReceipt = {
    draftId: webDraftId, operationKey: webKey,
    confirmationHash: "a".repeat(64),
    committed: true, replayed: false, mealId: Number(created.mealId),
    recordedItemIds: [itemId], skipped: [],
  };
  await sql.query(
    "UPDATE food_d1_web_drafts SET status='confirmed', payload_json=NULL, confirmation_json=? WHERE owner_user_id=? AND operation_key=?",
    [JSON.stringify(confirmedReceipt), userId, webKey],
  );
  const recoveredConfirmed = await getFoodD1WebDraftByOperationKey({
    ownerUserId: userId, operationKey: webKey,
  });
  assert.equal(recoveredConfirmed?.status, "confirmed");
  assert.ok(recoveredConfirmed && !("payload" in recoveredConfirmed),
    "confirmed operation must erase rehydratable evidence");
  const [redacted] = await rows(
    "SELECT payload_json FROM food_d1_web_drafts WHERE owner_user_id=? AND operation_key=?",
    [userId, webKey],
  );
  assert.equal(redacted.payload_json, null);
  // The receipt must outlive the short web-review TTL. Simulate retention
  // cleanup after a native effect and ensure the old idempotency key cannot
  // create another pending draft or start an expensive provider call.
  await sql.query(
    "INSERT INTO food_d1_user_operation_effects (owner_user_id, operation_key, observation_id, decision_hash, outcome_json) VALUES (?, ?, 'ci-web-obs-1', ?, ?)",
    [userId, webKey, "d".repeat(64), JSON.stringify({
      mealId: Number(created.mealId), itemId,
    })],
  );
  await sql.query(
    "DELETE FROM food_d1_web_drafts WHERE owner_user_id=? AND operation_key=?",
    [userId, webKey],
  );
  await assert.rejects(getFoodD1WebDraftByOperationKey({
    ownerUserId: userId, operationKey: webKey,
  }), /food-d1-web-draft-operation-already-committed/,
  "a committed operation must not invoke the provider again after review cleanup");
  await assert.rejects(saveFoodD1WebDraft({
    draftId: "ci-web-resurrection-attempt", ownerUserId: userId,
    operationKey: webKey, payload: webDraftPayload,
  }), /food-d1-web-draft-operation-already-committed/,
  "a committed operation cannot recreate its pending review under the route lock");
  const [resurrected] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_web_drafts WHERE owner_user_id=? AND operation_key=?",
    [userId, webKey],
  );
  assert.equal(Number(resurrected.c), 0,
    "receipt survives cleanup without recreating a new draft");

  // Run the REAL authenticated-web service boundary in an isolated TiDB:
  // the persistent V1 operation binding and receipt must survive retries,
  // including two requests racing on the same operation key.
  const publicManual = (d1OperationId: string) => ({
    mealLabel: "Almoço",
    occurredAt: "2026-10-05T12:00:00.000Z",
    d1OperationId,
    items: [{
      foodName: "Arroz CI", canonicalName: "Arroz CI",
      portionText: "100 g", quantity: 100, unit: "g",
      servings: 1, estimatedGrams: 100, calories: 130, protein: 3,
      carbs: 28, fat: 1, confidence: 1, source: "catalog" as const,
    }],
  });
  const manualId = "ci-public-manual-d1-0001";
  const [priorManualMeals] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  const manualFirst = await createManualMeal(userId, publicManual(manualId), "UTC");
  const manualRetry = await createManualMeal(userId, publicManual(manualId), "UTC");
  assert.equal(manualRetry.id, manualFirst.id, "V1 public retry must return the existing committed meal");
  const [firstReceipt] = await rows(
    "SELECT decision_hash, outcome_json FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=? AND observation_id='__manual_v1_confirmed'",
    [userId, "d1-manual-" + userId + ":" + manualId],
  );
  assert.ok(firstReceipt, "one durable receipt must bind the public V1 manual operation");
  assert.equal(JSON.parse(String(firstReceipt.outcome_json)).mealId, manualFirst.id);
  await assert.rejects(
    createManualMeal(userId, {
      ...publicManual(manualId),
      items: [{ ...publicManual(manualId).items[0], calories: 9999 }],
    }, "UTC"),
    /food-d1-legacy-operation-scope-changed/,
    "reusing an operation ID with changed macros must not create another meal",
  );
  const concurrentId = "ci-public-manual-d1-concurrent";
  const [concurrentFirst, concurrentRetry] = await Promise.all([
    createManualMeal(userId, publicManual(concurrentId), "UTC"),
    createManualMeal(userId, publicManual(concurrentId), "UTC"),
  ]);
  assert.equal(concurrentFirst.id, concurrentRetry.id,
    "two independent public callers must share the same V1 meal and receipt");
  const [manualCount] = await rows("SELECT COUNT(*) AS c FROM meals WHERE userId=?", [userId]);
  assert.equal(Number(manualCount.c), Number(priorManualMeals.c) + 2);
  const [concurrentCount] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, "d1-manual-" + userId + ":" + concurrentId],
  );
  assert.equal(Number(concurrentCount.c), 1, "concurrent V1 operation must write exactly one receipt");

  // The preceding negative test revoked the original synthetic source. A
  // separate positive fixture must explicitly authorize its source again,
  // without weakening the transaction's live-grant check.
  await sql.query(
    "UPDATE food_source_read_grants SET status='approved', revoked_at=NULL, allow_read=1 WHERE source_id=?",
    [sourceId],
  );
  const publicVariant = await seedVariant("Mortadela public D1");

  // Public WhatsApp D1 boundary -> native route -> REAL TiDB transaction ->
  // confirmed meal readback -> reply, with synthetic verified decision injected.
  // This is deliberately NOT a Golden Corpus/real Gate A test (#1335).
  const priorEnabled = process.env.FOOD_V2_D1_ENABLED;
  const priorSelection = process.env.FOOD_V2_D1_ENTRYPOINTS;
  process.env.FOOD_V2_D1_ENABLED = "true";
  process.env.FOOD_V2_D1_ENTRYPOINTS = "text,audio_transcript";
  try {
    const makePublic = (modality: "text" | "audio_transcript") =>
      createWhatsAppD1RegistrationService({
        readAuthorizedContext: async () => ({
          approval, expectedAuditedBaseSha: expectedSha,
          revisions: { ...makeEnvelope("ci-public-whatsapp").revisions, code: expectedSha },
        }),
        readActivePending: hasActiveWhatsappPendingInDb,
        parseOperation: () => ({
          intent: "add_items_to_meal" as const,
          mealType: "Almoço", date: occurredAt,
          items: [{ foodName: "Mortadela", brand: null, quantity: 30, unit: "g",
            confidence: 1, missingFields: [] }],
          confidence: 1, missingFields: [],
        }),
        run: async args => {
          assert.equal(args.request.entrypoint, modality);
          assert.equal(args.request.envelope.ownerUserId, userId);
          const env = args.request.envelope;
          const syntheticBatch = result(modality, "ci-public-whatsapp-" + modality, publicVariant);
          syntheticBatch.operationKey = env.idempotencyKey;
          syntheticBatch.traceId = env.traceId;
          syntheticBatch.items[0].decision.traceId = env.traceId;
          const plan = prepareFoodD1NativeWrite({
            envelope: env, result: syntheticBatch,
            authenticatedUserId: userId, source: "whatsapp", occurredAt,
          });
          args.beforeCommit?.(syntheticBatch);
          return routeFoodD1Operation({
            envelope: env, authenticatedUserId: userId, entrypoint: modality,
            source: "whatsapp", store: createFoodD1RouteDbStore(),
            expectedAuditedBaseSha: expectedSha, verifyGates: async () => approval,
            enabled: true, runV1: args.legacy,
            runV2: () => commitFoodD1NativeWrite({
              plan, testEnabled: true, verifyCurrentGate: async () => true,
            }),
          });
        },
      });
    const publicInput = (modality: "text" | "audio_transcript", externalMessageId: string) => ({
      userId, originalText: "Adicionar ao almoço 30 g de mortadela",
      externalMessageId, modality, receivedAt: occurredAt, timeZone: "UTC",
    });
    const textBridge = makePublic("text");
    const firstPublic = await textBridge(publicInput("text", "wamid-ci-d1-public-text-001"));
    const replayedPublic = await textBridge(publicInput("text", "wamid-ci-d1-public-text-001"));
    assert.equal(firstPublic?.action, "meal_item_added");
    assert.equal(replayedPublic?.data?.mealId, firstPublic?.data?.mealId,
      "public text replay on a fresh route store must preserve native meal identity");
    assert.ok(firstPublic?.reply.includes("Mortadela"),
      "public reply must be built from the persisted native V2 meal");
    const audioBridge = makePublic("audio_transcript");
    const firstAudio = await audioBridge(publicInput("audio_transcript", "wamid-ci-d1-public-audio-001"));
    assert.equal(firstAudio?.action, "meal_item_added");
    await assert.rejects(
      audioBridge(publicInput("audio_transcript", "wamid-ci-d1-public-text-001")),
      /food-d1-entrypoint-changed-during-operation/,
      "one external message cannot switch text to audio and create another meal");
    await assert.rejects(
      textBridge({ ...publicInput("text", "wamid-ci-d1-public-text-001"),
        originalText: "Adicionar ao almoço 29 g de mortadela" }),
      /food-d1-operation-scope-changed/,
      "same external ID with altered payload must not claim an old receipt");
    // A-004: unlike the controlled receipt test above, exercise the ACTUAL
    // canonical LCL, governed knowledge, resolver, native runner and TiDB
    // transaction through the trusted public WhatsApp entrypoint. Only the
    // external Gate A provider is replaced by a synthetic approval fixture.
    // The synthetic write fixture never needed a verifiable HTTPS source or
    // a historical grant date. The REAL governed reader must have both, for
    // the operation's original 2026-10-05 instant.
    await sql.query("UPDATE food_sources SET source_url='https://example.invalid/ci-d1' WHERE id=?", [sourceId]);
    await sql.query("UPDATE food_source_read_grants SET approved_at='2026-09-01 00:00:00' WHERE source_id=?", [sourceId]);
    const fullPublic = createWhatsAppD1RegistrationService({
      readAuthorizedContext: async () => ({
        approval, expectedAuditedBaseSha: expectedSha,
        revisions: { ...makeEnvelope("ci-public-whatsapp").revisions, code: expectedSha },
      }),
      readActivePending: hasActiveWhatsappPendingInDb,
      lexicon: { load: async () => [] },
      knowledge: createFoodV2KnowledgeRepository(),
    });
    const fullInput = {
      userId, externalMessageId: "wamid-ci-d1-real-resolver",
      originalText: "Adicionar ao almoço 30 g de Mortadela public D1",
      modality: "text" as const, receivedAt: occurredAt, timeZone: "UTC",
    };
    const actualDecision = await fullPublic(fullInput);
    assert.equal(actualDecision?.action, "meal_item_added",
      "real public route must resolve and write one governed food");
    assert.ok(actualDecision?.reply.includes("Mortadela public D1"));
    const actualReplay = await fullPublic(fullInput);
    assert.equal(actualReplay?.data?.mealId, actualDecision?.data?.mealId,
      "native V2 retry must return the same physical meal");
    const [realEffects] = await rows(
      "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
      [userId, "d1-whatsapp-" + (await import("node:crypto")).createHash("sha256")
        .update(JSON.stringify([userId, fullInput.externalMessageId])).digest("hex")],
    );
    assert.equal(Number(realEffects.c), 1,
      "one real resolver decision may write only one physical effect");
    // A-004: public web draft -> canonical LCL/resolver -> native commit,
    // with exact review content, durable draft receipt, replay and owner denial.
    // These are disposable, synthetic records; not Gate A or production traffic.
    const webBridge = createFoodD1PublicWebDraft({
      readAuthorizedContext: async () => ({
        approval, expectedAuditedBaseSha: expectedSha,
        revisions: { ...makeEnvelope("ci-public-web").revisions, code: expectedSha },
      }),
      lexicon: { load: async () => [] },
      knowledge: createFoodV2KnowledgeRepository(),
    });
    const webDraftRequest = {
      source: "web" as const, d1OperationId: "ci-d1-live-web-submission",
      mealLabel: "Almoço", occurredAt: "2026-10-05T12:00",
      text: "30 g de Mortadela public D1",
    };
    const webDraft = await webBridge.tryRunFoodD1PublicWebDraft({
      userId, request: webDraftRequest, timeZone: "UTC",
    });
    assert.ok(webDraft && webDraft.items.length === 1,
      "public web draft must return one original food observation");
    assert.equal(webDraft.items[0].disposition, "ready",
      "verified governed food and explicit grams must produce a confirmable draft");
    const webConfirmationRequest = {
      draftId: webDraft.draftId, mealLabel: webDraft.mealLabel,
      occurredAt: webDraftRequest.occurredAt,
      items: webDraft.items.map(item => ({
        observationId: item.observationId, foodName: item.foodName,
        quantity: item.quantity, unit: item.unit,
      })),
    };
    const webReceipt = await webBridge.confirmFoodD1PublicWebDraft({
      userId, request: webConfirmationRequest, timeZone: "UTC",
      occurredAt: new Date("2026-10-05T12:00:00Z"),
    });
    assert.equal(webReceipt.committed, true);
    assert.equal(webReceipt.recordedItemIds.length, 1);
    const webReplay = await webBridge.confirmFoodD1PublicWebDraft({
      userId, request: webConfirmationRequest, timeZone: "UTC",
      occurredAt: new Date("2026-10-05T12:00:00Z"),
    });
    assert.equal(webReplay.mealId, webReceipt.mealId);
    assert.equal(webReplay.replayed, true,
      "confirmed web retry must return the same durable receipt");
    await assert.rejects(webBridge.confirmFoodD1PublicWebDraft({
      userId: foreignPendingUserId, request: webConfirmationRequest,
      timeZone: "UTC", occurredAt: new Date("2026-10-05T12:00:00Z"),
    }), /Rascunho V2 n.o encontrado|food-d1-web-draft/i,
    "a different user cannot confirm the same physical web draft");
    const [publicEffects] = await rows(
      "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key LIKE 'd1-whatsapp-%'",
      [userId],
    );
    assert.equal(Number(publicEffects.c), 3,
      "only three distinct authorized public operations may create effects");
  } finally {
    if (priorEnabled === undefined) delete process.env.FOOD_V2_D1_ENABLED;
    else process.env.FOOD_V2_D1_ENABLED = priorEnabled;
    if (priorSelection === undefined) delete process.env.FOOD_V2_D1_ENTRYPOINTS;
    else process.env.FOOD_V2_D1_ENTRYPOINTS = priorSelection;
  }

  // A full durable continuation round-trip through the same real TiDB
  // transaction adapter; exercises user lock, stable scope, readback,
  // duplicate submission, optimistic version, replay fence and consumption.
  // Still synthetic, never interpreted as post-deploy Gate A or user traffic.
  const pendingEnvelope: FoodOperationEnvelope = {
    ...makeEnvelope("ci-d1-whatsapp-pending"),
    mealOperation: { action: "add", targetMeal: "Almoço", date: "2026-10-05" },
    effectiveTimeZone: "UTC",
  };
  const pendingObservation = buildFoodObservationFixture({
    observationId: "ci-d1-pending-original-observation",
    lexiconRevision: pendingEnvelope.revisions.lexicon,
    rawInput: null, normalizedInput: null,
  });
  const pendingDecision: FoodResolutionDecision = {
    ...makeDecision(pendingObservation.observationId),
    traceId: pendingEnvelope.traceId,
    status: "partially_resolved", nextAction: "clarify",
    unresolvedFields: ["quantity"],
    reasonCodes: ["quantity_missing"],
  };
  await routeFoodD1Operation({
    envelope: pendingEnvelope, authenticatedUserId: userId,
    entrypoint: "text", source: "whatsapp",
    store: createFoodD1RouteDbStore(), expectedAuditedBaseSha: expectedSha,
    verifyGates: async () => approval, enabled: true,
    runV1: async () => { throw new Error("cannot stage pending into V1"); },
    runV2: async () => "synthetic-d1-pending-route-pinned",
  });
  const pendingPayload = {
    schemaVersion: 2 as const, envelope: pendingEnvelope,
    originEntrypoint: "text" as const, occurredAt: occurredAt.toISOString(),
    observations: [pendingObservation], decisions: [pendingDecision],
    unresolvedIds: [pendingObservation.observationId],
  };
  const firstPending = await stageFoodD1WhatsAppPending(pendingPayload);
  const repeatedPending = await stageFoodD1WhatsAppPending(pendingPayload);
  assert.equal(repeatedPending.id, firstPending.id,
    "retry must return the same durable active pending with no second insert");
  const reloadedPending = await readActiveFoodD1WhatsAppPending(userId);
  assert.equal(reloadedPending?.id, firstPending.id);
  assert.equal(reloadedPending?.target.envelope.idempotencyKey,
    pendingEnvelope.idempotencyKey);
  assert.equal(await readActiveFoodD1WhatsAppPending(foreignPendingUserId), null,
    "one owner's V2 pending must not leak into another owner");
  await assert.rejects(stageFoodD1WhatsAppPending({
    ...pendingPayload, occurredAt: new Date("2026-10-06T12:00:00Z").toISOString(),
  }), /food-d1-whatsapp-pending-payload-changed/,
  "same original key cannot silently switch the event date");
  await assert.rejects(stageFoodD1WhatsAppPending({
    ...pendingPayload, envelope: {
      ...pendingEnvelope, idempotencyKey: "ci-d1-other-whatsapp-pending",
    },
  }), /food-d1-whatsapp-pending-route-unavailable/,
  "a new unpinned operation cannot steal an active original pending");
  const maliciousPendingUpdate = {
    ...pendingPayload,
    observations: [{
      ...pendingObservation, identityHints: {
        ...pendingObservation.identityHints, foodName: "changed after confirmation",
      },
    }],
  };
  await assert.rejects(updateFoodD1WhatsAppPending(
    firstPending, maliciousPendingUpdate, userId,
  ), /food-d1-whatsapp-pending-material-fact-mutation/,
  "durable clarification cannot replace the original material food identity");
  const changedPending = {
    ...pendingPayload,
    decisions: [{ ...pendingDecision, revision: pendingDecision.revision + 1 }],
  };
  const updatedPending = await updateFoodD1WhatsAppPending(
    firstPending, changedPending, userId,
  );
  assert.equal(updatedPending.version, firstPending.version + 1);
  await assert.rejects(updateFoodD1WhatsAppPending(
    firstPending, pendingPayload, userId,
  ), /food-d1-whatsapp-pending-stale-update/,
  "an older context cannot overwrite an answered clarification");
  const inboundId = "wamid-ci-d1-continuation-001";
  await foodD1WhatsAppReplayFence.pinContinuationInbound({
    ownerUserId: userId, externalMessageId: inboundId,
    envelope: pendingEnvelope,
  });
  await assert.rejects(foodD1WhatsAppReplayFence.rejectPreviouslyV2OwnedInbound({
    ownerUserId: userId, externalMessageId: inboundId,
  }), /food-d1-whatsapp-inbound-already-v2-owned/,
  "a duplicate continuation inbound cannot fall through to V1 after restart");
  await consumeFoodD1WhatsAppPending(updatedPending, userId);
  assert.equal(await readActiveFoodD1WhatsAppPending(userId), null,
    "after final confirmation pending must be durably consumed");
  await assert.rejects(consumeFoodD1WhatsAppPending(updatedPending, userId),
    /food-d1-whatsapp-pending-consume-conflict/,
  "a completed pending cannot be consumed twice or reopened");

  // A-001: real owner-scoped DB context at the public V2 boundary, not a
  // hardcoded 'unavailable'. Only opaque references leave these SQL reads.
  const contextAt = new Date(Date.now() + 60_000);
  const ctxPrefs = await insert(
    "INSERT INTO userPreferences (userId, preferenceKey, preferenceValue) VALUES (?, 'food.synthetic.coffee', 'sem acucar')",
    [userId],
  );
  const ctxConversation = await insert(
    "INSERT INTO whatsappConversations (userId, phoneNumber) VALUES (?, '+550000000001')",
    [userId],
  );
  const insertInbound = (id: string, when: Date) => insert(
    "INSERT INTO whatsappConversationMessages (conversationId, userId, direction, contentType, externalMessageId, idempotencyKey, occurredAt) VALUES (?, ?, 'inbound', 'text', ?, ?, ?)",
    [ctxConversation, userId, id, "whatsapp:inbound:" + id, when],
  );
  const priorContextId = await insertInbound(
    "wamid-ci-context-previous", new Date(contextAt.getTime() - 5 * 60_000),
  );
  await insertInbound("wamid-ci-context-current", contextAt);
  const inspected = await readFoodD1PublicContextSources({
    ownerUserId: userId, source: "whatsapp",
    at: contextAt, externalMessageId: "wamid-ci-context-current",
  });
  assert.equal(inspected.previousMessage.status, "available");
  assert.equal(inspected.previousMessage.sourceRef, "whatsapp-message:" + priorContextId);
  assert.equal(inspected.preferences.status, "available");
  assert.ok(inspected.preferences.sourceRef?.startsWith("food-preference:" + ctxPrefs + ":"));
  assert.equal(inspected.recentHistory.status, "available");
  assert.ok(inspected.recentHistory.sourceRef?.startsWith("food-history-meal:"));
  assert.ok(!JSON.stringify(inspected).includes("sem acucar"),
    "raw preference contents must not be persisted as an operation context");
  const webContext = await readFoodD1PublicContextSources({
    ownerUserId: userId, source: "web", at: contextAt,
  });
  assert.equal(webContext.previousMessage.status, "not_applicable");
  assert.equal(webContext.preferences.status, "available");
  assert.equal(webContext.recentHistory.status, "available");
  const foreignContext = await readFoodD1PublicContextSources({
    ownerUserId: foreignPendingUserId, source: "whatsapp",
    at: contextAt, externalMessageId: "wamid-ci-context-current",
  });
  assert.equal(foreignContext.previousMessage.status, "unavailable",
    "another owner must not discover the conversation");
  assert.equal(foreignContext.preferences.status, "absent",
    "another owner must not inherit preferences");
  await assert.rejects(readFoodD1PublicContextSources({
    ownerUserId: 0, source: "web", at: contextAt,
  }), /food-d1-context-invalid-owner-or-time/);
  await insertInbound("wamid-ci-context-later", new Date(contextAt.getTime() + 40 * 60_000));
  const expiredContext = await readFoodD1PublicContextSources({
    ownerUserId: userId, source: "whatsapp",
    at: new Date(contextAt.getTime() + 40 * 60_000),
    externalMessageId: "wamid-ci-context-later",
  });
  assert.equal(expiredContext.previousMessage.status, "expired",
    "expired previous conversation context must not be silently reused");
  console.log("PASS: D1 owner-scoped context sources, TTL, privacy and cross-user denials");

  // Leave a DIFFERENT original operation pending at process exit. The
  // subsequent test file runs in a new Node process and must recover it.
  const whatsappRestartEnvelope: FoodOperationEnvelope = {
    ...pendingEnvelope, idempotencyKey: "ci-d1-whatsapp-restart-pending",
  };
  await routeFoodD1Operation({
    envelope: whatsappRestartEnvelope, authenticatedUserId: userId,
    entrypoint: "text", source: "whatsapp",
    store: createFoodD1RouteDbStore(), expectedAuditedBaseSha: expectedSha,
    verifyGates: async () => approval, enabled: true,
    runV1: async () => { throw new Error("cross-process pending must belong to V2"); },
    runV2: async () => "synthetic-d1-pending-restart-route",
  });
  const restartPayload = {
    ...pendingPayload, envelope: whatsappRestartEnvelope,
  };
  const toRecover = await stageFoodD1WhatsAppPending(restartPayload);
  assert.equal((await readActiveFoodD1WhatsAppPending(userId))?.id, toRecover.id,
    "the final original V2 pending must remain durable for the next Node process");
  console.log("PASS: D1 TiDB native transaction/retry/scope/edit/label/source revocation and public V1 exactly-once", {
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
