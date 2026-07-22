import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { createDrizzleBillingRepository } from "../server/repositories/billingRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the billing integration test.");
}

const ids = {
  professional: 9181,
  patientA: 9182,
  patientB: 9183,
  admin: 9184,
  plan: "billing-test-professional-plan",
  subscription: "billing-test-subscription",
  authorizationA: "billing-test-authorization-a",
  authorizationB: "billing-test-authorization-b",
  providerEvent: "billing-test-provider-event",
};

function coverageKey(authorizationId: string) {
  return `professional-authorization:${authorizationId}`;
}

async function main() {
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8 });
  const db = drizzle(pool);
  const warnings: Array<{ scope: string; error: string }> = [];
  const repository = createDrizzleBillingRepository({
    getDb: async () => db,
    onWarning: (scope, error) =>
      warnings.push({
        scope,
        error: error instanceof Error ? error.message : "unknown",
      }),
  });
  const userIds = [ids.professional, ids.patientA, ids.patientB, ids.admin];

  async function cleanup() {
    await pool.query(
      `DELETE FROM billingAccessAuditEvents WHERE subjectUserId IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
    await pool.query(
      `DELETE FROM billingAdminOverrides WHERE userId IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
    await pool.query("DELETE FROM billingProviderEvents WHERE provider = ?", [
      "integration-test",
    ]);
    await pool.query(
      "DELETE FROM billingEntitlements WHERE sourceId IN (?, ?)",
      [coverageKey(ids.authorizationA), coverageKey(ids.authorizationB)]
    );
    await pool.query(
      "DELETE FROM billingCapacityAllocations WHERE coverageKey IN (?, ?)",
      [coverageKey(ids.authorizationA), coverageKey(ids.authorizationB)]
    );
    await pool.query("DELETE FROM billingSubscriptions WHERE id = ?", [
      ids.subscription,
    ]);
    await pool.query("DELETE FROM billingPlans WHERE id = ?", [ids.plan]);
    await pool.query(
      "DELETE FROM professionalPatientAuthorizations WHERE id IN (?, ?)",
      [ids.authorizationA, ids.authorizationB]
    );
    await pool.query(
      `DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
  }

  try {
    await cleanup();
    for (const userId of userIds) {
      await pool.query(
        "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, ?)",
        [
          userId,
          `billing-integration-${userId}`,
          `Billing User ${userId}`,
          `billing-integration-${userId}@example.com`,
          userId === ids.admin ? "admin" : "user",
        ]
      );
    }

    const now = new Date();
    for (const [authorizationId, patientUserId] of [
      [ids.authorizationA, ids.patientA],
      [ids.authorizationB, ids.patientB],
    ] as const) {
      await pool.query(
        `INSERT INTO professionalPatientAuthorizations (
          id, professionalUserId, patientUserId, status, activePairKey,
          reason, requestedAt, approvedAt, respondedAt, responseOrigin,
          responseDecision, sourceUpdatedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, 'web', 'approved', ?, ?, ?)`,
        [
          authorizationId,
          ids.professional,
          patientUserId,
          `${ids.professional}:${patientUserId}`,
          "Billing integration coverage",
          now,
          now,
          now,
          now,
          now,
          now,
        ]
      );
    }

    await pool.query(
      `INSERT INTO billingPlans (
        id, code, audience, name, currency, unitAmount, billingCycle,
        capacityLimit, entitlementsJson, active, createdAt, updatedAt
      ) VALUES (?, ?, 'professional', ?, 'BRL', 19900, 'monthly', 1, ?, true, NOW(), NOW())`,
      [
        ids.plan,
        "billing-integration-professional",
        "Billing integration professional",
        JSON.stringify(["professional_portfolio", "system_access"]),
      ]
    );
    await pool.query(
      `INSERT INTO billingSubscriptions (
        id, provider, payerUserId, planId, externalSubscriptionId, status,
        activeHolderPlanKey, currentPeriodStart, currentPeriodEnd,
        createdAt, updatedAt
      ) VALUES (?, 'manual', ?, ?, ?, 'active', ?, DATE_SUB(NOW(), INTERVAL 1 DAY),
        DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW())`,
      [
        ids.subscription,
        ids.professional,
        ids.plan,
        "billing-integration-subscription-external",
        `${ids.professional}:${ids.plan}`,
      ]
    );

    const competing = await Promise.all([
      repository.reserveProfessionalCapacity({
        professionalUserId: ids.professional,
        patientUserId: ids.patientA,
        coverageKey: coverageKey(ids.authorizationA),
      }),
      repository.reserveProfessionalCapacity({
        professionalUserId: ids.professional,
        patientUserId: ids.patientB,
        coverageKey: coverageKey(ids.authorizationB),
      }),
    ]);
    const winnerIndex = competing.findIndex(result => result.reserved);
    const loserIndex = competing.findIndex(result => !result.reserved);
    assert.notEqual(winnerIndex, -1, "one patient must reserve the last slot");
    assert.notEqual(loserIndex, -1, "one patient must be rejected at capacity");
    assert.deepEqual(competing[loserIndex], {
      reserved: false,
      reason: "capacity_exceeded",
    });

    const winnerAuthorization =
      winnerIndex === 0 ? ids.authorizationA : ids.authorizationB;
    const winnerPatient = winnerIndex === 0 ? ids.patientA : ids.patientB;
    const winnerKey = coverageKey(winnerAuthorization);
    const firstReservation = competing[winnerIndex];
    assert.equal(firstReservation.reserved, true);
    if (!firstReservation.reserved) throw new Error("unreachable");

    const retry = await repository.reserveProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
    });
    assert.deepEqual(
      retry,
      firstReservation,
      "reservation retry must be idempotent"
    );

    const [allocationRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingCapacityAllocations WHERE subscriptionId = ? AND state IN ('reserved', 'active')",
      [ids.subscription]
    );
    assert.equal(Number(allocationRows[0]?.total), 1);

    const candidates = await repository.listAccessCandidates(
      winnerPatient,
      new Date()
    );
    assert.equal(
      candidates.some(
        candidate => candidate.reason === "sponsored_by_professional"
      ),
      true,
      "approved coverage must grant a sponsored entitlement"
    );

    await repository.releaseProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
      reservationId: firstReservation.reservationId,
      reason: "integration_release",
    });
    await repository.releaseProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
      reservationId: firstReservation.reservationId,
      reason: "integration_release_retry",
    });
    const [releasedRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT state FROM billingCapacityAllocations WHERE coverageKey = ?",
      [winnerKey]
    );
    assert.equal(releasedRows[0]?.state, "released");
    assert.equal(
      (await repository.listAccessCandidates(winnerPatient, new Date())).some(
        candidate => candidate.reason === "sponsored_by_professional"
      ),
      false
    );

    const firstOverride = await repository.grantAdminOverride({
      userId: ids.patientA,
      reason: "Primeira liberação de integração",
      grantedByUserId: ids.admin,
    });
    const secondOverride = await repository.grantAdminOverride({
      userId: ids.patientA,
      reason: "Liberação substituta de integração",
      grantedByUserId: ids.admin,
    });
    assert.notEqual(firstOverride.id, secondOverride.id);
    const [overrideRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT state, COUNT(*) AS total FROM billingAdminOverrides WHERE userId = ? GROUP BY state",
      [ids.patientA]
    );
    assert.equal(
      overrideRows.reduce((sum, row) => sum + Number(row.total), 0),
      2,
      "replacement must preserve override history"
    );
    assert.equal(overrideRows.find(row => row.state === "active")?.total, 1);
    await repository.revokeAdminOverride({
      overrideId: secondOverride.id,
      revokedByUserId: ids.admin,
      reason: "Integração encerrada",
    });
    await repository.revokeAdminOverride({
      overrideId: secondOverride.id,
      revokedByUserId: ids.admin,
      reason: "Repetição idempotente",
    });

    const recorded = await repository.recordProviderEvent({
      provider: "integration-test",
      providerEventId: ids.providerEvent,
      eventType: "subscription.updated",
      metadata: {
        objectId: "subscription-external",
        status: "active",
        token: "must-not-be-persisted",
        cardNumber: "4111111111111111",
      },
    });
    const duplicate = await repository.recordProviderEvent({
      provider: "integration-test",
      providerEventId: ids.providerEvent,
      eventType: "subscription.updated",
      metadata: { status: "past_due", token: "another-secret" },
    });
    assert.equal(recorded.created, true);
    assert.deepEqual(duplicate, { id: recorded.id, created: false });
    const [eventRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT payloadJson FROM billingProviderEvents WHERE provider = ? AND providerEventId = ?",
      ["integration-test", ids.providerEvent]
    );
    assert.equal(eventRows.length, 1);
    const payload = JSON.stringify(eventRows[0]?.payloadJson ?? "");
    assert.equal(payload.includes("token"), false);
    assert.equal(payload.includes("411111"), false);

    const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action, COUNT(*) AS total FROM billingAccessAuditEvents WHERE subjectUserId IN (?, ?) GROUP BY action",
      [ids.patientA, ids.patientB]
    );
    const auditTotals = Object.fromEntries(
      auditRows.map(row => [String(row.action), Number(row.total)])
    );
    assert.equal(auditTotals.capacity_reserved, 1);
    assert.equal(auditTotals.capacity_released, 1);
    assert.equal(auditTotals.override_granted, 2);
    assert.equal(auditTotals.override_revoked, 2);
    assert.deepEqual(warnings, []);

    console.log(
      JSON.stringify({
        event: "billing.persistence.integration.passed",
        concurrentReservations: competing,
        providerEventIdempotent: true,
        auditTotals,
      })
    );
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
