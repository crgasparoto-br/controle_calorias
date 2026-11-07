/**
 * #1308 - A separate process must recover the pinned route and item receipt.
 * Synthetic TiDB fixture only; never a production Gate A authorization.
 */
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { buildFoodOperationEnvelopeFixture, buildFoodResolutionDecisionFixture } from "../server/modules/foodIntelligenceV2/fixtures";
import { getFoodD1WebDraftByOperationKey, saveFoodD1WebDraft } from "../server/modules/foodIntelligenceV2/publicWebDraftRepository";
import { checkedFoodD1WebReplay, traceFoodD1WebSubmission } from "../server/modules/foodIntelligenceV2/publicWebDraftIdentity";
import { prepareFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistence";
import { commitFoodD1NativeWrite } from "../server/modules/foodIntelligenceV2/entrypointPersistenceRepository";
import { createFoodD1RouteDbStore } from "../server/modules/foodIntelligenceV2/entrypointRouteRepository";
import { routeFoodD1Operation } from "../server/modules/foodIntelligenceV2/entrypointRouting";
import { createManualMeal } from "../server/modules/meals/service";
import { readActiveFoodD1WhatsAppPending,
  consumeFoodD1WhatsAppPending } from "../server/modules/foodIntelligenceV2/publicWhatsAppPendingRepository";
import { foodD1WhatsAppReplayFence } from "../server/modules/foodIntelligenceV2/publicWhatsAppReplayFence";
import type { FoodD1Result } from "../server/modules/foodIntelligenceV2/entrypointMigration";
import type { FoodOperationEnvelope, FoodResolutionDecision } from "../server/modules/foodIntelligenceV2/schemas";

const url = process.env.DATABASE_URL;
if (process.env.NODE_ENV !== "test" ||
    process.env.FOOD_V2_TEST_DB_ISOLATED !== "1" ||
    !url || new URL(url).pathname !== "/ci_foodv2_upgrade") {
  throw new Error("D1 restart proof may only run against disposable TiDB test database");
}
const db = await mysql.createConnection(url);
const rows = async (query: string, params: unknown[] = []) =>
  (await db.query(query, params))[0] as Array<Record<string, unknown>>;
try {
  const [owner] = await rows("SELECT id FROM users WHERE openId='ci-d1-user'");
  const [food] = await rows("SELECT id FROM foods WHERE owner_user_id=? AND normalized_name='ci d1 food'", [owner?.id]);
  const [source] = await rows("SELECT id FROM food_sources WHERE slug='ci-d1-source'");
  const [variant] = await rows("SELECT id FROM food_variants WHERE identity_key='ci-d1:Mortadela'");
  const [profile] = await rows(
    "SELECT id FROM food_nutrition_profiles WHERE food_variant_id=? AND source_id=?",
    [variant?.id, source?.id],
  );
  const [existing] = await rows(
    "SELECT outcome_json FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key='ci-d1-native-add' AND observation_id='ci-d1-obs-1'",
    [owner?.id],
  );
  assert.ok(owner && food && source && variant && profile && existing,
    "all original operation references must remain durable across process restart");
  const oldReceipt = JSON.parse(String(existing.outcome_json)) as { itemId: number; mealId: number };
  const userId = Number(owner.id);
  // The first process staged a clarification with the original manifest.
  // Rehydrate it without a local conversation Map, legacy text replay or
  // a second inference call, then consume only the same authenticated owner.
  const recoveredWhatsAppPending = await readActiveFoodD1WhatsAppPending(userId);
  assert.ok(recoveredWhatsAppPending,
    "the other Node process must recover the durable WhatsApp D1 clarification");
  assert.equal(recoveredWhatsAppPending.target.envelope.idempotencyKey,
    "ci-d1-whatsapp-restart-pending");
  assert.equal(recoveredWhatsAppPending.target.observations.length, 1);
  assert.equal(recoveredWhatsAppPending.target.unresolvedIds.length, 1);
  const [otherOwner] = await rows("SELECT id FROM users WHERE openId='ci-d1-pending-owner'");
  assert.ok(otherOwner);
  assert.equal(await readActiveFoodD1WhatsAppPending(Number(otherOwner.id)), null,
    "another tenant cannot discover the original owner's pending context");
  await assert.rejects(consumeFoodD1WhatsAppPending(
    recoveredWhatsAppPending, Number(otherOwner.id),
  ), /food-d1-whatsapp-pending-consume-conflict/,
  "another owner cannot acknowledge a pending clarification");
  const continuedMessageId = "wamid-ci-d1-restarted-continuation";
  await foodD1WhatsAppReplayFence.pinContinuationInbound({
    ownerUserId: userId, externalMessageId: continuedMessageId,
    envelope: recoveredWhatsAppPending.target.envelope,
  });
  await assert.rejects(foodD1WhatsAppReplayFence.rejectPreviouslyV2OwnedInbound({
    ownerUserId: userId, externalMessageId: continuedMessageId,
  }), /food-d1-whatsapp-inbound-already-v2-owned/,
  "a resumed operation never becomes new V1 text after restart");
  await consumeFoodD1WhatsAppPending(recoveredWhatsAppPending, userId);
  assert.equal(await readActiveFoodD1WhatsAppPending(userId), null,
    "the separate process consumes the existing pending without reopening it");
  const restartWebId = "ci-web-cross-process";
  const restartWebKey = "d1-web-" + userId + ":" + restartWebId;
  const restartRequest = {
    source: "web" as const, d1OperationId: restartWebId,
    mealLabel: "Almoço", occurredAt: "2026-10-05T12:00",
    text: "30 g de mortadela",
  };
  const expectedWebTrace = traceFoodD1WebSubmission({
    operationKey: restartWebKey, entrypoint: "text",
    request: restartRequest,
  });
  const restartedWebDraft = await getFoodD1WebDraftByOperationKey({
    operationKey: restartWebKey, ownerUserId: userId,
  });
  assert.equal(restartedWebDraft?.status, "pending",
    "a separate process must recover the pending public V2 web review");
  if (!restartedWebDraft || restartedWebDraft.status !== "pending") {
    throw new Error("D1 cross-process web review was not persisted");
  }
  const pending = restartedWebDraft.payload;
  assert.equal(checkedFoodD1WebReplay({
    record: restartedWebDraft, operationKey: restartWebKey,
    traceId: expectedWebTrace, entrypoint: "text",
    ownerUserId: userId, mealLabel: restartRequest.mealLabel,
    occurredAt: new Date("2026-10-05T12:00:00.000Z"),
    timeZone: "UTC", revisions: pending.envelope.revisions,
  }).draftId, "ci-web-cross-process-draft");
  const raceReplay = await saveFoodD1WebDraft({
    draftId: "ci-web-cross-process-replay", ownerUserId: userId,
    operationKey: restartWebKey,
    payload: {
      envelope: pending.envelope, occurredAt: pending.occurredAt,
      draft: {
        resolver: pending.draft.resolver,
        operationKey: pending.draft.operationKey,
        entrypoint: pending.draft.entrypoint,
        mealLabel: pending.draft.mealLabel,
        occurredAt: pending.draft.occurredAt,
        items: pending.draft.items,
      },
      observations: pending.observations,
    },
  });
  assert.equal(raceReplay.status, "pending");
  if (raceReplay.status !== "pending") {
    throw new Error("D1 cross-process replay must remain a pending web review");
  }
  assert.equal(raceReplay.payload.draft.draftId, pending.draft.draftId,
    "new process must reuse the original draft ID rather than re-create it");
  const [draftRows] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_web_drafts WHERE owner_user_id=? AND operation_key=?",
    [userId, restartWebKey],
  );
  assert.equal(Number(draftRows.c), 1,
    "restart must preserve one web draft per stable owner/operation");
  const envelope = buildFoodOperationEnvelopeFixture({
    ownerUserId: userId, idempotencyKey: "ci-d1-native-add",
  }) as FoodOperationEnvelope;
  const decision = buildFoodResolutionDecisionFixture({
    ownerUserId: userId, observationIds: ["ci-d1-obs-1"],
    identity: { foodEntityId: Number(food.id),
      variantId: Number(variant.id), canonicalName: "Mortadela", variant: "Mortadela" },
    nutrition: { profileId: Number(profile.id), sourceId: Number(source.id),
      snapshotHash: "sha256:ci-d1-verified" },
    evidence: [{}, {}, { sourceId: Number(source.id) }],
  }) as FoodResolutionDecision;
  const sibling = buildFoodResolutionDecisionFixture({
    ownerUserId: userId, observationIds: ["ci-d1-missing"],
  }) as FoodResolutionDecision;
  const result: FoodD1Result = {
    schemaVersion: 2, operationKey: envelope.idempotencyKey,
    traceId: envelope.traceId, entrypoint: "addition",
    committed: false, registeredCount: 0, readyCount: 1, skippedCount: 1,
    items: [
      { observationId: "ci-d1-obs-1", mealItemId: null,
        decision, disposition: "ready", reasonCodes: [] },
      { observationId: "ci-d1-missing", mealItemId: null,
        decision: sibling, disposition: "deferred", reasonCodes: ["quantity_missing"] },
    ],
  };
  const plan = prepareFoodD1NativeWrite({
    envelope, result, authenticatedUserId: userId, source: "web",
    occurredAt: new Date("2026-10-05T12:00:00Z"),
  });
  const proof = {
    status: "approved" as const, gateAReference: "ci:fixture-only-gate-a",
    rolloutReference: "ci:fixture-only-rollout",
    auditedBaseSha: "a".repeat(40),
  };
  const replay = await routeFoodD1Operation({
    envelope, authenticatedUserId: userId, entrypoint: "addition",
    source: "web", store: createFoodD1RouteDbStore(),
    expectedAuditedBaseSha: proof.auditedBaseSha,
    verifyGates: async () => proof, enabled: true,
    runV1: async () => { throw new Error("restart must preserve the V2 owner"); },
    runV2: async () => commitFoodD1NativeWrite({
      plan, testEnabled: true, verifyCurrentGate: async () => true,
    }),
  });
  assert.deepEqual(replay.recordedItemIds, [oldReceipt.itemId]);
  assert.equal(replay.mealId, oldReceipt.mealId);
  const [receiptCount] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key='ci-d1-native-add'",
    [userId],
  );
  assert.equal(Number(receiptCount.c), 2,
    "restart must retain both the first item and the deferred sibling completed later");
  const [mealCount] = await rows("SELECT COUNT(*) AS c FROM mealItems WHERE mealId=?", [oldReceipt.mealId]);
  assert.equal(Number(mealCount.c), 2);
  const [pinned] = await rows(
    "SELECT revisions_json FROM food_d1_user_operation_routes WHERE owner_user_id=? AND operation_key='ci-d1-native-add'",
    [userId]);
  assert.deepEqual(JSON.parse(String(pinned.revisions_json)).observationIds,
    ["ci-d1-missing", "ci-d1-obs-1"]);
  // A new Node process must use the public manual endpoint's persisted V1
  // receipt rather than the previous process's mealStore or pending cache.
  const legacyId = "ci-public-manual-d1-0001";
  const manual = {
    mealLabel: "Almoço",
    occurredAt: "2026-10-05T12:00:00.000Z",
    d1OperationId: legacyId,
    items: [{
      foodName: "Arroz CI", canonicalName: "Arroz CI",
      portionText: "100 g", quantity: 100, unit: "g", servings: 1,
      estimatedGrams: 100, calories: 130, protein: 3, carbs: 28, fat: 1,
      confidence: 1, source: "catalog" as const,
    }],
  };
  const [legacyBefore] = await rows(
    "SELECT outcome_json FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=? AND observation_id='__manual_v1_confirmed'",
    [userId, "d1-manual-" + userId + ":" + legacyId],
  );
  assert.ok(legacyBefore, "public V1 receipt must exist before process restart");
  const expectedLegacyMealId = JSON.parse(String(legacyBefore.outcome_json)).mealId;
  const publicRetry = await createManualMeal(userId, manual, "UTC");
  assert.equal(publicRetry.id, expectedLegacyMealId,
    "new process must not create another manual V1 meal on retry");
  const [legacyAfter] = await rows(
    "SELECT COUNT(*) AS c FROM food_d1_user_operation_effects WHERE owner_user_id=? AND operation_key=?",
    [userId, "d1-manual-" + userId + ":" + legacyId],
  );
  assert.equal(Number(legacyAfter.c), 1);
  console.log("PASS: a separate process reused D1 V2 and public manual V1 route/receipts");
} catch (error) {
  console.error("FAIL: D1 cross-process retry", error);
  process.exitCode = 1;
} finally {
  await db.end();
  process.exit(process.exitCode || 0);
}
