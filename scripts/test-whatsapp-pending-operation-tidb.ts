import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { shouldEnableRuntimeDatabaseSsl } from "../server/db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../server/repositories/whatsappPendingOperationRepository";

const databaseUrl = process.env.DATABASE_URL;
const TEST_USER_ID = 873001;

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the WhatsApp pending operation TiDB integration test."
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
  const repository = createDrizzleWhatsAppPendingOperationRepository({
    getDb: async () => integrationDb,
    onWarning: (scope, error) => {
      warnings.push({
        scope,
        error: error instanceof Error ? error.message : "unknown",
      });
    },
  });

  try {
    await connection.query(
      "DELETE FROM `whatsappPendingOperations` WHERE `userId` = ?",
      [TEST_USER_ID]
    );
    await connection.query("DELETE FROM `users` WHERE `id` = ?", [
      TEST_USER_ID,
    ]);
    await connection.query(
      "INSERT INTO `users` (`id`, `openId`, `name`, `email`, `role`) VALUES (?, ?, ?, ?, 'user')",
      [
        TEST_USER_ID,
        "whatsapp-pending-operation-873",
        "WhatsApp Pending Operation Test",
        "whatsapp-pending-operation-873@example.com",
      ]
    );

    const created = await repository.createPendingOperation({
      userId: TEST_USER_ID,
      type: "food_registration_clarification",
      target: {
        kind: "food_registration_clarification",
        contractVersion: 1,
        pendingKind: "quantity",
        classification: "open",
        integrationTest: "issue-873",
      },
      origin: "foodClarification",
      ttlMs: 10 * 60 * 1000,
      now: new Date("2026-07-22T12:00:00.000Z"),
    });

    assert.ok(created, "repository must return the row created by TiDB insert");
    assert.equal(created.userId, TEST_USER_ID);
    assert.equal(created.type, "food_registration_clarification");
    assert.equal(created.origin, "foodClarification");
    assert.equal(created.state, "active");
    assert.equal(created.version, 1);
    assert.ok(
      Number.isInteger(created.id) && created.id > 0,
      "created id must be a positive integer"
    );

    const active = await repository.getActivePendingOperation(
      TEST_USER_ID,
      new Date("2026-07-22T12:01:00.000Z")
    );
    assert.equal(active?.id, created.id);
    assert.deepEqual(active?.target, created.target);
    assert.deepEqual(warnings, []);
  } finally {
    await connection.query(
      "DELETE FROM `whatsappPendingOperations` WHERE `userId` = ?",
      [TEST_USER_ID]
    );
    await connection.query("DELETE FROM `users` WHERE `id` = ?", [
      TEST_USER_ID,
    ]);
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
