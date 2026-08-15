import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { INITIAL_BILLING_CATALOG } from "../server/modules/billing/catalogPolicy";
import { createBillingCatalogRepository } from "../server/repositories/billingCatalogRepository";
import { createBillingProfessionalCoverageRepository } from "../server/repositories/billingProfessionalCoverageRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the capacity alert integration test.");
}

const ids = {
  professional: 9690,
  admin: 9691,
  patientStart: 9700,
  subscription: "billing-alert-lifecycle-subscription",
};

function jsonValue(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  return value as Record<string, unknown>;
}

async function main() {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 8,
    ...(process.env.TIDB_ENABLE_SSL === "true"
      ? { ssl: { minVersion: "TLSv1.2" as const } }
      : {}),
  });
  const db = drizzle(pool);
  const repositoryDeps = {
    getDb: async () => db,
    onWarning: () => undefined,
  };
  const catalogRepository = createBillingCatalogRepository(repositoryDeps);
  const coverageRepository =
    createBillingProfessionalCoverageRepository(repositoryDeps);
  const patientIds = Array.from({ length: 101 }, (_, index) => ids.patientStart + index);
  const userIds = [ids.professional, ids.admin, ...patientIds];

  async function cleanup() {
    await pool.query("DELETE FROM billingSubscriptionFacts WHERE subscriptionId = ?", [
      ids.subscription,
    ]);
    await pool.query("DELETE FROM billingCapacityAllocations WHERE subscriptionId = ?", [
      ids.subscription,
    ]);
    await pool.query("DELETE FROM billingSubscriptionLifecycle WHERE subscriptionId = ?", [
      ids.subscription,
    ]);
    await pool.query("DELETE FROM billingSubscriptions WHERE id = ?", [ids.subscription]);
    await pool.query(
      `DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
  }

  async function insertAllocations(patientSubset: number[]) {
    if (patientSubset.length === 0) return;
    const placeholders = patientSubset.map(() => "(?, ?, ?, ?, ?, 'active')").join(",");
    const values = patientSubset.flatMap(patientUserId => [
      `billing-alert-allocation-${patientUserId}`,
      ids.subscription,
      ids.professional,
      patientUserId,
      `billing-alert-coverage:${patientUserId}`,
    ]);
    await pool.query(
      `INSERT INTO billingCapacityAllocations (
        id, subscriptionId, professionalUserId, patientUserId, coverageKey, state
      ) VALUES ${placeholders}`,
      values
    );
  }

  async function alertPayloads() {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT payloadJson
       FROM billingSubscriptionFacts
       WHERE subscriptionId = ?
         AND factType = 'professional_capacity_admin_alert_opened'`,
      [ids.subscription]
    );
    return rows.map(row => jsonValue(row.payloadJson));
  }

  async function warningPayloads() {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT payloadJson
       FROM billingSubscriptionFacts
       WHERE subscriptionId = ?
         AND factType = 'professional_capacity_warning'`,
      [ids.subscription]
    );
    return rows.map(row => jsonValue(row.payloadJson));
  }

  async function extensionPayloads() {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT payloadJson
       FROM billingSubscriptionFacts
       WHERE subscriptionId = ?
         AND factType = 'professional_capacity_extension_granted'
       ORDER BY createdAt ASC`,
      [ids.subscription]
    );
    return rows.map(row => jsonValue(row.payloadJson));
  }

  async function factCount(factType: string) {
    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total
       FROM billingSubscriptionFacts
       WHERE subscriptionId = ? AND factType = ?`,
      [ids.subscription, factType]
    );
    return Number(rows[0]?.total ?? 0);
  }

  function requireAlertByEventKey(
    alerts: Record<string, unknown>[],
    alertEventKey: string
  ) {
    const alert = alerts.find(item => item.alertEventKey === alertEventKey);
    assert.ok(alert, `expected alert event ${alertEventKey}`);
    return alert;
  }

  try {
    await cleanup();
    await catalogRepository.seedInitialCatalog(INITIAL_BILLING_CATALOG);

    const [planRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT p.id, p.capacityLimit
       FROM billingPlans p
       WHERE p.audience = 'professional'
         AND p.capacityLimit = 30
         AND p.active = true
         AND p.status = 'active'
       ORDER BY p.effectiveFrom DESC
       LIMIT 1`
    );
    assert.equal(planRows.length, 1, "the professional 30-seat plan must exist");
    const planId = String(planRows[0]!.id);

    const [rangeRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT MAX(capacityLimit) AS highestPublicCapacity
       FROM billingPlans
       WHERE audience = 'professional'
         AND active = true
         AND status = 'active'
         AND effectiveFrom <= NOW()
         AND (effectiveUntil IS NULL OR effectiveUntil > NOW())`
    );
    assert.equal(
      Number(rangeRows[0]?.highestPublicCapacity),
      100,
      "the public professional catalog range must top out at 100 seats"
    );

    const userPlaceholders = userIds.map(() => "(?, ?, ?, ?, ?)").join(",");
    const userValues = userIds.flatMap(userId => [
      userId,
      `billing-alert-user-${userId}`,
      `Billing alert user ${userId}`,
      `billing-alert-user-${userId}@example.com`,
      userId === ids.admin ? "admin" : "user",
    ]);
    await pool.query(
      `INSERT INTO users (id, openId, name, email, role) VALUES ${userPlaceholders}`,
      userValues
    );

    await pool.query(
      `INSERT INTO billingSubscriptions (
        id, provider, payerUserId, planId, externalSubscriptionId, status,
        activeHolderPlanKey, currentPeriodStart, currentPeriodEnd,
        createdAt, updatedAt
      ) VALUES (?, 'manual', ?, ?, ?, 'active', ?, ?, ?, NOW(), NOW())`,
      [
        ids.subscription,
        ids.professional,
        planId,
        "billing-alert-lifecycle-external",
        `${ids.professional}:${planId}:alert-lifecycle`,
        new Date("2026-08-01T00:00:00.000Z"),
        new Date("2027-08-01T00:00:00.000Z"),
      ]
    );
    await pool.query(
      `INSERT INTO billingSubscriptionLifecycle (
        subscriptionId, audience, state, revision, createdAt, updatedAt
      ) VALUES (?, 'professional', 'active', 1, NOW(), NOW())`,
      [ids.subscription]
    );

    await insertAllocations(patientIds.slice(0, 45));
    const startedAt = new Date("2026-08-14T12:00:00.000Z");
    const initial = await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      startedAt
    );
    assert.equal(initial?.state, "grandfathered_active");
    assert.equal(initial?.occupancy, 45);
    assert.ok(initial?.temporaryEndsAt);

    let alerts = await alertPayloads();
    assert.equal(alerts.length, 1, "initial crossing must create one alert");
    const initialAlert = alerts.find(
      alert => alert.alertTrigger === "initial_exceeded_capacity"
    );
    assert.ok(initialAlert, "initial crossing must persist its alert identity");
    assert.equal(initialAlert.kind, "capacity_exceeded");
    assert.equal(initialAlert.priority, "normal");
    assert.equal(initialAlert.occupancy, 45);

    await insertAllocations(patientIds.slice(45));
    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      new Date("2026-08-15T12:00:00.000Z")
    );
    alerts = await alertPayloads();
    assert.equal(alerts.length, 2, "crossing the public range must reopen once");
    const rangeAlert = requireAlertByEventKey(
      alerts,
      "catalog_range_review_required:100"
    );
    assert.equal(rangeAlert.kind, "catalog_range_review_required");
    assert.equal(rangeAlert.priority, "high");
    assert.equal(rangeAlert.alertTrigger, "catalog_range_crossed");
    assert.equal(rangeAlert.occupancy, 101);

    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      new Date("2026-08-15T12:05:00.000Z")
    );
    assert.equal(
      (await alertPayloads()).length,
      2,
      "retry after range crossing must not duplicate the alert"
    );

    const firstEndsAt = initial!.temporaryEndsAt!;
    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      firstEndsAt
    );
    alerts = await alertPayloads();
    assert.equal(alerts.length, 3, "unresolved expiry must reopen the alert once");
    const firstExpiryAlert = requireAlertByEventKey(
      alerts,
      `grandfathering_expired:${firstEndsAt.toISOString()}`
    );
    assert.equal(firstExpiryAlert.alertTrigger, "grandfathering_expired");

    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      new Date(firstEndsAt.getTime() + 60_000)
    );
    assert.equal(
      (await alertPayloads()).length,
      3,
      "retry after expiry must not duplicate the alert"
    );

    const firstDecision = {
      subscriptionId: ids.subscription,
      actorUserId: ids.admin,
      decisionId: "capacity-alert-lifecycle:extension-01",
      reason: "Capacity alert lifecycle integration",
      analysisStatus: "temporary_exception_approved",
    };
    const extension = await coverageRepository.grantCapacityExtension({
      ...firstDecision,
      now: firstEndsAt,
    });
    const extensionRetry = await coverageRepository.grantCapacityExtension({
      ...firstDecision,
      now: new Date(firstEndsAt.getTime() + 60_000),
    });
    assert.deepEqual(
      [extensionRetry.startsAt.toISOString(), extensionRetry.endsAt.toISOString()],
      [extension.startsAt.toISOString(), extension.endsAt.toISOString()],
      "retrying one administrative decision must return the persisted extension instead of adding 30 days"
    );
    assert.equal(
      (await extensionPayloads()).filter(
        payload => payload.decisionId === firstDecision.decisionId
      ).length,
      1,
      "one decision identity must persist exactly one extension fact"
    );

    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      firstEndsAt
    );
    const extensionStartWarnings = (await warningPayloads()).filter(
      warning => warning.temporaryEndsAt === extension.endsAt.toISOString()
    );
    assert.deepEqual(
      extensionStartWarnings.map(warning => [
        warning.milestone,
        warning.daysRemaining,
      ]),
      [["started", 30]],
      "a 30-day extension must not backfill D60/D30 warnings that predate or coincide with its start"
    );

    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      extension.endsAt
    );
    alerts = await alertPayloads();
    assert.equal(
      alerts.length,
      4,
      "a later unresolved extension horizon must reopen the alert independently"
    );
    const extensionExpiryAlert = requireAlertByEventKey(
      alerts,
      `grandfathering_expired:${extension.endsAt.toISOString()}`
    );
    assert.equal(extensionExpiryAlert.alertTrigger, "grandfathering_expired");

    await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      new Date(extension.endsAt.getTime() + 60_000)
    );
    assert.equal(
      (await alertPayloads()).length,
      4,
      "retry after extension expiry must remain idempotent"
    );

    const concurrentDecision = {
      subscriptionId: ids.subscription,
      actorUserId: ids.admin,
      decisionId: "capacity-alert-lifecycle:extension-02",
      reason: "Concurrent retry identity coverage",
      analysisStatus: "temporary_exception_approved",
      now: extension.endsAt,
    };
    const [concurrentA, concurrentB] = await Promise.all([
      coverageRepository.grantCapacityExtension(concurrentDecision),
      coverageRepository.grantCapacityExtension(concurrentDecision),
    ]);
    assert.deepEqual(
      [concurrentB.startsAt.toISOString(), concurrentB.endsAt.toISOString()],
      [concurrentA.startsAt.toISOString(), concurrentA.endsAt.toISOString()],
      "concurrent delivery of one decision must converge on one persisted extension"
    );
    assert.equal(
      (await extensionPayloads()).filter(
        payload => payload.decisionId === concurrentDecision.decisionId
      ).length,
      1,
      "concurrent delivery must not duplicate the extension fact"
    );

    let latestExtension = concurrentA;
    for (let index = 3; index <= 20; index += 1) {
      latestExtension = await coverageRepository.grantCapacityExtension({
        subscriptionId: ids.subscription,
        actorUserId: ids.admin,
        decisionId: `capacity-alert-lifecycle:extension-${String(index).padStart(2, "0")}`,
        reason: `Long-lived window extension ${index}`,
        analysisStatus: "temporary_exception_approved",
        now: latestExtension.endsAt,
      });
    }
    assert.equal(
      (await extensionPayloads()).length,
      20,
      "the fixture must cross the former mixed-history page boundary"
    );

    const afterLongHistory = await coverageRepository.reconcileProfessionalCapacity(
      ids.subscription,
      latestExtension.startsAt
    );
    assert.equal(
      afterLongHistory?.grandfatheredAt?.toISOString(),
      startedAt.toISOString(),
      "rehydration after 20 extensions must retain the original grandfathering identity"
    );
    assert.equal(
      await factCount("professional_capacity_grandfathered_started"),
      1,
      "crossing the history page boundary must never manufacture a new 90-day window"
    );

    const twentyFirst = await coverageRepository.grantCapacityExtension({
      subscriptionId: ids.subscription,
      actorUserId: ids.admin,
      decisionId: "capacity-alert-lifecycle:extension-21",
      reason: "Explicit decision after long-lived history",
      analysisStatus: "temporary_exception_approved",
      now: latestExtension.endsAt,
    });
    assert.equal(
      twentyFirst.startsAt.toISOString(),
      latestExtension.endsAt.toISOString(),
      "a new decision after long history must extend from the durable current horizon"
    );
    assert.equal(
      twentyFirst.endsAt.getTime() - twentyFirst.startsAt.getTime(),
      30 * 86_400_000,
      "each distinct administrative decision must add exactly 30 days"
    );
    assert.equal(
      (await extensionPayloads()).length,
      21,
      "a distinct decision identity must create exactly one additional extension"
    );
  } finally {
    await cleanup().catch(() => undefined);
    await pool.end();
  }
}

void main();
