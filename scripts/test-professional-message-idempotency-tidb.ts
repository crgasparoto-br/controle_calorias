import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createProfessionalMessage } from "../server/modules/professionals/messageService";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the professional message idempotency integration test."
  );
}

const ids = {
  professional: 8181,
  patientA: 8182,
  patientB: 8183,
  otherProfessional: 8184,
};
const userIds = Object.values(ids);
const conflictMessage =
  "Esta chave de operação já foi usada em outra mensagem. Recarregue a conversa e tente novamente.";
const idempotencyKey = "professional-message-idempotency-tidb";

async function expectSafeConflict(operation: () => Promise<unknown>) {
  await assert.rejects(operation, error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, conflictMessage);
    assert.equal(error.message.includes("Paciente Alpha"), false);
    assert.equal(error.message.includes("Paciente Beta"), false);
    return true;
  });
}

async function main() {
  const connection = await mysql.createConnection(
    shouldEnableRuntimeDatabaseSsl(databaseUrl)
      ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } }
      : databaseUrl
  );

  try {
    await connection.query(
      `DELETE FROM professionalMessageDeliveryAttempts
       WHERE messageId IN (
         SELECT id FROM professionalMessages
         WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)
       )`,
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalHistoryEvents WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalMessages WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalConversations WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalPatientTrackingEvents WHERE actorUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional]
    );
    await connection.query(
      "DELETE FROM professionalPatientTrackings WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalPatientAuthorizations WHERE professionalUserId IN (?, ?) OR patientUserId IN (?, ?)",
      [ids.professional, ids.otherProfessional, ids.patientA, ids.patientB]
    );
    await connection.query(
      "DELETE FROM professionalProfiles WHERE userId IN (?, ?)",
      [ids.professional, ids.otherProfessional]
    );
    await connection.query(
      `DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );

    const users = [
      [ids.professional, "Nutricionista Principal"],
      [ids.patientA, "Paciente Alpha"],
      [ids.patientB, "Paciente Beta"],
      [ids.otherProfessional, "Nutricionista Secundário"],
    ] as const;
    for (const [id, name] of users) {
      await connection.query(
        "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
        [id, `message-idempotency-${id}`, name, `message-${id}@example.com`]
      );
    }

    for (const professionalId of [ids.professional, ids.otherProfessional]) {
      await connection.query(
        `INSERT INTO professionalProfiles
          (userId, displayName, registrationNumber, active, sourceUpdatedAt)
         VALUES (?, ?, ?, true, NOW())`,
        [professionalId, `Profissional ${professionalId}`, `CRN ${professionalId}`]
      );
    }

    const authorizations = [
      ["authorization-message-a", ids.professional, ids.patientA],
      ["authorization-message-b", ids.professional, ids.patientB],
      ["authorization-message-other", ids.otherProfessional, ids.patientA],
    ] as const;
    for (const [authorizationId, professionalId, patientId] of authorizations) {
      await connection.query(
        `INSERT INTO professionalPatientAuthorizations
          (id, professionalUserId, patientUserId, status, activePairKey, reason,
           requestedAt, approvedAt, respondedAt, responseOrigin, responseDecision, sourceUpdatedAt)
         VALUES (?, ?, ?, 'approved', ?, 'Teste de idempotência', NOW(), NOW(), NOW(), 'web', 'approved', NOW())`,
        [authorizationId, professionalId, patientId, `${professionalId}:${patientId}`]
      );
      await connection.query(
        `INSERT INTO professionalPatientTrackings
          (id, authorizationId, professionalUserId, patientUserId, status,
           startedAt, lastTransitionAt, lastTransitionByUserId)
         VALUES (?, ?, ?, ?, 'active', NOW(), NOW(), ?)`,
        [
          `tracking-${authorizationId}`,
          authorizationId,
          professionalId,
          patientId,
          professionalId,
        ]
      );
    }

    const originalInput = {
      patientId: ids.patientA,
      content: "Mensagem canônica do paciente Alpha",
      messageType: "guidance" as const,
      origin: "professional" as const,
      action: "save_draft" as const,
      idempotencyKey,
    };
    const original = await createProfessionalMessage(
      ids.professional,
      originalInput
    );
    const replay = await createProfessionalMessage(
      ids.professional,
      originalInput
    );
    assert.equal(replay.id, original.id, "equivalent replay must reuse the logical message");

    await expectSafeConflict(() =>
      createProfessionalMessage(ids.professional, {
        ...originalInput,
        patientId: ids.patientB,
      })
    );
    await expectSafeConflict(() =>
      createProfessionalMessage(ids.professional, {
        ...originalInput,
        content: "Conteúdo divergente",
      })
    );
    await expectSafeConflict(() =>
      createProfessionalMessage(ids.professional, {
        ...originalInput,
        action: "send_web",
      })
    );
    await expectSafeConflict(() =>
      createProfessionalMessage(ids.otherProfessional, originalInput)
    );

    const [messageRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT id, professionalUserId, patientUserId, requestedAction, content
       FROM professionalMessages WHERE idempotencyKey = ?`,
      [idempotencyKey]
    );
    assert.equal(messageRows.length, 1, "divergent retries must not create another message");
    assert.deepEqual(
      {
        professionalUserId: Number(messageRows[0].professionalUserId),
        patientUserId: Number(messageRows[0].patientUserId),
        requestedAction: messageRows[0].requestedAction,
        content: messageRows[0].content,
      },
      {
        professionalUserId: ids.professional,
        patientUserId: ids.patientA,
        requestedAction: "save_draft",
        content: originalInput.content,
      }
    );

    const [historyRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM professionalHistoryEvents
       WHERE entityType = 'professional_message' AND entityId = ?`,
      [original.id]
    );
    assert.equal(
      Number(historyRows[0]?.total),
      1,
      "equivalent and divergent retries must not duplicate history"
    );

    console.log(
      JSON.stringify({
        event: "professional.message_idempotency.integration.passed",
        messageId: original.id,
      })
    );
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(
    JSON.stringify({
      event: "professional.message_idempotency.integration.failed",
      error: error instanceof Error ? error.message : "UnknownError",
    })
  );
  process.exitCode = 1;
});
