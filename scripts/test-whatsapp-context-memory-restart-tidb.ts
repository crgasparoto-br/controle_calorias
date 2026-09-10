import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";

const SCRIPT_PATH = "scripts/test-whatsapp-context-memory-restart-tidb.ts";
const MEMORY_KEY_PREFIX = "whatsapp_context_memory_v1:%";

function requireDatabaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  assert.ok(value, "DATABASE_URL is required for the TiDB restart regression");
  return value;
}

async function runWritePhase(userId: number) {
  const { persistWhatsappReusablePreparationPreferenceFromText } = await import(
    "../server/modules/whatsapp/personalPreparationPreference"
  );

  const persisted = await persistWhatsappReusablePreparationPreferenceFromText({
    userId,
    text: "normalmente tomo café sem açúcar",
    createdAt: new Date("2026-09-10T12:00:00.000Z"),
  });

  assert.equal(persisted?.recognized, true);
  assert.equal(persisted?.persisted, true, "preference must be persisted in TiDB, not process memory");
  assert.equal(persisted?.choice, "without_sugar");
  assert.ok(persisted?.memory?.id, "persisted memory must receive the durable row id");
  console.log(`WRITE_OK user=${userId} memory=${persisted.memory.id}`);
}

async function runReadPhase(userId: number) {
  const { resolveWhatsappPersonalPreparationPreference } = await import(
    "../server/modules/whatsapp/personalPreparationPreference"
  );

  const resolved = await resolveWhatsappPersonalPreparationPreference({
    userId,
    subject: "café",
    intent: "add_foods_to_meal",
    now: new Date("2026-09-10T12:05:00.000Z"),
  });

  assert.equal(resolved.status, "applied", "a fresh process must recover the persisted preference");
  if (resolved.status !== "applied") return;
  assert.equal(resolved.choice, "without_sugar");
  assert.equal(resolved.memory.userId, userId);
  assert.equal(resolved.memory.key, "food-preparation:cafe");
  console.log(`READ_OK user=${userId} memory=${resolved.memory.id} choice=${resolved.choice}`);
}

function runFreshProcess(phase: "write" | "read", userId: number) {
  const result = spawnSync(
    "pnpm",
    ["exec", "tsx", SCRIPT_PATH, phase, String(userId)],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        ALLOW_MEMORY_PERSISTENCE: "false",
      },
      encoding: "utf8",
      timeout: 30_000,
    },
  );

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  assert.equal(result.error, undefined, `${phase} process could not start or timed out`);
  assert.equal(result.status, 0, `${phase} process failed`);
}

async function runParentPhase() {
  const connection = await mysql.createConnection(requireDatabaseUrl());
  const openId = `issue1059-restart-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let userId: number | null = null;

  try {
    const [created] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users (openId, name) VALUES (?, ?)",
      [openId, "Issue 1059 restart regression"],
    );
    userId = created.insertId;
    assert.ok(userId > 0, "fixture user must be created in TiDB");

    runFreshProcess("write", userId);

    const [persistedRows] = await connection.execute<RowDataPacket[]>(
      "SELECT id, preferenceKey FROM userPreferences WHERE userId = ? AND preferenceKey LIKE ?",
      [userId, MEMORY_KEY_PREFIX],
    );
    assert.equal(persistedRows.length, 1, "writer process must leave exactly one durable contextual-memory row");

    runFreshProcess("read", userId);
    console.log(`ISSUE1059_TIDB_RESTART_OK user=${userId}`);
  } finally {
    if (userId) {
      await connection.execute("DELETE FROM users WHERE id = ?", [userId]);
    }
    await connection.end();
  }
}

async function main() {
  requireDatabaseUrl();
  const phase = process.argv[2];
  const userId = Number(process.argv[3]);

  if (phase === "write" || phase === "read") {
    assert.ok(Number.isInteger(userId) && userId > 0, "child phase requires a positive user id");
    if (phase === "write") await runWritePhase(userId);
    else await runReadPhase(userId);
    process.exit(0);
  }

  await runParentPhase();
}

await main();
