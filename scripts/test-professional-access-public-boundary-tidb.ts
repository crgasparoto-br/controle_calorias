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

    const portfolio = await professional.nutrition.professionals.portfolio({
      search: "",
      authorizationStatus: "pending",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
      includeHistoricalActivity: true,
    });
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

    const afterApproval = await professional.nutrition.professionals.portfolio({
      search: "",
      authorizationStatus: "pending",
      trackingStatus: "all",
      activity: "all",
      nextReview: "all",
      page: 1,
      pageSize: 20,
      includeHistoricalActivity: true,
    });
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
