import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import type { TrpcContext } from "../server/_core/context";

const PROFESSIONAL_USER_ID = 8191;
const PATIENT_USER_ID = 8192;
const OUTSIDER_USER_ID = 8193;
const USER_IDS = [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID];
const PROFESSIONAL_PHONE = "5515999998191";
const PATIENT_PHONE = "5515999998192";
const MISSING_PHONE = "+55 (15) 99999-8999";
const DAY_MS = 86_400_000;
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the professional public access boundary integration test."
  );
}

process.env.NODE_ENV = "production";
process.env.BILLING_ACCESS_MODE = "open_access";
delete process.env.PROFESSIONAL_ACCESS_RECEIPT_STORAGE;

function createContext(userId: number): TrpcContext {
  return {
    user: {
      id: userId,
      openId: `professional-boundary-${userId}`,
      email: `professional-boundary-${userId}@example.com`,
      name: `Boundary User ${userId}`,
      loginMethod: "password",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => undefined } as TrpcContext["res"],
  };
}

function assertPendingReceipt(value: unknown) {
  const record = value as Record<string, unknown>;
  assert.equal(record.status, "pending");
  assert.equal(typeof record.id, "string");
  assert.equal(typeof record.requestedAt, "number");
  assert.deepEqual(Object.keys(record).sort(), ["id", "requestedAt", "status"]);
}

function timestampAtOffset(offsetMs: number) {
  return new Date(Math.floor((Date.now() + offsetMs) / 1000) * 1000);
}

async function main() {
  const connection = await mysql.createConnection(databaseUrl);
  const { appRouter } = await import("../server/routers");

  async function cleanup() {
    await connection.query(
      "DELETE FROM `professionalHistoryEvents` WHERE `professionalUserId` = ? OR `patientUserId` IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM `professionalPatientTrackingEvents` WHERE `actorUserId` IN (?, ?, ?)",
      USER_IDS
    );
    await connection.query(
      "DELETE FROM `professionalPatientTrackings` WHERE `professionalUserId` = ? OR `patientUserId` IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM `professionalPatientAuthorizations` WHERE `professionalUserId` = ? OR `patientUserId` IN (?, ?)",
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID, OUTSIDER_USER_ID]
    );
    await connection.query(
      "DELETE FROM `professionalProfiles` WHERE `userId` = ?",
      [PROFESSIONAL_USER_ID]
    );
    await connection.query(
      `DELETE FROM \`whatsappConnections\` WHERE \`userId\` IN (${USER_IDS.map(() => "?").join(",")})`,
      USER_IDS
    );
    await connection.query(
      `DELETE FROM \`users\` WHERE \`id\` IN (${USER_IDS.map(() => "?").join(",")})`,
      USER_IDS
    );
  }

  try {
    await cleanup();
    for (const userId of USER_IDS) {
      await connection.query(
        "INSERT INTO `users` (`id`, `openId`, `name`, `email`, `role`) VALUES (?, ?, ?, ?, 'user')",
        [
          userId,
          `professional-boundary-${userId}`,
          `Boundary User ${userId}`,
          `professional-boundary-${userId}@example.com`,
        ]
      );
    }
    await connection.query(
      "INSERT INTO `whatsappConnections` (`userId`, `phoneNumber`, `displayName`, `status`) VALUES (?, ?, ?, 'disabled'), (?, ?, ?, 'disabled')",
      [
        PROFESSIONAL_USER_ID,
        PROFESSIONAL_PHONE,
        "Profissional",
        PATIENT_USER_ID,
        PATIENT_PHONE,
        "Paciente",
      ]
    );

    const professional = appRouter.createCaller(createContext(PROFESSIONAL_USER_ID));
    const patient = appRouter.createCaller(createContext(PATIENT_USER_ID));
    const outsider = appRouter.createCaller(createContext(OUTSIDER_USER_ID));

    const portfolioInput = (
      nextReview: "all" | "scheduled" | "due_soon" | "overdue" | "unavailable",
      authorizationStatus: "pending" | "approved" = "approved"
    ) => ({
      search: "",
      authorizationStatus,
      trackingStatus: "all" as const,
      activity: "all" as const,
      nextReview,
      page: 1,
      pageSize: 20,
      includeHistoricalActivity: true,
    });

    await professional.nutrition.professionals.upsertProfile({
      displayName: "Profissional Fronteira TiDB",
      active: true,
    });

    const existingPhone = await professional.nutrition.professionals.requestAccess({
      patientContact: "+55 (15) 99999-8192",
      reason: "Motivo privado via celular",
    });
    const missingPhone = await professional.nutrition.professionals.requestAccess({
      patientContact: MISSING_PHONE,
      reason: "Motivo privado inexistente",
    });
    const selfPhone = await professional.nutrition.professionals.requestAccess({
      patientContact: "+55 (15) 99999-8191",
      reason: "Motivo privado auto vínculo",
    });
    const repeatedEmail = await professional.nutrition.professionals.requestAccess({
      patientContact: `professional-boundary-${PATIENT_USER_ID}@example.com`,
      reason: "Repetição do mesmo vínculo por e-mail",
    });

    for (const result of [
      existingPhone,
      missingPhone,
      selfPhone,
      repeatedEmail,
    ]) {
      assertPendingReceipt(result);
    }
    assert.equal(
      new Set([
        existingPhone.id,
        missingPhone.id,
        selfPhone.id,
        repeatedEmail.id,
      ]).size,
      4,
      "each accepted public attempt must receive a distinct opaque receipt"
    );

    const [authorizationRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT `id`, `patientUserId`, `status` FROM `professionalPatientAuthorizations` WHERE `professionalUserId` = ?",
      [PROFESSIONAL_USER_ID]
    );
    assert.equal(authorizationRows.length, 1);
    assert.equal(Number(authorizationRows[0]?.patientUserId), PATIENT_USER_ID);
    assert.equal(authorizationRows[0]?.status, "pending");

    const accesses = await professional.nutrition.professionals.myAccesses();
    assert.equal(accesses.filter(item => item.status === "pending").length, 4);
    assert.equal(JSON.stringify(accesses).includes(PATIENT_PHONE), false);
    assert.equal(JSON.stringify(accesses).includes(String(PATIENT_USER_ID)), false);

    const portfolio = await professional.nutrition.professionals.portfolio(
      portfolioInput("all", "pending")
    );
    assert.equal(portfolio.items.length, 4);
    assert.equal(portfolio.summary.pendingRequests, 4);
    assert.equal(
      portfolio.items.every(
        item =>
          item.patientUserId === 0 &&
          item.patientName === "Solicitação aguardando confirmação" &&
          item.patientEmail === null
      ),
      true
    );
    assert.equal(JSON.stringify(portfolio).includes(PATIENT_PHONE), false);
    assert.equal(JSON.stringify(portfolio).includes(String(PATIENT_USER_ID)), false);

    await assert.rejects(
      outsider.nutrition.professionals.approveAccess({
        accessId: existingPhone.id,
      }),
      /não encontrada/i
    );
    const approved = await patient.nutrition.professionals.approveAccess({
      accessId: existingPhone.id,
    });
    assert.equal(approved.status, "approved");
    assert.equal(approved.patientUserId, PATIENT_USER_ID);

    const dueSoonReview = timestampAtOffset(3 * DAY_MS);
    const overdueReview = timestampAtOffset(-3 * DAY_MS);
    const overdueWeighing = timestampAtOffset(-DAY_MS);
    const [trackingUpdate] = await connection.query<mysql.ResultSetHeader>(
      `UPDATE \`professionalPatientTrackings\`
       SET \`nextReviewAt\` = ?, \`nextWeighingAt\` = ?
       WHERE \`professionalUserId\` = ? AND \`patientUserId\` = ?`,
      [
        dueSoonReview,
        overdueWeighing,
        PROFESSIONAL_USER_ID,
        PATIENT_USER_ID,
      ]
    );
    assert.equal(
      trackingUpdate.affectedRows,
      1,
      "approval must create one canonical tracking row with operational schedule columns"
    );

    const scheduled = await professional.nutrition.professionals.portfolio(
      portfolioInput("scheduled")
    );
    assert.equal(scheduled.items.length, 1);
    assert.equal(scheduled.items[0]?.patientUserId, PATIENT_USER_ID);
    assert.equal(scheduled.items[0]?.nextReviewAt, dueSoonReview.getTime());
    assert.equal(scheduled.items[0]?.nextWeighingAt, overdueWeighing.getTime());

    const dueSoon = await professional.nutrition.professionals.portfolio(
      portfolioInput("due_soon")
    );
    assert.equal(dueSoon.items.length, 1);
    assert.equal(
      (await professional.nutrition.professionals.portfolio(
        portfolioInput("overdue")
      )).items.length,
      0
    );
    assert.equal(
      (await professional.nutrition.professionals.portfolio(
        portfolioInput("unavailable")
      )).items.length,
      0
    );

    await connection.query(
      `UPDATE \`professionalPatientTrackings\`
       SET \`nextReviewAt\` = ?
       WHERE \`professionalUserId\` = ? AND \`patientUserId\` = ?`,
      [overdueReview, PROFESSIONAL_USER_ID, PATIENT_USER_ID]
    );
    const overdue = await professional.nutrition.professionals.portfolio(
      portfolioInput("overdue")
    );
    assert.equal(overdue.items.length, 1);
    assert.equal(overdue.items[0]?.nextReviewAt, overdueReview.getTime());

    await connection.query(
      `UPDATE \`professionalPatientTrackings\`
       SET \`nextReviewAt\` = NULL
       WHERE \`professionalUserId\` = ? AND \`patientUserId\` = ?`,
      [PROFESSIONAL_USER_ID, PATIENT_USER_ID]
    );
    const unavailable = await professional.nutrition.professionals.portfolio(
      portfolioInput("unavailable")
    );
    assert.equal(unavailable.items.length, 1);
    assert.equal(unavailable.items[0]?.nextReviewAt, null);

    const afterApproval = await professional.nutrition.professionals.portfolio(
      portfolioInput("all", "pending")
    );
    assert.equal(
      afterApproval.summary.pendingRequests,
      2,
      "all receipts linked to the approved authorization must leave the pending view"
    );

    const [publicReceiptRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT \`patientUserId\`, \`entityId\`
       FROM \`professionalHistoryEvents\`
       WHERE \`professionalUserId\` = ? AND \`eventType\` = 'access_request_received'`,
      [PROFESSIONAL_USER_ID]
    );
    assert.equal(publicReceiptRows.length, 4);
    assert.equal(
      publicReceiptRows.every(row => row.patientUserId === null && row.entityId === null),
      true,
      "public receipt rows must not persist target identity"
    );

    console.log(
      JSON.stringify({
        event: "professional.access_public_boundary.integration.passed",
        attempts: 4,
        canonicalAuthorizations: authorizationRows.length,
        phoneCovered: true,
        emailCovered: true,
        scheduleColumnsCovered: ["nextReviewAt", "nextWeighingAt"],
        reviewFiltersCovered: [
          "scheduled",
          "due_soon",
          "overdue",
          "unavailable",
        ],
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
      event: "professional.access_public_boundary.integration.failed",
      error: error instanceof Error ? error.message : "UnknownError",
      stack: error instanceof Error ? error.stack : null,
    })
  );
  process.exitCode = 1;
});
