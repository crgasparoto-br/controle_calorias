import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import {
  cancelProfessionalOperationalRequest,
  closeProfessionalOperationalAlert,
  createProfessionalOperationalRequest,
  evaluateProfessionalOperationalAlerts,
  listProfessionalOperationalAlerts,
  respondToProfessionalOperationalRequest,
} from "../server/modules/professionals/operationalAlertsService";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the professional operational alerts integration test."
  );
}

const PROFESSIONAL_A = 98101;
const PATIENT_A = 98102;
const PROFESSIONAL_B = 98103;
const PATIENT_B = 98104;
const USER_IDS = [PROFESSIONAL_A, PATIENT_A, PROFESSIONAL_B, PATIENT_B];
const AUTH_A = "operational-alert-auth-a";
const AUTH_B = "operational-alert-auth-b";
const TRACKING_A = "operational-alert-tracking-a";
const TRACKING_B = "operational-alert-tracking-b";

async function cleanup(connection: mysql.Connection) {
  const placeholders = USER_IDS.map(() => "?").join(",");
  await connection.query(
    `DELETE FROM professionalOperationalAlerts WHERE professionalUserId IN (${placeholders}) OR patientUserId IN (${placeholders})`,
    [...USER_IDS, ...USER_IDS]
  );
  await connection.query(
    `DELETE FROM professionalReviewSignals WHERE professionalUserId IN (${placeholders}) OR patientUserId IN (${placeholders})`,
    [...USER_IDS, ...USER_IDS]
  );
  await connection.query(
    `DELETE FROM professionalOperationalRequests WHERE professionalUserId IN (${placeholders}) OR patientUserId IN (${placeholders})`,
    [...USER_IDS, ...USER_IDS]
  );
  await connection.query(
    "DELETE FROM professionalPatientTrackingEvents WHERE authorizationId IN (?, ?)",
    [AUTH_A, AUTH_B]
  );
  await connection.query(
    "DELETE FROM professionalPatientTrackings WHERE authorizationId IN (?, ?)",
    [AUTH_A, AUTH_B]
  );
  await connection.query(
    "DELETE FROM professionalPatientAuthorizations WHERE id IN (?, ?)",
    [AUTH_A, AUTH_B]
  );
  await connection.query(
    `DELETE FROM professionalProfiles WHERE userId IN (${placeholders})`,
    USER_IDS
  );
  await connection.query(
    `DELETE FROM userProfiles WHERE userId IN (${placeholders})`,
    USER_IDS
  );
  await connection.query(
    `DELETE FROM users WHERE id IN (${placeholders})`,
    USER_IDS
  );
}

async function seed(connection: mysql.Connection) {
  for (const userId of USER_IDS) {
    await connection.query(
      "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
      [
        userId,
        `operational-alert-test-${userId}`,
        `Operational Alert User ${userId}`,
        `operational-alert-${userId}@example.com`,
      ]
    );
  }

  await connection.query(
    "INSERT INTO userProfiles (userId, displayName, timezone) VALUES (?, ?, ?), (?, ?, ?)",
    [
      PATIENT_A,
      "Paciente Operacional A",
      "America/Sao_Paulo",
      PATIENT_B,
      "Paciente Operacional B",
      "Asia/Tokyo",
    ]
  );

  const now = new Date("2026-07-20T10:00:00.000Z");
  await connection.query(
    `INSERT INTO professionalPatientAuthorizations
      (id, professionalUserId, patientUserId, status, activePairKey, reason,
       requestedAt, approvedAt, respondedAt, responseOrigin, responseDecision,
       sourceUpdatedAt)
     VALUES (?, ?, ?, 'approved', ?, 'Teste de alertas', ?, ?, ?, 'web', 'approved', ?),
            (?, ?, ?, 'approved', ?, 'Teste de alertas', ?, ?, ?, 'web', 'approved', ?)`,
    [
      AUTH_A,
      PROFESSIONAL_A,
      PATIENT_A,
      `${PROFESSIONAL_A}:${PATIENT_A}`,
      now,
      now,
      now,
      now,
      AUTH_B,
      PROFESSIONAL_B,
      PATIENT_B,
      `${PROFESSIONAL_B}:${PATIENT_B}`,
      now,
      now,
      now,
      now,
    ]
  );

  await connection.query(
    `INSERT INTO professionalPatientTrackings
      (id, authorizationId, professionalUserId, patientUserId, status,
       startedAt, lastTransitionAt, lastTransitionByUserId)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?),
            (?, ?, ?, ?, 'active', ?, ?, ?)`,
    [
      TRACKING_A,
      AUTH_A,
      PROFESSIONAL_A,
      PATIENT_A,
      now,
      now,
      PROFESSIONAL_A,
      TRACKING_B,
      AUTH_B,
      PROFESSIONAL_B,
      PATIENT_B,
      now,
      now,
      PROFESSIONAL_B,
    ]
  );
}

async function findRequestAlert(
  professionalUserId: number,
  requestId: string
) {
  const alerts = await listProfessionalOperationalAlerts(professionalUserId);
  const alert = alerts.find(
    item =>
      item.origin.type === "professional_request" &&
      item.origin.id === requestId
  );
  assert.ok(alert, `request alert ${requestId} must be visible to its professional`);
  return alert;
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );

  try {
    await cleanup(connection);
    await seed(connection);

    const dueAt = Date.parse("2026-07-19T10:00:00.000Z");
    const now = new Date("2026-07-20T12:00:00.000Z");
    const requestA = await createProfessionalOperationalRequest(PROFESSIONAL_A, {
      patientId: PATIENT_A,
      type: "professional_request",
      title: "Responder atualização semanal",
      dueAt,
    });

    await Promise.all([
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
    ]);

    const [concurrentRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, state, COUNT(*) OVER () AS total
       FROM professionalOperationalAlerts
       WHERE professionalUserId = ?
         AND originType = 'professional_request'
         AND originId = ?`,
      [PROFESSIONAL_A, requestA.id]
    );
    assert.equal(concurrentRows.length, 1, "concurrent evaluation must persist one equivalent alert");
    assert.equal(Number(concurrentRows[0]?.total), 1);

    const alertA = await findRequestAlert(PROFESSIONAL_A, requestA.id);
    await closeProfessionalOperationalAlert(
      PROFESSIONAL_A,
      PROFESSIONAL_A,
      alertA.id,
      "resolved",
      "Resolvido no teste de integração"
    );
    await Promise.all([
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
    ]);

    const [resolvedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT state, resolvedByUserId, resolvedAt FROM professionalOperationalAlerts WHERE id = ?",
      [alertA.id]
    );
    assert.equal(resolvedRows[0]?.state, "resolved");
    assert.equal(Number(resolvedRows[0]?.resolvedByUserId), PROFESSIONAL_A);
    assert.ok(resolvedRows[0]?.resolvedAt, "resolution timestamp must remain persisted");

    const dismissedRequest = await createProfessionalOperationalRequest(
      PROFESSIONAL_A,
      {
        patientId: PATIENT_A,
        type: "professional_request",
        title: "Solicitação dispensável",
        dueAt,
      }
    );
    await evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now);
    const dismissedAlert = await findRequestAlert(
      PROFESSIONAL_A,
      dismissedRequest.id
    );
    await closeProfessionalOperationalAlert(
      PROFESSIONAL_A,
      PROFESSIONAL_A,
      dismissedAlert.id,
      "dismissed"
    );
    await Promise.all([
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
    ]);
    const [dismissedRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT state FROM professionalOperationalAlerts WHERE id = ?",
      [dismissedAlert.id]
    );
    assert.equal(
      dismissedRows[0]?.state,
      "dismissed",
      "concurrent reevaluation must not reopen a dismissed alert"
    );

    const requestB = await createProfessionalOperationalRequest(PROFESSIONAL_B, {
      patientId: PATIENT_B,
      type: "professional_request",
      title: "Responder profissional B",
      dueAt,
    });
    await Promise.all([
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_A, now),
      evaluateProfessionalOperationalAlerts(PROFESSIONAL_B, now),
    ]);

    const alertsA = await listProfessionalOperationalAlerts(PROFESSIONAL_A);
    const alertsB = await listProfessionalOperationalAlerts(PROFESSIONAL_B);
    assert.ok(alertsA.every(item => item.patientUserId === PATIENT_A));
    assert.ok(alertsB.every(item => item.patientUserId === PATIENT_B));
    assert.equal(
      alertsA.some(item => item.origin.id === requestB.id),
      false,
      "professional A must not list professional B requests"
    );

    const alertB = await findRequestAlert(PROFESSIONAL_B, requestB.id);
    await assert.rejects(
      () =>
        closeProfessionalOperationalAlert(
          PROFESSIONAL_A,
          PROFESSIONAL_A,
          alertB.id,
          "resolved"
        ),
      /não está mais disponível/
    );
    await assert.rejects(
      () =>
        respondToProfessionalOperationalRequest(
          PATIENT_A,
          requestB.id,
          "unauthorized-response"
        ),
      /não tem permissão/
    );
    await assert.rejects(
      () =>
        cancelProfessionalOperationalRequest(
          PROFESSIONAL_A,
          PROFESSIONAL_A,
          requestB.id
        ),
      /não está mais disponível/
    );

    const response = await respondToProfessionalOperationalRequest(
      PATIENT_B,
      requestB.id,
      "patient-b-response"
    );
    assert.equal(response.state, "answered");
    assert.equal(
      (await listProfessionalOperationalAlerts(PROFESSIONAL_B)).some(
        item => item.origin.id === requestB.id
      ),
      false,
      "an associated response must remove the alert from the professional view"
    );

    const [requestBRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT state, closedByUserId, closureReason, responseReference
       FROM professionalOperationalRequests WHERE id = ?`,
      [requestB.id]
    );
    assert.deepEqual(
      {
        state: requestBRows[0]?.state,
        closedByUserId: Number(requestBRows[0]?.closedByUserId),
        closureReason: requestBRows[0]?.closureReason,
        responseReference: requestBRows[0]?.responseReference,
      },
      {
        state: "answered",
        closedByUserId: PATIENT_B,
        closureReason: "response",
        responseReference: "patient-b-response",
      }
    );

    console.log(
      JSON.stringify({
        event: "professional.operational-alerts.integration.passed",
        concurrentAlertId: alertA.id,
        isolatedRequestId: requestB.id,
      })
    );
  } finally {
    await cleanup(connection);
    await connection.end();
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "professional.operational-alerts.integration.failed",
      error: error instanceof Error ? error.message : "UnknownError",
    })
  );
  process.exitCode = 1;
});
