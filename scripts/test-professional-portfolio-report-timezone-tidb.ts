import "dotenv/config";
import assert from "node:assert/strict";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createProfessionalPortfolioRepository } from "../server/repositories/professionalPortfolioRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the professional portfolio timezone integration test."
  );
}

const PROFESSIONAL_ID = 98201;
const PATIENT_VALID_TIMEZONE = 98202;
const PATIENT_EMPTY_TIMEZONE = 98203;
const PATIENT_INVALID_TIMEZONE = 98204;
const PATIENT_WITHOUT_PROFILE = 98205;
const PATIENT_IDS = [
  PATIENT_VALID_TIMEZONE,
  PATIENT_EMPTY_TIMEZONE,
  PATIENT_INVALID_TIMEZONE,
  PATIENT_WITHOUT_PROFILE,
];
const USER_IDS = [PROFESSIONAL_ID, ...PATIENT_IDS];
const AUTHORIZATION_IDS = PATIENT_IDS.map(
  patientId => `portfolio-timezone-auth-${patientId}`
);
const TRACKING_IDS = PATIENT_IDS.map(
  patientId => `portfolio-timezone-tracking-${patientId}`
);

async function cleanup(connection: mysql.Connection) {
  const userPlaceholders = USER_IDS.map(() => "?").join(",");
  const authorizationPlaceholders = AUTHORIZATION_IDS.map(() => "?").join(",");

  await connection.query(
    `DELETE FROM meals WHERE userId IN (${userPlaceholders})`,
    USER_IDS
  );
  await connection.query(
    `DELETE FROM professionalPatientTrackingEvents WHERE authorizationId IN (${authorizationPlaceholders})`,
    AUTHORIZATION_IDS
  );
  await connection.query(
    `DELETE FROM professionalPatientTrackings WHERE authorizationId IN (${authorizationPlaceholders})`,
    AUTHORIZATION_IDS
  );
  await connection.query(
    `DELETE FROM professionalPatientAuthorizations WHERE id IN (${authorizationPlaceholders})`,
    AUTHORIZATION_IDS
  );
  await connection.query(
    `DELETE FROM userProfiles WHERE userId IN (${userPlaceholders})`,
    USER_IDS
  );
  await connection.query(
    `DELETE FROM users WHERE id IN (${userPlaceholders})`,
    USER_IDS
  );
}

async function seed(connection: mysql.Connection) {
  for (const userId of USER_IDS) {
    await connection.query(
      "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
      [
        userId,
        `portfolio-timezone-test-${userId}`,
        `Portfolio Timezone User ${userId}`,
        `portfolio-timezone-${userId}@example.com`,
      ]
    );
  }

  await connection.query(
    `INSERT INTO userProfiles (userId, displayName, timezone)
     VALUES (?, ?, ?), (?, ?, ?), (?, ?, ?)`,
    [
      PATIENT_VALID_TIMEZONE,
      "Paciente com timezone válido",
      "America/New_York",
      PATIENT_EMPTY_TIMEZONE,
      "Paciente com timezone vazio",
      "",
      PATIENT_INVALID_TIMEZONE,
      "Paciente com timezone inválido",
      "Mars/Olympus",
    ]
  );

  const now = new Date("2026-07-01T12:00:00.000Z");
  for (const [index, patientId] of PATIENT_IDS.entries()) {
    const authorizationId = AUTHORIZATION_IDS[index]!;
    const trackingId = TRACKING_IDS[index]!;
    await connection.query(
      `INSERT INTO professionalPatientAuthorizations
        (id, professionalUserId, patientUserId, status, activePairKey, reason,
         requestedAt, approvedAt, respondedAt, responseOrigin, responseDecision,
         sourceUpdatedAt)
       VALUES (?, ?, ?, 'approved', ?, 'Teste de timezone agregado', ?, ?, ?, 'web', 'approved', ?)`,
      [
        authorizationId,
        PROFESSIONAL_ID,
        patientId,
        `${PROFESSIONAL_ID}:${patientId}`,
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
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
      [
        trackingId,
        authorizationId,
        PROFESSIONAL_ID,
        patientId,
        now,
        now,
        PROFESSIONAL_ID,
      ]
    );
    await connection.query(
      `INSERT INTO meals (userId, source, status, mealLabel, confidence, occurredAt)
       VALUES (?, 'web', 'confirmed', 'Registro na fronteira local', 1, ?)`,
      [patientId, new Date("2026-07-01T03:30:00.000Z")]
    );
  }
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );

  try {
    await connection.query("SET time_zone = '+00:00'");
    await cleanup(connection);
    await seed(connection);

    const db = drizzle(connection);
    const repository = createProfessionalPortfolioRepository({
      getDb: async () => db,
      onWarning: (scope, error) => {
        throw new Error(`${scope}: ${String(error)}`);
      },
    });

    const june30 = await repository.report(PROFESSIONAL_ID, {
      block: "activity",
      reportStartDate: "2026-06-30",
      reportEndDate: "2026-06-30",
    });
    assert.equal(
      june30.summary.activeWithRecentRecords,
      1,
      "a valid patient timezone must classify the boundary meal on June 30"
    );
    assert.equal(june30.summary.withoutRecentActivity, 3);

    const july1 = await repository.report(PROFESSIONAL_ID, {
      block: "activity",
      reportStartDate: "2026-07-01",
      reportEndDate: "2026-07-01",
    });
    assert.equal(
      july1.summary.activeWithRecentRecords,
      3,
      "empty, invalid and missing profile timezones must use the canonical São Paulo fallback"
    );
    assert.equal(july1.summary.withoutRecentActivity, 1);

    console.log(
      JSON.stringify({
        event: "professional.portfolio_report_timezone.integration.passed",
        professionalUserId: PROFESSIONAL_ID,
        june30: june30.summary,
        july1: july1.summary,
      })
    );
  } finally {
    await cleanup(connection);
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
