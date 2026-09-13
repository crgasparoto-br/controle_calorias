import "dotenv/config";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { getDb, logPersistenceWarning } from "../server/db";
import { createDrizzleWhatsAppPendingOperationRepository } from "../server/repositories/whatsappPendingOperationRepository";
import {
  createWhatsappMealIntentRegistrationDetailsInteraction,
} from "../server/modules/whatsapp/mealIntentRegistrationDetailsInteraction";
import { simulateWhatsappInbound } from "../server/modules/whatsapp/service";
import type { CountableRegistrationContinuation } from "../server/modules/whatsapp/countableFoodRegistrationGate";

const databaseUrl = process.env.DATABASE_URL;
const phase = process.env.ISSUE_1057_RESTART_PHASE ?? "parent";
const RESTART_TEST_USER_ID = 1057002;
const CONCURRENCY_TEST_USER_ID = 1057003;
const ORIGINAL_TEXT = "2 fatias de pão de forma Panco";
const REPLY_TEXT = "Pão de forma Panco Premium";
const ORIGINAL_MESSAGE_ID = "wamid-1057-restart-origin";
const REPLY_MESSAGE_ID = "wamid-1057-restart-reply";
const scriptPath = fileURLToPath(import.meta.url);
const pendingOperationRepository = createDrizzleWhatsAppPendingOperationRepository({
  getDb,
  onWarning: logPersistenceWarning,
});

if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the issue #1057 restart TiDB regression."
  );
}

type RaceReadyMessage = {
  kind: "ready";
  label: string;
  pid: number;
  pendingOperationId: number;
  version: number;
};

type RaceWorkerResult = {
  label: string;
  pid: number;
  pendingOperationId: number;
  version: number;
  action: string | null;
  eventType: string | null;
};

function requiredOccurredAt() {
  const value = process.env.ISSUE_1057_OCCURRED_AT;
  if (!value) throw new Error("ISSUE_1057_OCCURRED_AT is required in child phases.");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    throw new Error("ISSUE_1057_OCCURRED_AT must be a valid ISO timestamp.");
  }
  return parsed;
}

function requiredTestUserId() {
  const value = Number(process.env.ISSUE_1057_TEST_USER_ID ?? RESTART_TEST_USER_ID);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("ISSUE_1057_TEST_USER_ID must be a positive integer.");
  }
  return value;
}

function parseJsonTarget(value: unknown): Record<string, unknown> {
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (value && typeof value === "object") return value as Record<string, unknown>;
  throw new Error("Expected persisted pending target JSON.");
}

function isRaceReadyMessage(value: unknown): value is RaceReadyMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<RaceReadyMessage>;
  return candidate.kind === "ready"
    && typeof candidate.label === "string"
    && Number.isSafeInteger(candidate.pid)
    && Number.isSafeInteger(candidate.pendingOperationId)
    && Number.isSafeInteger(candidate.version);
}

async function seedPendingQuestion() {
  const occurredAt = requiredOccurredAt();
  const userId = requiredTestUserId();
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
    userId,
    originalText: ORIGINAL_TEXT,
    registrationText: ORIGINAL_TEXT,
    inboundMessageId: ORIGINAL_MESSAGE_ID,
    prompt: "Qual variante de pão de forma Panco você quis registrar?",
    receivedAt: occurredAt,
    countableContext,
  });

  assert.equal(result?.action, "clarification_needed");
  assert.equal(
    result?.eventType,
    "whatsapp.meal_intent_decision.registration_details_requested"
  );
  console.log(
    `ISSUE1057_RESTART_SEED=${JSON.stringify({ pid: process.pid, userId, action: result?.action, eventType: result?.eventType })}`
  );
}

async function resolveAfterRestart() {
  const occurredAt = requiredOccurredAt();
  const userId = requiredTestUserId();
  const result = await simulateWhatsappInbound(userId, {
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
    `ISSUE1057_RESTART_RESOLVE=${JSON.stringify({ pid: process.pid, userId, action: result.action, eventType: result.eventType })}`
  );
}

async function waitForRaceStart() {
  if (typeof process.send !== "function") {
    throw new Error("Concurrency worker requires an IPC channel.");
  }
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for concurrency start signal.")),
      15_000
    );
    process.once("message", message => {
      clearTimeout(timeout);
      if (message !== "go") {
        reject(new Error("Unexpected concurrency worker IPC message."));
        return;
      }
      resolve();
    });
  });
}

async function resolveConcurrentWorker() {
  const occurredAt = requiredOccurredAt();
  const userId = requiredTestUserId();
  const label = process.env.ISSUE_1057_RACE_LABEL ?? "worker";
  const pendingOperation = await pendingOperationRepository.getActivePendingOperation(
    userId,
    new Date(occurredAt.getTime() + 500)
  );
  assert.ok(pendingOperation, "concurrency worker must preload the active pending operation");

  if (typeof process.send !== "function") {
    throw new Error("Concurrency worker requires an IPC channel.");
  }
  process.send({
    kind: "ready",
    label,
    pid: process.pid,
    pendingOperationId: pendingOperation.id,
    version: pendingOperation.version,
  } satisfies RaceReadyMessage);

  await waitForRaceStart();
  const result = await simulateWhatsappInbound(userId, {
    text: REPLY_TEXT,
    messageId: `${REPLY_MESSAGE_ID}-${label}`,
    receivedAt: new Date(occurredAt.getTime() + 1_000),
    userTimezone: "America/Sao_Paulo",
  });

  console.log(
    `ISSUE1057_CONCURRENCY_WORKER=${JSON.stringify({
      label,
      pid: process.pid,
      pendingOperationId: pendingOperation.id,
      version: pendingOperation.version,
      action: result?.action ?? null,
      eventType: result?.eventType ?? null,
    } satisfies RaceWorkerResult)}`
  );
}

function runChild(
  childPhase: "seed" | "resolve",
  occurredAt: string,
  userId: number = RESTART_TEST_USER_ID
) {
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ISSUE_1057_RESTART_PHASE: childPhase,
        ISSUE_1057_OCCURRED_AT: occurredAt,
        ISSUE_1057_TEST_USER_ID: String(userId),
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

function spawnRaceWorker(label: string, occurredAt: string, userId: number) {
  const child = spawn(process.execPath, ["--import", "tsx", scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ISSUE_1057_RESTART_PHASE: "race-resolve",
      ISSUE_1057_OCCURRED_AT: occurredAt,
      ISSUE_1057_TEST_USER_ID: String(userId),
      ISSUE_1057_RACE_LABEL: label,
    },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout?.on("data", chunk => {
    stdout += String(chunk);
  });
  child.stderr?.on("data", chunk => {
    stderr += String(chunk);
  });

  const ready = new Promise<RaceReadyMessage>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Timed out waiting for ${label} to preload pending state.`)),
      20_000
    );
    child.on("message", message => {
      if (!isRaceReadyMessage(message)) return;
      clearTimeout(timeout);
      resolve(message);
    });
    child.once("exit", code => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout);
        reject(new Error(`${label} exited before race start with code ${code}: ${stderr}`));
      }
    });
  });

  const done = new Promise<string>((resolve, reject) => {
    child.once("close", code => {
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(`${label} concurrency worker exited with code ${code}: ${stderr}`));
    });
  });

  return { child, ready, done };
}

function parseRaceWorkerResult(output: string) {
  const match = output.match(/ISSUE1057_CONCURRENCY_WORKER=(\{.*\})/);
  assert.ok(match?.[1], "concurrency worker must emit its structured result");
  return JSON.parse(match[1]) as RaceWorkerResult;
}

async function cleanupUser(connection: mysql.Connection, userId: number) {
  await connection.query("DELETE FROM `meals` WHERE `userId` = ?", [userId]);
  await connection.query(
    "DELETE FROM `whatsappPendingOperations` WHERE `userId` = ?",
    [userId]
  );
  await connection.query("DELETE FROM `users` WHERE `id` = ?", [userId]);
}

async function createTestUser(connection: mysql.Connection, userId: number, suffix: string) {
  await cleanupUser(connection, userId);
  await connection.query(
    "INSERT INTO `users` (`id`, `openId`, `name`, `email`, `role`) VALUES (?, ?, ?, ?, 'user')",
    [
      userId,
      `issue-1057-${suffix}-user`,
      `Issue 1057 ${suffix} Test`,
      `issue-1057-${suffix}@example.com`,
    ]
  );
}

async function runRestartControl(connection: mysql.Connection) {
  const occurredAt = new Date().toISOString();
  await createTestUser(connection, RESTART_TEST_USER_ID, "restart");

  const seedOutput = runChild("seed", occurredAt, RESTART_TEST_USER_ID);
  const resolveOutput = runChild("resolve", occurredAt, RESTART_TEST_USER_ID);

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
    [RESTART_TEST_USER_ID]
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
    [RESTART_TEST_USER_ID]
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
}

async function runConcurrencyControl(connection: mysql.Connection) {
  const occurredAt = new Date().toISOString();
  await createTestUser(connection, CONCURRENCY_TEST_USER_ID, "concurrency");
  runChild("seed", occurredAt, CONCURRENCY_TEST_USER_ID);

  const first = spawnRaceWorker("worker-a", occurredAt, CONCURRENCY_TEST_USER_ID);
  const second = spawnRaceWorker("worker-b", occurredAt, CONCURRENCY_TEST_USER_ID);
  const [firstReady, secondReady] = await Promise.all([first.ready, second.ready]);

  assert.notEqual(firstReady.pid, secondReady.pid, "concurrency control must use distinct processes");
  assert.equal(
    firstReady.pendingOperationId,
    secondReady.pendingOperationId,
    "both workers must preload the same pending operation"
  );
  assert.equal(
    firstReady.version,
    secondReady.version,
    "both workers must preload the same pending operation version"
  );

  first.child.send("go");
  second.child.send("go");
  const [firstOutput, secondOutput] = await Promise.all([first.done, second.done]);
  const workerResults = [
    parseRaceWorkerResult(firstOutput),
    parseRaceWorkerResult(secondOutput),
  ];
  const successfulEffects = workerResults.filter(
    result => result.eventType === "whatsapp.meal_intent_decision.registration_details_requested"
  );
  assert.equal(
    successfulEffects.length,
    1,
    "two concurrent resolutions for the same id/version must produce exactly one successor effect"
  );

  const [pendingRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT `id`, `state`, `version`, `target` FROM `whatsappPendingOperations` WHERE `userId` = ? ORDER BY `id` ASC",
    [CONCURRENCY_TEST_USER_ID]
  );
  assert.equal(
    pendingRows.length,
    2,
    "concurrent resolution must leave one consumed original and exactly one active successor"
  );
  assert.equal(pendingRows[0]?.id, firstReady.pendingOperationId);
  assert.equal(pendingRows[0]?.state, "consumed");
  assert.equal(pendingRows[0]?.version, firstReady.version + 1);
  assert.equal(pendingRows[1]?.state, "active");

  const successorTarget = parseJsonTarget(pendingRows[1]?.target);
  assert.equal(
    successorTarget.registrationText,
    "2 fatias de pão de forma Panco Premium"
  );

  const [mealRows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT `id`, `status` FROM `meals` WHERE `userId` = ?",
    [CONCURRENCY_TEST_USER_ID]
  );
  assert.equal(
    mealRows.length,
    0,
    "concurrent identity resolution must not duplicate or partially persist meals"
  );

  console.log(
    `ISSUE1057_CONCURRENCY_CONTROL=${JSON.stringify({
      controlId: "CONCURRENCY-ATOMICITY-TIDB-001",
      workerPids: workerResults.map(result => result.pid),
      pendingOperationId: firstReady.pendingOperationId,
      expectedVersion: firstReady.version,
      successfulEffects: successfulEffects.length,
      originalState: pendingRows[0]?.state,
      originalVersion: pendingRows[0]?.version,
      successorCount: pendingRows.filter(row => row.state === "active").length,
      successorState: pendingRows[1]?.state,
      registrationText: successorTarget.registrationText,
      mealEffects: mealRows.length,
    })}`
  );
}

async function parent() {
  const connection = await mysql.createConnection(databaseUrl);

  try {
    await runRestartControl(connection);
    await runConcurrencyControl(connection);
  } finally {
    await cleanupUser(connection, RESTART_TEST_USER_ID);
    await cleanupUser(connection, CONCURRENCY_TEST_USER_ID);
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
} else if (phase === "race-resolve") {
  resolveConcurrentWorker()
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
