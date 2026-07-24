import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createDrizzleProfessionalRepository } from "../server/repositories/professionalRepository";
import { createProfessionalAccessRequestReceiptRepository } from "../server/modules/professionals/accessRequestReceiptRepository";

const PROFESSIONAL_USER_ID = 8091;
const PATIENT_USER_ID = 8092;
const OUTSIDER_USER_ID = 8093;
const USER_IDS = [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID];
const AUTHORIZATION_ID = "access-receipt-tidb-879";
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the professional access receipt integration test."
  );
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );
  const integrationDb = drizzle(connection);
  const warnings: Array<{ scope: string; error: string }> = [];
  const onWarning = (scope: string, error: unknown) =>
    warnings.push({
      scope,
      error: error instanceof Error ? error.message : "unknown",
    });
  const repository = createDrizzleProfessionalRepository({
    getDb: async () => integrationDb,
    onWarning,
  });
  const receiptRepository =
    createProfessionalAccessRequestReceiptRepository({
      getDb: async () => integrationDb,
      onWarning,
      professionalRepository: repository,
      useDatabaseInTests: true,
    });

  async function cleanup() {
    await connection.query(
      "DELETE FROM professionalHistoryEvents WHERE professionalUserId = ? OR patientUserId IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM professionalPatientTrackingEvents WHERE professionalUserId = ? OR patientUserId IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM professionalPatientTrackings WHERE professionalUserId = ? OR patientUserId IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM professionalPatientAuthorizations WHERE professionalUserId = ? OR patientUserId IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM professionalProfiles WHERE userId = ?",
      [PROFESSIONAL_USER_ID]
    );
    await connection.query(
      `DELETE FROM users WHERE id IN (${USER_IDS.map(() => "?").join(",")})`,
      USER_IDS
    );
  }

  try {
    await cleanup();
    for (const userId of USER_IDS) {
      await connection.query(
        "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
        [
          userId,
          `professional-receipt-${userId}`,
          `Receipt User ${userId}`,
          `professional-receipt-${userId}@example.com`,
        ]
      );
    }

    await repository.upsertProfile({
      userId: PROFESSIONAL_USER_ID,
      displayName: "Profissional Recibo TiDB",
      active: true,
      now: new Date("2026-07-24T20:00:00.000Z"),
    });
    const authorization = await repository.upsertAuthorization({
      id: AUTHORIZATION_ID,
      professionalUserId: PROFESSIONAL_USER_ID,
      patientUserId: PATIENT_USER_ID,
      status: "pending",
      reason: "Motivo confidencial que não pode ser duplicado no comprovante",
      requestedAt: new Date("2026-07-24T20:01:00.000Z"),
      approvedAt: null,
      rejectedAt: null,
      revokedAt: null,
      respondedAt: null,
      responseOrigin: null,
      responseDecision: null,
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: new Date("2026-07-24T20:01:00.000Z"),
    });

    const linkedReceipt = await receiptRepository.createLinkedReceipt({
      professionalUserId: PROFESSIONAL_USER_ID,
      authorizationId: authorization.id,
      patientUserId: PATIENT_USER_ID,
      requestedAt: Date.parse("2026-07-24T20:02:00.000Z"),
    });
    const unresolvedReceipt =
      await receiptRepository.createUnresolvedReceipt(
        PROFESSIONAL_USER_ID,
        Date.parse("2026-07-24T20:03:00.000Z")
      );

    const activeReceipts = await receiptRepository.listActiveReceipts(
      PROFESSIONAL_USER_ID,
      Date.parse("2026-07-24T20:04:00.000Z")
    );
    assert.deepEqual(
      activeReceipts.map(item => item.id).sort(),
      [linkedReceipt.id, unresolvedReceipt.id].sort(),
      "linked and unresolved attempts must both remain visible as opaque receipts"
    );
    assert.equal(
      await receiptRepository.resolveAuthorizationIdForPatient(
        linkedReceipt.id,
        PATIENT_USER_ID
      ),
      authorization.id,
      "the target patient must resolve the linked receipt"
    );
    assert.equal(
      await receiptRepository.resolveAuthorizationIdForPatient(
        linkedReceipt.id,
        OUTSIDER_USER_ID
      ),
      null,
      "an outsider must not resolve the linked receipt"
    );
    assert.equal(
      await receiptRepository.resolveAuthorizationIdForPatient(
        unresolvedReceipt.id,
        PATIENT_USER_ID
      ),
      null,
      "an unresolved receipt must not expose an authorization"
    );

    const [receiptRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, patientUserId, eventType, entityType, entityId
       FROM professionalHistoryEvents
       WHERE id = ? OR entityType = ?
       ORDER BY eventType`,
      [linkedReceipt.id, linkedReceipt.id]
    );
    assert.equal(receiptRows.length, 2);
    const receivedRow = receiptRows.find(
      row => row.eventType === "access_request_received"
    );
    const linkedRow = receiptRows.find(
      row => row.eventType === "access_request_linked"
    );
    assert.deepEqual(
      {
        patientUserId: receivedRow?.patientUserId ?? null,
        entityType: receivedRow?.entityType,
        entityId: receivedRow?.entityId ?? null,
      },
      {
        patientUserId: null,
        entityType: "request_access_receipt",
        entityId: null,
      },
      "the public receipt event must not persist patient identity or target data"
    );
    assert.deepEqual(
      {
        patientUserId: Number(linkedRow?.patientUserId),
        entityType: linkedRow?.entityType,
        entityId: linkedRow?.entityId,
      },
      {
        patientUserId: PATIENT_USER_ID,
        entityType: linkedReceipt.id,
        entityId: authorization.id,
      },
      "the internal association must remain separate from the public receipt event"
    );

    await repository.transitionAuthorization({
      authorizationId: authorization.id,
      patientUserId: PATIENT_USER_ID,
      nextStatus: "approved",
      responseOrigin: "web",
      now: new Date("2026-07-24T20:05:00.000Z"),
    });
    const afterApproval = await receiptRepository.listActiveReceipts(
      PROFESSIONAL_USER_ID,
      Date.parse("2026-07-24T20:06:00.000Z")
    );
    assert.deepEqual(
      afterApproval.map(item => item.id),
      [unresolvedReceipt.id],
      "linked receipts must disappear after consent while unresolved receipts remain neutral"
    );

    const afterExpiry = await receiptRepository.listActiveReceipts(
      PROFESSIONAL_USER_ID,
      Date.parse("2026-08-25T20:06:00.000Z")
    );
    assert.deepEqual(
      afterExpiry,
      [],
      "unresolved receipts must expire after the documented retention window"
    );
    assert.equal(
      warnings.some(item =>
        item.error.includes("Motivo confidencial que não pode ser duplicado")
      ),
      false,
      "warnings must not contain the private request reason"
    );

    console.log(
      JSON.stringify({
        event: "professional.access_receipts.integration.passed",
        linkedReceiptId: linkedReceipt.id,
        unresolvedReceiptId: unresolvedReceipt.id,
        warnings,
      })
    );
  } finally {
    await cleanup();
    await connection.end();
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "professional.access_receipts.integration.failed",
      error: error instanceof Error ? error.message : "UnknownError",
    })
  );
  process.exitCode = 1;
});
