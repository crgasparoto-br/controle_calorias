import "dotenv/config";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createDrizzleProfessionalRepository } from "../server/repositories/professionalRepository";
import { createDrizzleProfessionalContentRepository } from "../server/repositories/professionalContentRepository";
import { getNutritionGoalForDate } from "../server/modules/goals/service";

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

function runLegacyRetirement(apply = false) {
  const output = execFileSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "scripts/retire-professional-legacy-preferences.ts",
      ...(apply ? ["--apply"] : []),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: "utf8",
    }
  );
  const jsonLine = output.trim().split("\n").at(-1);
  assert.ok(jsonLine, "legacy retirement command must emit a JSON result");
  return JSON.parse(jsonLine) as {
    apply: boolean;
    legacyRowsBeforeCleanup: number;
    legacyRowsRemaining: number;
  };
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );
  const integrationDb = drizzle(connection);
  const getIntegrationDb = async () => integrationDb;
  const warnings: Array<{ scope: string; error: string }> = [];
  const onWarning = (scope: string, error: unknown) =>
    warnings.push({
      scope,
      error: error instanceof Error ? error.message : "unknown",
    });
  const repository = createDrizzleProfessionalRepository({
    getDb: getIntegrationDb,
    onWarning,
  });
  const contentRepository = createDrizzleProfessionalContentRepository({
    getDb: getIntegrationDb,
    onWarning,
  });

  try {
    await connection.query("DELETE FROM `professionalGoalNotifications`");
    await connection.query("DELETE FROM `professionalGoalReviewRequests`");
    await connection.query("DELETE FROM `professionalOfficialGoals`");
    await connection.query("DELETE FROM `professionalHistoryEvents`");
    await connection.query("DELETE FROM `professionalComments`");
    await connection.query("DELETE FROM `professionalGoalSuggestions`");
    await connection.query("DELETE FROM `professionalMealSuggestions`");
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

    const retirementLegacyGoal = {
      id: "legacy-goal-retirement-815",
      professionalUserId: 8061,
      patientUserId: 8062,
      rationale: "Sugestão legada coberta pelo gate final",
      status: "sent",
      goal: {
        defaultGoal: {
          calories: 1850,
          proteinGrams: 125,
          carbsGrams: 195,
          fatGrams: 58,
        },
        exceptions: [],
      },
      createdAt: Date.parse("2026-07-14T20:04:00.000Z"),
      sentAt: Date.parse("2026-07-14T20:05:00.000Z"),
      respondedAt: null,
    };
    await connection.query(
      "INSERT INTO userPreferences (userId, preferenceKey, preferenceValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      [
        8062,
        "patient_professional_goal_suggestions_v1",
        JSON.stringify([retirementLegacyGoal]),
        new Date("2026-07-14T20:04:00.000Z"),
        new Date("2026-07-14T20:05:00.000Z"),
      ]
    );
    assert.equal(
      (await contentRepository.listGoalSuggestionsByPatient(8062)).some(
        item => item.id === retirementLegacyGoal.id
      ),
      false,
      "runtime reads must not lazily consume legacy goal suggestions"
    );
    const firstGoalSuggestionBackfill =
      await contentRepository.migrateAllLegacyGoalSuggestions();
    assert.equal(firstGoalSuggestionBackfill.migrated, 1);
    assert.equal(
      (await contentRepository.listGoalSuggestionsByPatient(8062)).some(
        item => item.id === retirementLegacyGoal.id
      ),
      true,
      "explicit backfill must migrate legacy goal suggestions"
    );
    const secondGoalSuggestionBackfill =
      await contentRepository.migrateAllLegacyGoalSuggestions();
    assert.equal(secondGoalSuggestionBackfill.migrated, 0);
    await contentRepository.createGoalSuggestion({
      id: "canonical-only-goal-815",
      professionalUserId: 8061,
      patientUserId: 8062,
      rationale: "Não deve voltar ao JSON legado",
      status: "sent",
      goal: {
        defaultGoal: {
          calories: 1900,
          proteinGrams: 130,
          carbsGrams: 200,
          fatGrams: 60,
        },
        exceptions: [],
      },
    });
    const [legacyGoalPreferenceRows] = await connection.query<
      mysql.RowDataPacket[]
    >(
      "SELECT preferenceValue FROM userPreferences WHERE userId = ? AND preferenceKey = ?",
      [8062, "patient_professional_goal_suggestions_v1"]
    );
    const legacyGoalPreference = JSON.parse(
      String(legacyGoalPreferenceRows[0]?.preferenceValue ?? "[]")
    ) as Array<{ id?: string }>;
    assert.equal(
      legacyGoalPreference.some(item => item.id === "canonical-only-goal-815"),
      false,
      "canonical writes must not dual-write legacy goal suggestion JSON"
    );

    const professionalReadBeforeBackfill =
      await repository.listAuthorizationsByProfessional(8061);
    assert.equal(
      professionalReadBeforeBackfill.some(item => item.id === patientOnly.id),
      false,
      "runtime reads must not lazily consume professional legacy preferences"
    );
    const patientReadBeforeBackfill =
      await repository.listAuthorizationsByPatient(8064);
    assert.equal(
      patientReadBeforeBackfill.some(item => item.id === professionalOnly.id),
      false,
      "runtime reads must not lazily consume patient legacy preferences"
    );

    const firstBackfill = await repository.migrateAllLegacyData();
    const professionalRead =
      await repository.listAuthorizationsByProfessional(8061);
    assert.equal(
      professionalRead.some(item => item.id === patientOnly.id),
      true,
      "explicit backfill must make patient-side-only access visible to the professional"
    );
    const patientRead = await repository.listAuthorizationsByPatient(8064);
    assert.equal(
      patientRead.some(item => item.id === professionalOnly.id),
      true,
      "explicit backfill must make professional-side-only access visible to the patient"
    );
    const [rowsAfterFirst] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM professionalPatientAuthorizations WHERE id = ?",
      [untouched.id]
    );
    assert.equal(Number(rowsAfterFirst[0]?.total), 1);
    const secondBackfill = await repository.migrateAllLegacyData();
    const [rowsAfterSecond] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM professionalPatientAuthorizations WHERE id = ?",
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

    await connection.query(
      "DELETE FROM userPreferences WHERE userId = ? AND preferenceKey = ?",
      [8067, "professional_profile_v1"]
    );

    const sameVersionAccessConflict = {
      ...untouched,
      reason: "Conflito legado com a mesma versão",
    };
    const sameVersionGoalConflict = {
      ...retirementLegacyGoal,
      rationale: "Conflito de sugestão com a mesma versão",
    };
    await connection.query(
      "INSERT INTO userPreferences (userId, preferenceKey, preferenceValue, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)",
      [
        8066,
        "patient_professional_access_requests_v1",
        JSON.stringify([sameVersionAccessConflict]),
        new Date("2026-07-14T20:00:00.000Z"),
        new Date("2026-07-14T20:03:00.000Z"),
      ]
    );
    await connection.query(
      "UPDATE userPreferences SET preferenceValue = ? WHERE userId = ? AND preferenceKey = ?",
      [
        JSON.stringify([retirementLegacyGoal, sameVersionGoalConflict]),
        8062,
        "patient_professional_goal_suggestions_v1",
      ]
    );
    assert.throws(
      () => runLegacyRetirement(true),
      /preferências profissionais legadas inválidas|Command failed/i,
      "equal-version conflicting legacy copies must block retirement"
    );
    const [canonicalAfterEqualVersionConflict] = await connection.query<
      mysql.RowDataPacket[]
    >("SELECT reason FROM professionalPatientAuthorizations WHERE id = ?", [
      untouched.id,
    ]);
    assert.equal(
      canonicalAfterEqualVersionConflict[0]?.reason,
      untouched.reason,
      "preflight conflict must not mutate the canonical authorization"
    );
    const [goalAfterEqualVersionConflict] = await connection.query<
      mysql.RowDataPacket[]
    >("SELECT rationale FROM professionalGoalSuggestions WHERE id = ?", [
      retirementLegacyGoal.id,
    ]);
    assert.equal(
      goalAfterEqualVersionConflict[0]?.rationale,
      retirementLegacyGoal.rationale,
      "preflight conflict must not mutate the canonical goal suggestion"
    );
    const [rowsAfterEqualVersionConflict] = await connection.query<
      mysql.RowDataPacket[]
    >(
      "SELECT COUNT(*) AS total FROM userPreferences WHERE preferenceKey IN (?, ?, ?, ?)",
      [
        "professional_profile_v1",
        "professional_accesses_v1",
        "patient_professional_access_requests_v1",
        "patient_professional_goal_suggestions_v1",
      ]
    );
    assert.equal(
      Number(rowsAfterEqualVersionConflict[0]?.total) > 0,
      true,
      "equal-version conflicts must preserve every legacy preference"
    );
    await connection.query(
      "DELETE FROM userPreferences WHERE userId = ? AND preferenceKey = ?",
      [8066, "patient_professional_access_requests_v1"]
    );
    await connection.query(
      "UPDATE userPreferences SET preferenceValue = ? WHERE userId = ? AND preferenceKey = ?",
      [
        JSON.stringify([retirementLegacyGoal]),
        8062,
        "patient_professional_goal_suggestions_v1",
      ]
    );

    await connection.query(
      "UPDATE professionalPatientAuthorizations SET reason = ?, sourceUpdatedAt = ? WHERE id = ?",
      [
        "Registro canônico propositalmente incompleto",
        new Date("2026-07-15T00:00:00.000Z"),
        untouched.id,
      ]
    );
    assert.throws(
      () => runLegacyRetirement(true),
      /Command failed|cobertura canônica está incompleta/i,
      "retirement apply must fail when a newer canonical row lost immutable legacy data"
    );
    const [retainedLegacyRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM userPreferences WHERE preferenceKey IN (?, ?, ?, ?)",
      [
        "professional_profile_v1",
        "professional_accesses_v1",
        "patient_professional_access_requests_v1",
        "patient_professional_goal_suggestions_v1",
      ]
    );
    assert.equal(
      Number(retainedLegacyRows[0]?.total) > 0,
      true,
      "failed coverage verification must retain every legacy preference"
    );
    await connection.query(
      "UPDATE professionalPatientAuthorizations SET reason = ?, sourceUpdatedAt = ? WHERE id = ?",
      [
        untouched.reason,
        new Date(untouched.approvedAt ?? untouched.requestedAt),
        untouched.id,
      ]
    );

    const retirementDryRun = runLegacyRetirement();
    assert.equal(retirementDryRun.apply, false);
    assert.equal(retirementDryRun.legacyRowsBeforeCleanup > 0, true);
    assert.equal(
      retirementDryRun.legacyRowsRemaining,
      retirementDryRun.legacyRowsBeforeCleanup,
      "verification mode must not delete legacy rows"
    );
    const retirementApply = runLegacyRetirement(true);
    assert.equal(retirementApply.apply, true);
    assert.equal(retirementApply.legacyRowsRemaining, 0);
    const [legacyRowsAfterRetirement] = await connection.query<
      mysql.RowDataPacket[]
    >(
      "SELECT COUNT(*) AS total FROM userPreferences WHERE preferenceKey IN (?, ?, ?, ?)",
      [
        "professional_profile_v1",
        "professional_accesses_v1",
        "patient_professional_access_requests_v1",
        "patient_professional_goal_suggestions_v1",
      ]
    );
    assert.equal(
      Number(legacyRowsAfterRetirement[0]?.total),
      0,
      "apply mode must remove only fully covered professional legacy preferences"
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
      getDb: getIntegrationDb,
      onWarning: () => undefined,
    });
    assert.equal(
      (await secondInstance.getApprovedAuthorization(8071, 8072))?.id,
      approved.id,
      "another instance must read the persisted state"
    );

    const contentCreatedAt = Date.parse("2026-07-14T22:00:00.000Z");
    const comment = await contentRepository.createComment({
      id: "comment-real-805",
      professionalUserId: 8071,
      patientUserId: 8072,
      comment: "Comentário persistente de integração.",
      createdAt: contentCreatedAt,
    });
    await contentRepository.createMealSuggestion({
      id: "meal-real-805",
      professionalUserId: 8071,
      patientUserId: 8072,
      mealLabel: "Almoço",
      title: "Plano persistente",
      description: "Arroz, feijão, proteína e vegetais.",
      rationale: "Validar persistência entre instâncias.",
      status: "sent",
      createdAt: contentCreatedAt + 1_000,
    });
    await contentRepository.createGoalSuggestion({
      id: "goal-real-805",
      professionalUserId: 8071,
      patientUserId: 8072,
      rationale: "Validar decisão idempotente.",
      status: "sent",
      goal: {
        defaultGoal: {
          calories: 1800,
          proteinGrams: 120,
          carbsGrams: 190,
          fatGrams: 55,
        },
        exceptions: [],
      },
      createdAt: contentCreatedAt + 2_000,
    });

    const contentSecondInstance = createDrizzleProfessionalContentRepository({
      getDb: getIntegrationDb,
      onWarning: () => undefined,
    });
    assert.equal(
      (await contentSecondInstance.listComments(8071, 8072))[0]?.id,
      comment.id,
      "another instance must read the persisted professional comment"
    );
    assert.equal(
      (await contentSecondInstance.listMealSuggestions(8071, 8072))[0]?.id,
      "meal-real-805",
      "another instance must read the persisted meal suggestion"
    );

    const [acceptedA, acceptedB] = await Promise.all([
      contentRepository.transitionGoalSuggestion(
        8072,
        "goal-real-805",
        "accepted",
        contentCreatedAt + 3_000
      ),
      contentSecondInstance.transitionGoalSuggestion(
        8072,
        "goal-real-805",
        "accepted",
        contentCreatedAt + 3_000
      ),
    ]);
    assert.equal(acceptedA.status, "accepted");
    assert.equal(acceptedB.status, "accepted");
    await assert.rejects(
      () =>
        contentRepository.transitionGoalSuggestion(
          8072,
          "goal-real-805",
          "refused",
          contentCreatedAt + 4_000
        ),
      /já foi respondida/
    );

    const [contentEventRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM `professionalHistoryEvents` WHERE `entityId` IN (?, ?, ?)",
      ["comment-real-805", "meal-real-805", "goal-real-805"]
    );
    assert.equal(
      Number(contentEventRows[0]?.total),
      4,
      "content and goal decision must create one durable event each"
    );

    const legacyGoal = {
      id: "legacy-goal-805",
      professionalUserId: 8061,
      patientUserId: 8062,
      rationale: "Sugestão legada",
      status: "sent",
      goal: {
        defaultGoal: {
          calories: 1750,
          proteinGrams: 115,
          carbsGrams: 180,
          fatGrams: 54,
        },
        exceptions: [],
      },
      createdAt: contentCreatedAt,
      sentAt: contentCreatedAt,
      respondedAt: null,
    };
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `preferenceValue` = VALUES(`preferenceValue`)",
      [
        8062,
        "patient_professional_goal_suggestions_v1",
        JSON.stringify([legacyGoal]),
      ]
    );
    const firstLegacyContent =
      await contentRepository.migrateAllLegacyGoalSuggestions();
    const secondLegacyContent =
      await contentRepository.migrateAllLegacyGoalSuggestions();
    assert.equal(firstLegacyContent.migrated, 1);
    assert.equal(secondLegacyContent.migrated, 0);
    assert.equal(
      (await contentSecondInstance.listGoalSuggestionsByPatient(8062))[0]?.id,
      legacyGoal.id
    );

    const approvedTracking = await repository.getTrackingByAuthorization(
      approved.id
    );
    assert.ok(
      approvedTracking,
      "approved authorization must have a tracking for official goals"
    );
    await connection.beginTransaction();
    try {
      await connection.query(
        `INSERT INTO professionalOfficialGoals (
          id, authorizationId, trackingId, professionalUserId, patientUserId, activePatientKey,
          version, status, calories, proteinGrams, carbsGrams, fatGrams, exceptionsJson,
          includeExerciseCalories, effectiveFrom, justification
        ) VALUES (?, ?, ?, ?, ?, ?, 1, 'active', 1900, 130, 200, 60, ?, true, ?, ?)`,
        [
          "official-goal-v1-809",
          approved.id,
          approvedTracking.id,
          8071,
          8072,
          "8072",
          JSON.stringify([]),
          new Date("2026-07-20T00:00:00.000Z"),
          "Primeira versão oficial",
        ]
      );
      await connection.query(
        "INSERT INTO professionalGoalReviewRequests (id, goalId, professionalUserId, patientUserId, openRequestKey, reason) VALUES (?, ?, ?, ?, ?, ?)",
        [
          "official-review-809",
          "official-goal-v1-809",
          8071,
          8072,
          "8072:official-goal-v1-809",
          "Revisar distribuição",
        ]
      );
      await connection.query(
        "INSERT INTO professionalGoalNotifications (id, goalId, patientUserId, idempotencyKey, status) VALUES (?, ?, ?, ?, 'failed')",
        [
          "official-notification-809",
          "official-goal-v1-809",
          8072,
          "professional-goal:official-goal-v1-809:activated",
        ]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    await assert.rejects(
      () =>
        connection.query(
          `INSERT INTO professionalOfficialGoals (
          id, authorizationId, trackingId, professionalUserId, patientUserId, activePatientKey,
          version, status, calories, proteinGrams, carbsGrams, fatGrams, exceptionsJson,
          includeExerciseCalories, effectiveFrom, justification
        ) VALUES (?, ?, ?, ?, ?, ?, 2, 'active', 2000, 140, 210, 65, ?, true, ?, ?)`,
          [
            "official-goal-conflict-809",
            approved.id,
            approvedTracking.id,
            8071,
            8072,
            "8072",
            JSON.stringify([]),
            new Date("2026-07-27T00:00:00.000Z"),
            "Conflito",
          ]
        ),
      /Duplicate entry/
    );
    await connection.beginTransaction();
    try {
      await connection.query(
        "UPDATE professionalOfficialGoals SET activePatientKey = NULL, status = 'superseded', effectiveUntil = ? WHERE id = ? AND version = 1",
        [new Date("2026-07-27T00:00:00.000Z"), "official-goal-v1-809"]
      );
      await connection.query(
        `INSERT INTO professionalOfficialGoals (
          id, authorizationId, trackingId, professionalUserId, patientUserId, activePatientKey,
          version, status, calories, proteinGrams, carbsGrams, fatGrams, exceptionsJson,
          includeExerciseCalories, effectiveFrom, justification, supersedesGoalId
        ) VALUES (?, ?, ?, ?, ?, ?, 2, 'active', 2000, 140, 210, 65, ?, false, ?, ?, ?)`,
        [
          "official-goal-v2-809",
          approved.id,
          approvedTracking.id,
          8071,
          8072,
          "8072",
          JSON.stringify([
            {
              weekday: 5,
              durationType: "always",
              calories: 2200,
              proteinGrams: 145,
              carbsGrams: 240,
              fatGrams: 70,
            },
          ]),
          new Date("2026-07-27T00:00:00.000Z"),
          "Revisão oficial",
          "official-goal-v1-809",
        ]
      );
      await connection.query(
        "UPDATE professionalGoalReviewRequests SET status = 'resolved', openRequestKey = NULL, resolvedByUserId = ?, resolvedAt = NOW() WHERE id = ?",
        [8071, "official-review-809"]
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
    const [officialGoalRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT id, version, status, activePatientKey, effectiveFrom, effectiveUntil FROM professionalOfficialGoals WHERE patientUserId = ? ORDER BY version",
      [8072]
    );
    assert.equal(officialGoalRows.length, 2);
    assert.equal(
      officialGoalRows.filter(row => row.activePatientKey !== null).length,
      1
    );
    assert.equal(
      new Date(officialGoalRows[0].effectiveUntil).toISOString().slice(0, 10),
      "2026-07-27"
    );
    const [resolvedReviewRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT status, openRequestKey FROM professionalGoalReviewRequests WHERE id = ?",
      ["official-review-809"]
    );
    assert.deepEqual(
      {
        status: resolvedReviewRows[0].status,
        openRequestKey: resolvedReviewRows[0].openRequestKey,
      },
      { status: "resolved", openRequestKey: null }
    );
    const canonicalGoal = await getNutritionGoalForDate(8072, "2026-07-20");
    assert.equal(canonicalGoal.today.goalOrigin, "professional");
    assert.equal(canonicalGoal.today.professionalGoalVersion, 1);
    assert.equal(canonicalGoal.today.calories, 1900);

    await repository.transitionAuthorization({
      authorizationId: approved.id,
      patientUserId: 8072,
      nextStatus: "revoked",
      responseOrigin: "web",
      now: new Date("2026-07-14T21:20:00.000Z"),
    });
    const [endedOfficialGoalRows] = await connection.query<
      mysql.RowDataPacket[]
    >(
      "SELECT status, activePatientKey, effectiveUntil, endReason FROM professionalOfficialGoals WHERE patientUserId = ? ORDER BY version",
      [8072]
    );
    assert.equal(endedOfficialGoalRows.length, 2);
    assert.ok(endedOfficialGoalRows.every(row => row.status === "ended"));
    assert.ok(
      endedOfficialGoalRows.every(row => row.activePatientKey === null)
    );
    assert.ok(
      endedOfficialGoalRows.every(
        row => row.endReason === "authorization_revoked"
      )
    );
    assert.ok(
      endedOfficialGoalRows.every(
        row =>
          new Date(row.effectiveUntil).toISOString() ===
          "2026-07-14T21:20:00.000Z"
      )
    );
    await assert.rejects(
      () =>
        secondInstance.transitionTracking({
          actorUserId: 8071,
          authorizationId: approved.id,
          nextStatus: "paused",
        }),
      /A autorização de dados não está ativa/
    );

    const staleApprovedCopy = legacyAccess({
      id: approved.id,
      professionalUserId: 8071,
      patientUserId: 8072,
      status: "approved",
    });
    const unrelatedAccess = legacyAccess({
      id: "unrelated-row-update-805",
      professionalUserId: 8071,
      patientUserId: 8062,
    });
    unrelatedAccess.requestedAt = Date.parse("2026-07-14T23:00:00.000Z");
    await connection.query(
      "INSERT INTO `userPreferences` (`userId`, `preferenceKey`, `preferenceValue`, `updatedAt`) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE `preferenceValue` = VALUES(`preferenceValue`), `updatedAt` = VALUES(`updatedAt`)",
      [
        8071,
        "professional_accesses_v1",
        JSON.stringify([staleApprovedCopy, unrelatedAccess]),
        new Date("2026-07-14T23:00:00.000Z"),
      ]
    );
    await repository.migrateAllLegacyData();
    assert.equal(
      (await repository.getAuthorizationById(approved.id))?.status,
      "revoked",
      "a stale link must not be resurrected by an unrelated preference row update"
    );
    assert.equal(
      await repository.getApprovedAuthorization(8071, 8072),
      null,
      "canonical security checks must remain revoked after legacy reconciliation"
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
