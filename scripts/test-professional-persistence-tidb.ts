import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { getDb, shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createDrizzleProfessionalRepository } from "../server/repositories/professionalRepository";

const USER_IDS = [8061, 8062, 8063, 8064, 8065, 8066, 8067, 8071, 8072];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error(
    "DATABASE_URL is required for the professional persistence integration test."
  );

function legacyAccess(input: {
  id: string;
  professionalUserId: number;
  patientUserId: number;
  status?: "pending" | "approved";
}) {
  const requestedAt = Date.parse("2026-07-14T20:00:00.000Z");
  const approvedAt = input.status === "approved" ? requestedAt + 60_000 : null;
  return {
    id: input.id,
    professionalUserId: input.professionalUserId,
    patientUserId: input.patientUserId,
    status: input.status ?? "pending",
    reason: "Acompanhamento de integração",
    requestedAt,
    approvedAt,
    revokedAt: null,
    rejectedAt: null,
    respondedAt: approvedAt,
    responseOrigin: approvedAt ? "web" : null,
    responseDecision: approvedAt ? "approved" : null,
    authorizationMessageStatus: null,
    authorizationMessageSentAt: null,
    authorizationMessageError: null,
  };
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );
  const warnings: Array<{ scope: string; error: string }> = [];
  const repository = createDrizzleProfessionalRepository({
    getDb,
    onWarning: (scope, error) =>
      warnings.push({
        scope,
        error: error instanceof Error ? error.message : "unknown",
      }),
  });

  try {
    await connection.query("DELETE FROM `professionalPatientTrackingEvents`");
    await connection.query("DELETE FROM `professionalPatientTrackings`");
    await connection.query("DELETE FROM `professionalPatientAuthorizations`");
    await connection.query("DELETE FROM `professionalProfiles`");
    await connection.query(
      `DELETE FROM \`userPreferences\` WHERE \`userId\` IN (${USER_IDS.map(() => "?").join(",")})`,
      USER_IDS
    );
    await connection.query(
      `DELETE FROM \`users\` WHERE \`id\` IN (${USER_IDS.map(() => "?").join(",")})`,
      USER_IDS
    );

    for (const userId of USER_IDS) {
      await connection.query(
        "INSERT INTO `users` (`id`, `openId`, `name`, `email`, `role`) VALUES (?, ?, ?, ?, 'user')",
        [
          userId,
          `professional-test-${userId}`,
          `User ${userId}`,
          `professional-test-${userId}@example.com`,
        ]
      );
    }

    const legacyProfile = {
      userId: 8061,
      displayName: "Nutricionista Integração",
      registrationNumber: "CRN 8061",
      active: true,
      createdAt: Date.parse("2026-07-14T19:00:00.000Z"),
      updatedAt: Date.parse("2026-07-14T20:00:00.000Z"),
    };
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?)",
      [
        8061,
        "professional_profile_v1",
        JSON.stringify(legacyProfile),
        new Date("2026-07-14T19:00:00.000Z"),
        new Date("2026-07-14T20:00:00.000Z"),
      ]
    );

    const patientOnly = legacyAccess({
      id: "patient-only-806",
      professionalUserId: 8061,
      patientUserId: 8062,
    });
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?)",
      [
        8062,
        "patient_professional_access_requests_v1",
        JSON.stringify([patientOnly]),
        new Date("2026-07-14T20:00:00.000Z"),
        new Date("2026-07-14T20:01:00.000Z"),
      ]
    );

    const professionalOnly = legacyAccess({
      id: "professional-only-806",
      professionalUserId: 8063,
      patientUserId: 8064,
    });
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?)",
      [
        8063,
        "professional_accesses_v1",
        JSON.stringify([professionalOnly]),
        new Date("2026-07-14T20:00:00.000Z"),
        new Date("2026-07-14T20:02:00.000Z"),
      ]
    );

    const untouched = legacyAccess({
      id: "backfill-806",
      professionalUserId: 8065,
      patientUserId: 8066,
      status: "approved",
    });
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`, `createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?)",
      [
        8065,
        "professional_accesses_v1",
        JSON.stringify([untouched]),
        new Date("2026-07-14T20:00:00.000Z"),
        new Date("2026-07-14T20:03:00.000Z"),
      ]
    );
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`) VALUES (?, ?, ?)",
      [8067, "professional_profile_v1", "{sensitive-invalid-json"]
    );

    const professionalRead =
      await repository.listAuthorizationsByProfessional(8061);
    assert.equal(
      professionalRead.some(item => item.id === patientOnly.id),
      true,
      "patient-side-only access must be visible to the professional"
    );
    const patientRead = await repository.listAuthorizationsByPatient(8064);
    assert.equal(
      patientRead.some(item => item.id === professionalOnly.id),
      true,
      "professional-side-only access must be visible to the patient"
    );

    const firstBackfill = await repository.migrateAllLegacyData();
    const [rowsAfterFirst] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM `professionalPatientAuthorizations` WHERE `id` = ?",
      [untouched.id]
    );
    assert.equal(Number(rowsAfterFirst[0]?.total), 1);
    const secondBackfill = await repository.migrateAllLegacyData();
    const [rowsAfterSecond] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM `professionalPatientAuthorizations` WHERE `id` = ?",
      [untouched.id]
    );
    assert.equal(
      Number(rowsAfterSecond[0]?.total),
      1,
      "repeated backfill must not duplicate authorization"
    );
    assert.equal(
      secondBackfill.migratedAuthorizations,
      0,
      "second backfill must not rewrite canonical authorizations"
    );
    assert.equal(firstBackfill.invalidPreferences >= 1, true);
    assert.equal(
      warnings.some(item => item.error.includes("sensitive-invalid-json")),
      false,
      "warnings must not contain raw preference content"
    );

    const requestedAt = new Date("2026-07-14T21:00:00.000Z");
    const concurrentBase = {
      professionalUserId: 8071,
      patientUserId: 8072,
      status: "pending" as const,
      reason: "Concorrência",
      requestedAt,
      approvedAt: null,
      rejectedAt: null,
      revokedAt: null,
      respondedAt: null,
      responseOrigin: null,
      responseDecision: null,
      authorizationMessageStatus: null,
      authorizationMessageSentAt: null,
      authorizationMessageError: null,
      sourceUpdatedAt: requestedAt,
    };
    const [concurrentA, concurrentB] = await Promise.all([
      repository.upsertAuthorization({
        id: "concurrent-real-a",
        ...concurrentBase,
      }),
      repository.upsertAuthorization({
        id: "concurrent-real-b",
        ...concurrentBase,
      }),
    ]);
    assert.equal(
      concurrentA.id,
      concurrentB.id,
      "concurrent requests must converge to one authorization"
    );

    const approved = await repository.transitionAuthorization({
      authorizationId: concurrentA.id,
      patientUserId: 8072,
      nextStatus: "approved",
      responseOrigin: "web",
      now: new Date("2026-07-14T21:10:00.000Z"),
    });
    assert.equal(approved.status, "approved");
    const tracking = await repository.getTrackingByAuthorization(approved.id);
    assert.equal(tracking?.status, "active");
    const [eventRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM `professionalPatientTrackingEvents` WHERE `authorizationId` = ?",
      [approved.id]
    );
    assert.equal(
      Number(eventRows[0]?.total),
      1,
      "approval must atomically create one tracking event"
    );

    const secondInstance = createDrizzleProfessionalRepository({
      getDb,
      onWarning: () => undefined,
    });
    assert.equal(
      (await secondInstance.getApprovedAuthorization(8071, 8072))?.id,
      approved.id,
      "another instance must read the persisted state"
    );

    await repository.transitionAuthorization({
      authorizationId: approved.id,
      patientUserId: 8072,
      nextStatus: "revoked",
      responseOrigin: "web",
      now: new Date("2026-07-14T21:20:00.000Z"),
    });
    await assert.rejects(
      () =>
        secondInstance.transitionTracking({
          actorUserId: 8071,
          authorizationId: approved.id,
          nextStatus: "paused",
        }),
      /A autorização de dados não está ativa/
    );

    console.log(
      JSON.stringify({
        event: "professional.persistence.integration.passed",
        firstBackfill,
        secondBackfill,
        warnings: warnings.map(item => ({
          scope: item.scope,
          error: item.error,
        })),
      })
    );
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "professional.persistence.integration.failed",
      error: error instanceof Error ? error.message : "UnknownError",
    })
  );
  process.exitCode = 1;
});
