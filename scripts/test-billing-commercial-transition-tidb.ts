import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import {
  reconcileBillingCommercialTransition,
  runBillingCommercialTransitionBatch,
} from "../server/modules/billing/billingCommercialTransition";
import { billingCommercialTransitionRunSchema } from "../server/modules/billing/billingCommercialTransitionSchemas";
import { configureBillingDbProvider } from "../server/repositories/billingRepositorySupport";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the commercial transition integration test.");
}

const ids = {
  actor: 92900,
  frozenA: 92901,
  frozenB: 92902,
  lateBackfill: 92903,
};
const userIds = Object.values(ids);
const cutoverKey = "integration-snapshot-freeze-v1";
const provider = "billing-commercial-transition";
const sourcePrefix = `commercial-cutover:${cutoverKey}:`;

async function main() {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 4,
    ...(process.env.TIDB_ENABLE_SSL === "true"
      ? { ssl: { minVersion: "TLSv1.2" as const } }
      : {}),
  });
  const db = drizzle(pool);

  // The transition module resolves persistence through server/db.ts, which in
  // turn honors this provider. Reuse the pool owned by this integration test
  // so the process has a single TiDB pool and the finally block can close it.
  configureBillingDbProvider(async () => db);

  async function cleanup() {
    await pool.query(
      "DELETE FROM billingAccessAuditEvents WHERE subjectUserId IN (?, ?, ?, ?) OR actorUserId = ?",
      [ids.actor, ids.frozenA, ids.frozenB, ids.lateBackfill, ids.actor]
    );
    await pool.query(
      "DELETE FROM billingEntitlements WHERE sourceType = 'transition' AND LEFT(sourceId, CHAR_LENGTH(?)) = ?",
      [sourcePrefix, sourcePrefix]
    );
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = ? AND INSTR(providerEventId, ?) > 0",
      [provider, cutoverKey]
    );
    await pool.query(
      "DELETE FROM users WHERE id IN (?, ?, ?, ?)",
      [ids.actor, ids.frozenA, ids.frozenB, ids.lateBackfill]
    );
  }

  function userRow(userId: number, createdAt: Date, role = "user") {
    return [
      userId,
      `commercial-transition-${userId}`,
      `Commercial Transition ${userId}`,
      `commercial-transition-${userId}@example.com`,
      role,
      createdAt,
    ];
  }

  try {
    await cleanup();
    const cutoverAt = new Date(Date.now() - 5 * 60 * 1000);
    const beforeCutover = new Date(cutoverAt.getTime() - 60 * 1000);
    const afterCutover = new Date(cutoverAt.getTime() + 60 * 1000);

    await pool.query(
      "INSERT INTO users (id, openId, name, email, role, createdAt) VALUES (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?)",
      [
        ...userRow(ids.actor, afterCutover, "admin"),
        ...userRow(ids.frozenA, beforeCutover),
        ...userRow(ids.frozenB, beforeCutover),
      ]
    );

    const parsedInput = billingCommercialTransitionRunSchema.parse({
      cutoverKey,
      cutoverAt: cutoverAt.toISOString(),
      timezone: "America/Sao_Paulo",
      reason: "integration frozen snapshot verification",
      dryRun: false,
      batchSize: 1,
      retryFailed: false,
      confirmation: cutoverKey,
    });
    const baseInput = { ...parsedInput, actorUserId: ids.actor };

    assert.equal(
      new Date(baseInput.cutoverAt).getMilliseconds(),
      0,
      "validated cutover instant must match TIMESTAMP storage precision"
    );

    const first = await runBillingCommercialTransitionBatch(baseInput);
    assert.equal(first.candidateCount, 1);
    assert.equal(first.processed, 1);
    assert.equal(first.failed, 0);
    assert.equal(first.snapshotEligibleCount, 2);
    assert.match(first.snapshotPopulationSha256, /^[a-f0-9]{64}$/);

    const [initialSnapshotRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingProviderEvents WHERE provider = ? AND eventType = 'commercial_transition_snapshot_member' AND LEFT(providerEventId, CHAR_LENGTH(?)) = ?",
      [provider, `snapshot:${cutoverKey}:`, `snapshot:${cutoverKey}:`]
    );
    assert.equal(Number(initialSnapshotRows[0]?.total), 2, "snapshot must freeze only the users present at cutover creation");

    await pool.query(
      "INSERT INTO users (id, openId, name, email, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      userRow(ids.lateBackfill, beforeCutover)
    );

    await pool.query("DELETE FROM users WHERE id = ?", [ids.frozenB]);
    const second = await runBillingCommercialTransitionBatch(baseInput);
    assert.equal(second.candidateCount, 1, "checkpoint must continue through the frozen cohort");
    assert.equal(second.processed, 0);
    assert.equal(second.failed, 1, "a temporarily missing snapshot member must be recorded as a retryable failure");
    assert.equal(second.checkpointAfter, ids.frozenB, "checkpoint may advance past a failed frozen member");

    await pool.query(
      "INSERT INTO users (id, openId, name, email, role, createdAt) VALUES (?, ?, ?, ?, ?, ?)",
      userRow(ids.frozenB, afterCutover)
    );

    const retry = await runBillingCommercialTransitionBatch({
      ...baseInput,
      batchSize: 10,
      retryFailed: true,
    });
    assert.equal(retry.candidateCount, 1, "retry must rediscover the failed member from the frozen snapshot, not the checkpoint");
    assert.equal(retry.processed, 1);
    assert.equal(retry.failed, 0);

    const exhausted = await runBillingCommercialTransitionBatch({
      ...baseInput,
      batchSize: 10,
    });
    assert.equal(exhausted.candidateCount, 0, "a user backfilled after snapshot creation must never enter the frozen cohort");

    const [transitionRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT beneficiaryUserId FROM billingEntitlements WHERE sourceType = 'transition' AND LEFT(sourceId, CHAR_LENGTH(?)) = ? ORDER BY beneficiaryUserId",
      [sourcePrefix, sourcePrefix]
    );
    assert.deepEqual(
      transitionRows.map(row => Number(row.beneficiaryUserId)),
      [ids.frozenA, ids.frozenB],
      "re-execution must preserve exactly the original snapshot population"
    );

    const [lateRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingEntitlements WHERE beneficiaryUserId = ? AND sourceType = 'transition' AND LEFT(sourceId, CHAR_LENGTH(?)) = ?",
      [ids.lateBackfill, sourcePrefix, sourcePrefix]
    );
    assert.equal(Number(lateRows[0]?.total), 0, "late backfill must not receive the cutover entitlement");

    const reconciliation = await reconcileBillingCommercialTransition({ cutoverKey });
    assert.equal(reconciliation.eligibleCount, 2);
    assert.equal(reconciliation.snapshotMemberCount, 2);
    assert.equal(reconciliation.snapshotIntegrityOk, true);
    assert.equal(reconciliation.grantedCount, 2);
    assert.equal(reconciliation.failedCount, 0);
    assert.equal(reconciliation.reconciled, true);

    const [manifestRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT payloadJson FROM billingProviderEvents WHERE provider = ? AND providerEventId = ? LIMIT 1",
      [provider, `cutover:${cutoverKey}`]
    );
    const manifest = JSON.parse(String(manifestRows[0]?.payloadJson ?? "{}"));
    assert.equal(manifest.snapshotState, "ready");
    assert.equal(manifest.snapshotRuleVersion, "users-created-at-lte-cutover-v1");
    assert.equal(manifest.eligibleCount, 2);
    assert.match(String(manifest.populationSha256), /^[a-f0-9]{64}$/);

    console.log("Commercial transition frozen snapshot integration passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
