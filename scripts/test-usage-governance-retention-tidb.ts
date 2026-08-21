import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { purgeUsageGovernanceRetention } from "../server/repositories/usageGovernanceRetentionRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the usage governance retention integration test.");
}

const ids = {
  heldProfessionalGrant: "usage-retention-held-professional",
  heldUserGrant: "usage-retention-held-user",
  unrelatedProfessionalGrant: "usage-retention-unrelated-professional",
  userHold: "usage-retention-user-hold",
  audit: "usage-retention-audit",
};

async function main() {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 4,
    ...(process.env.TIDB_ENABLE_SSL === "true"
      ? { ssl: { minVersion: "TLSv1.2" as const } }
      : {}),
  });

  const heldSubjectId = "9181";
  const unrelatedSubjectId = "9182";

  async function cleanup() {
    await pool.query(
      "DELETE FROM billingUsageRetentionAudit WHERE id = ?",
      [ids.audit],
    );
    await pool.query(
      "DELETE FROM billingUsageAllowanceGrants WHERE id IN (?, ?, ?)",
      [
        ids.heldProfessionalGrant,
        ids.heldUserGrant,
        ids.unrelatedProfessionalGrant,
      ],
    );
    await pool.query(
      "DELETE FROM billingUsageLegalHolds WHERE id = ?",
      [ids.userHold],
    );
  }

  try {
    await cleanup();

    await pool.query(
      `INSERT INTO billingUsageLegalHolds
        (id, scopeType, scopeId, reason, startsAt, endsAt, activeScopeKey, createdByUserId)
       VALUES (?, 'user', ?, 'retention integration hold', '2020-01-01 00:00:00', NULL, ?, 1)`,
      [ids.userHold, heldSubjectId, `user:${heldSubjectId}`],
    );

    const grantRows = [
      [ids.heldProfessionalGrant, "professional", heldSubjectId],
      [ids.heldUserGrant, "user", heldSubjectId],
      [ids.unrelatedProfessionalGrant, "professional", unrelatedSubjectId],
    ] as const;

    for (const [id, subjectType, subjectId] of grantRows) {
      await pool.query(
        `INSERT INTO billingUsageAllowanceGrants
          (id, subjectType, subjectId, grantType, additionalUnits, reason, startsAt, endsAt, state, createdByUserId, revokedByUserId, revokedAt)
         VALUES (?, ?, ?, 'temporary_exemption', NULL, 'retention integration grant',
                 '2019-01-01 00:00:00', '2020-01-01 00:00:00', 'revoked', 1, 1, '2020-01-02 00:00:00')`,
        [id, subjectType, subjectId],
      );
    }

    await purgeUsageGovernanceRetention({
      now: new Date("2026-08-16T12:00:00.000Z"),
      detailedCutoff: new Date("2025-07-16T12:00:00.000Z"),
      dailyCutoff: new Date("2024-08-16T12:00:00.000Z"),
      monthlyCutoff: new Date("2021-08-16T12:00:00.000Z"),
      governanceCutoff: new Date("2021-08-16T12:00:00.000Z"),
      ruleVersion: "retention-integration",
      auditId: ids.audit,
    });

    const [rows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT id FROM billingUsageAllowanceGrants WHERE id IN (?, ?, ?) ORDER BY id",
      [
        ids.heldProfessionalGrant,
        ids.heldUserGrant,
        ids.unrelatedProfessionalGrant,
      ],
    );
    const remaining = new Set(rows.map(row => String(row.id)));

    assert.equal(
      remaining.has(ids.heldProfessionalGrant),
      true,
      "a user legal hold must preserve the matching professional-scoped allowance grant",
    );
    assert.equal(
      remaining.has(ids.heldUserGrant),
      true,
      "a user legal hold must preserve the matching user-scoped allowance grant",
    );
    assert.equal(
      remaining.has(ids.unrelatedProfessionalGrant),
      false,
      "a user legal hold must not preserve an unrelated professional-scoped allowance grant",
    );

    console.log("usage governance retention legal-hold integration: passed");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
