import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { createWhatsappMealIntentRegistrationDetailsInteraction } from "../server/modules/whatsapp/mealIntentRegistrationDetailsInteraction";
import { simulateWhatsappInbound } from "../server/modules/whatsapp/service";
import type { CountableRegistrationContinuation } from "../server/modules/whatsapp/countableFoodRegistrationGate";

const databaseUrl = process.env.DATABASE_URL;
const phase = process.env.ISSUE_1057_RESTART_PHASE ?? "parent";
const TEST_USER_ID = 1057002;
const ORIGINAL_TEXT = "2 fatias de pão de forma Panco";
const REPLY_TEXT = "Pão de forma Panco Premium";
const ORIGINAL_MESSAGE_ID = "wamid-1057-restart-origin";
const REPLY_MESSAGE_ID = "wamid-1057-restart-reply";
const scriptPath = fileURLToPath(import.meta.url);

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the issue #1057 restart TiDB regression."
  );
}

function requiredOccurredAt() {
  const value = process.env.ISSUE_1057_OCCURRED_AT;
  if (!value) throw new Error("ISSUE_1057_OCCURRED_AT is required in child phases.");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("ISSUE_1057_OCCURRED_AT must be a valid ISO timestamp.");
  }
  return parsed;
}

function parseJsonTarget(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error("Expected persisted pending target JSON.");
}

async function seedPendingQuestion() {
  const occurredAt = requiredOccurredAt();
  const countableContext: CountableRegistrationContinuation = {
    registrationSegments: [ORIGINAL_TEXT],
    itemIndex: 0,
    resolvedSegments: [],
    occurredAt: occurredAt.toISOString(),
    userTimezone: "America/Sao_Paulo",
    clarification: {
      originalText: "pão de forma panco",
      foodName: "Pão de forma Panco",
      brand: "Panco",
      clarificationReason: "brand_variant_unresolved",
      alternatives: [],
    },
  };

  const result = await createWhatsappMealIntentRegistrationDetailsInteraction({
    userId: TEST_USER_ID,
    originalText: ORIGINAL_TEXT,
    registrationText: ORIGINAL_TEXT,
    inboundMessageId: ORIGINAL_MESSAGE_ID,
    prompt: "Qual variante de pão de forma Panco você quis registrar?",
    receivedAt: occurredAt,
    countableContext,
  });

  assert.equal(result.action, "clarification_needed");
  assert.equal(
    result.eventType,
    "whatsapp.meal_intent_decision.registration_details_requested"
  );
  console.log(
    `ISSUE1057_RESTART_SEED=${JSON.stringify({ pid: process.pid, action: result.action, eventType: result.eventType })}`
  );
}

async function resolveAfterRestart() {
  const occurredAt = requiredOccurredAt();
  const result = await simulateWhatsappInbound(TEST_USER_ID, {
    text: REPLY_TEXT,
    messageId: REPLY_MESSAGE_ID,
    receivedAt: new Date(occurredAt.getTime() + 1_000),
    userTimezone: "America/Sao_Paulo",
  });

  assert.equal(result.handled, true);
  assert.equal(result.action, "clarification_needed");
  assert.equal(
    result.eventType,
    "whatsapp.meal_intent_decision.registration_details_requested"
  );
  console.log(
    `ISSUE1057_RESTART_RESOLVE=${JSON.stringify({ pid: process.pid, action: result.action, eventType: result.eventType })}`
  );
}

function runChild(childPhase: "seed" | "resolve", occurredAt: string) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ISSUE_1057_RESTART_PHASE: childPhase,
        ISSUE_1057_OCCURRED_AT: occurredAt,
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }
  );

  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  assert.equal(
    child.status,
    0,
    `issue #1057 ${childPhase} process must exit successfully`
  );
  return child.stdout;
}

async function parent() {
  const connection = await mysql.createConnection(databaseUrl);
  const occurredAt = new Date().toISOString();

  try {
    await connection.query("DELETE FROM `meals` WHERE `userId` = ?", [TEST_USER_ID]);
    await connection.query(
      "DELETE FROM `whatsappPendingOperations` WHERE `userId` = ?",
      [TEST_USER_ID]
    );
    await connection.query("DELETE FROM `users` WHERE `id` = ?", [TEST_USER_ID]);
    await connection.query(
      "INSERT INTO `users` (`id`, `openId`, `name`, `email`, `role`) VALUES (?, ?, ?, ?, 'user')",
      [
        TEST_USER_ID,
        "issue-1057-restart-user",
        "Issue 1057 Restart Test",
        "issue-1057-restart@example.com",
      ]
    );

    const seedOutput = runChild("seed", occurredAt);
    const resolveOutput = runChild("resolve", occurredAt);

    const seedPid = Number(
      seedOutput.match(/ISSUE1057_RESTART_SEED=.*?"pid":(\d+)/)?.[1]
    );
    const resolvePid = Number(
      resolveOutput.match(/ISSUE1057_RESTART_RESOLVE=.*?"pid":(\d+)/)?.[1]
    );
    assert.ok(seedPid > 0 && resolvePid > 0);
    assert.notEqual(seedPid, resolvePid, "restart control must cross a process boundary");

    const [pendingRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT `id`, `state`, `version`, `target` FROM `whatsappPendingOperations` WHERE `userId` = ? ORDER BY `id` ASC",
      [TEST_USER_ID]
    );
    assert.equal(
      pendingRows.length,
      2,
      "restart response must consume the original operation and persist exactly one successor"
    );
    assert.equal(pendingRows[0]?.state, "consumed");
    assert.equal(pendingRows[1]?.state, "active");

    const originalTarget = parseJsonTarget(pendingRows[0]?.target);
    const successorTarget = parseJsonTarget(pendingRows[1]?.target);
    assert.equal(originalTarget.registrationText, ORIGINAL_TEXT);
    assert.equal(successorTarget.inboundMessageId, ORIGINAL_MESSAGE_ID);
    assert.equal(
      successorTarget.registrationText,
      "2 fatias de pão de forma Panco Premium"
    );

    const countableContext = successorTarget.countableContext as
      | { registrationSegments?: unknown[] }
      | undefined;
    assert.deepEqual(countableContext?.registrationSegments, [
      "2 fatias de pão de forma Panco Premium",
    ]);
    assert.doesNotMatch(
      String(successorTarget.registrationText),
      /Panco\s+Pão de forma Panco/i,
      "semantic restart merge must not duplicate the base food identity"
    );

    const [mealRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT `id`, `status` FROM `meals` WHERE `userId` = ?",
      [TEST_USER_ID]
    );
    assert.equal(
      mealRows.length,
      0,
      "restart continuation must not persist a partial meal while identity is still unresolved"
    );

    console.log(
      `ISSUE1057_RESTART_CONTROL=${JSON.stringify({
        controlId: "RESTART-IDEM-001",
        seedPid,
        resolvePid,
        originalState: pendingRows[0]?.state,
        successorState: pendingRows[1]?.state,
        registrationText: successorTarget.registrationText,
        originalInboundMessageId: successorTarget.inboundMessageId,
        mealEffects: mealRows.length,
        auxiliaryRecoveryCallBeforeReply: false,
      })}`
    );
  } finally {
    await connection.query("DELETE FROM `meals` WHERE `userId` = ?", [TEST_USER_ID]);
    await connection.query(
      "DELETE FROM `whatsappPendingOperations` WHERE `userId` = ?",
      [TEST_USER_ID]
    );
    await connection.query("DELETE FROM `users` WHERE `id` = ?", [TEST_USER_ID]);
    await connection.end();
  }
}

function exitChildAfterFlush() {
  process.stdout.write("", () => process.exit(0));
}

if (phase === "seed") {
  seedPendingQuestion()
    .then(exitChildAfterFlush)
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
} else if (phase === "resolve") {
  resolveAfterRestart()
    .then(exitChildAfterFlush)
    .catch(error => {
      console.error(error);
      process.exit(1);
    });
} else {
  parent().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
