import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  crashNextDownstream: true,
  downstreamCalls: 0,
  questionCalls: 0,
}));

vi.mock("./modules/billing/service", () => ({
  billingService: {
    getUserEntitlements: vi.fn(async () => ({ allowed: true })),
  },
}));

vi.mock("./whatsappBillingWriteGate", () => ({
  gateSuspendedWhatsAppWrites: vi.fn(async (payload: unknown) => ({
    handledCount: 0,
    remainingPayload: payload,
  })),
}));

vi.mock("./modules/whatsapp/aiQuestionAssistant", async () => {
  const actual = await vi.importActual<typeof import("./modules/whatsapp/aiQuestionAssistant")>(
    "./modules/whatsapp/aiQuestionAssistant",
  );
  return {
    ...actual,
    executeWhatsappAiQuestionIntent: vi.fn(async () => {
      controls.questionCalls += 1;
      return {
        handled: true,
        action: "ai_question_answered",
        reply: "Resposta final única após recuperar o owner órfão.",
        eventType: "whatsapp.ai_question.answered",
        detail: "RESTART-IDEM-001 recovered question response.",
        data: { usedUserKnowledgeBase: true },
      };
    }),
  };
});

vi.mock("./whatsappIntentWebhook", async () => {
  const actual = await vi.importActual<typeof import("./whatsappIntentWebhook")>(
    "./whatsappIntentWebhook",
  );
  return {
    ...actual,
    handleWhatsAppWebhookWithTextIntent: async (
      ...args: Parameters<typeof actual.handleWhatsAppWebhookWithTextIntent>
    ) => {
      controls.downstreamCalls += 1;
      if (controls.crashNextDownstream) {
        controls.crashNextDownstream = false;
        throw new Error("simulated abrupt runtime termination after persistent claim");
      }
      return actual.handleWhatsAppWebhookWithTextIntent(...args);
    },
  };
});

const { getDb, logPersistenceWarning, upsertUserWhatsappConnection } = await import("./db");
const {
  createMessageLifecycleService,
  withMessageLifecycleService,
} = await import("./modules/whatsapp/messageLifecycle");
const { createDrizzleWhatsAppConversationRepository } = await import(
  "./repositories/whatsappConversationRepository"
);
const { createDrizzleWhatsAppProcessingClaimRepository } = await import(
  "./repositories/whatsappProcessingClaimRepository"
);
const {
  handleWhatsAppPersistentContextWebhook,
} = await import("./whatsappPersistentContextWebhook");
const {
  __resetWhatsAppImageIdempotencyForTests,
} = await import("./whatsappImageIdempotencyWebhook");

const ACK_TEXT = "✅ Recebi sua pergunta. Estou preparando a resposta…";
const FINAL_TEXT = "Resposta final única após recuperar o owner órfão.";
const HEARTBEAT_TIMEOUT_MS = 1_500;
const HEARTBEAT_INTERVAL_MS = 250;

function createRuntime(ownerToken: string) {
  return createMessageLifecycleService({
    conversationRepository: createDrizzleWhatsAppConversationRepository({
      getDb,
      onWarning: logPersistenceWarning,
    }),
    processingClaimRepository: createDrizzleWhatsAppProcessingClaimRepository({
      getDb,
      onWarning: logPersistenceWarning,
    }),
    processingHeartbeatTimeoutMs: HEARTBEAT_TIMEOUT_MS,
    processingHeartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
    ownerTokenFactory: () => ownerToken,
  });
}

function createPayload(phoneNumber: string, messageId: string) {
  return {
    entry: [{
      changes: [{
        value: {
          metadata: {
            phone_number_id: "phone-number-test",
            display_phone_number: "5511000000000",
          },
          messages: [{
            id: messageId,
            from: phoneNumber,
            timestamp: "1789164000",
            type: "text",
            text: { body: "/como está minha proteína hoje?" },
          }],
        },
      }],
    }],
  };
}

function createResponse() {
  return {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

async function deliver(
  runtime: ReturnType<typeof createRuntime>,
  payload: ReturnType<typeof createPayload>,
) {
  const response = createResponse();
  await withMessageLifecycleService(runtime, () =>
    handleWhatsAppPersistentContextWebhook(
      { body: structuredClone(payload) } as never,
      response as never,
    ),
  );
  return response;
}

const describeTidb = process.env.WHATSAPP_RESTART_TIDB_REGRESSION === "1"
  ? describe
  : describe.skip;

describeTidb("RESTART-IDEM-001: webhook canônico + lifecycle persistente em TiDB", () => {
  let outboundPayloads: Array<Record<string, any>> = [];

  beforeEach(() => {
    controls.crashNextDownstream = true;
    controls.downstreamCalls = 0;
    controls.questionCalls = 0;
    outboundPayloads = [];
    __resetWhatsAppImageIdempotencyForTests();

    process.env.OPENAI_API_KEY = "sk-restart-idem-test";
    process.env.AI_QUESTION_PROVIDER = "openai";
    process.env.AI_QUESTION_MODEL = "gpt-4.1-mini";
    process.env.AI_QUESTION_MAX_ATTEMPTS = "1";
    process.env.AI_QUESTION_FALLBACK_ENABLED = "false";
    process.env.WHATSAPP_ACCESS_TOKEN = "access-token-test";
    process.env.WHATSAPP_PHONE_NUMBER = "5511000000000";
    process.env.WHATSAPP_PHONE_NUMBER_ID = "phone-number-test";

    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/messages")) {
        const payload = JSON.parse(String(init?.body ?? "{}"));
        outboundPayloads.push(payload);
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({ messages: [{ id: `wamid.out.${outboundPayloads.length}` }] }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({}),
      } as Response;
    }) as typeof fetch;
  });

  it("repete o mesmo POST/messageId após crash, não confirma owner ativo e recupera uma única resposta", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    expect(databaseUrl).toBeTruthy();
    const connection = await mysql.createConnection(databaseUrl!);
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const openId = `restart-idem-${suffix}`;
    const phoneNumber = `5511${suffix.slice(-9).padStart(9, "7")}`;
    const messageId = `wamid.restart-idem.${suffix}`;
    const payload = createPayload(phoneNumber, messageId);

    const [created] = await connection.execute<ResultSetHeader>(
      "INSERT INTO users (openId, name) VALUES (?, ?)",
      [openId, "Restart idempotency regression"],
    );
    const userId = created.insertId;
    expect(userId).toBeGreaterThan(0);
    await upsertUserWhatsappConnection({
      userId,
      phoneNumber,
      displayName: "Restart Idempotency",
    });

    const runtimeA = createRuntime("runtime-a");
    const runtimeB = createRuntime("runtime-b");
    const runtimeC = createRuntime("runtime-c");

    await expect(deliver(runtimeA, payload)).rejects.toThrow(
      "simulated abrupt runtime termination after persistent claim",
    );

    const [claimedRows] = await connection.execute<RowDataPacket[]>(
      `SELECT m.id, m.processedAt, c.ownerToken
         FROM whatsappConversationMessages m
         JOIN whatsappMessageProcessingClaims c ON c.messageId = m.id
        WHERE m.idempotencyKey = ?`,
      [`whatsapp:inbound:${messageId}`],
    );
    expect(claimedRows).toHaveLength(1);
    expect(claimedRows[0].processedAt).toBeNull();
    expect(claimedRows[0].ownerToken).toBe("runtime-a");
    expect(controls.questionCalls).toBe(0);

    // Simula o novo processo: caches locais não participam da decisão terminal.
    __resetWhatsAppImageIdempotencyForTests();
    const immediateReplay = await deliver(runtimeB, payload);
    expect(immediateReplay.statusCode).toBe(503);
    expect(immediateReplay.body).toEqual({
      ok: false,
      retryable: true,
      reason: "message_processing_inflight",
    });
    expect(controls.downstreamCalls).toBe(1);
    expect(controls.questionCalls).toBe(0);

    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750));

    const recoveredReplay = await deliver(runtimeB, payload);
    expect(recoveredReplay.statusCode).toBe(200);
    expect(recoveredReplay.body).toEqual({ ok: true, processed: 1 });
    expect(controls.downstreamCalls).toBe(2);
    expect(controls.questionCalls).toBe(1);

    const textBodies = outboundPayloads
      .filter(payloadItem => payloadItem.type === "text")
      .map(payloadItem => payloadItem.text?.body);
    expect(textBodies).toEqual([ACK_TEXT, FINAL_TEXT]);

    const [completedRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, conversationId, processedAt
         FROM whatsappConversationMessages
        WHERE idempotencyKey = ?`,
      [`whatsapp:inbound:${messageId}`],
    );
    expect(completedRows).toHaveLength(1);
    expect(completedRows[0].processedAt).not.toBeNull();
    const inboundMessageId = Number(completedRows[0].id);

    const [responseRows] = await connection.execute<RowDataPacket[]>(
      `SELECT id, sanitizedText
         FROM whatsappConversationMessages
        WHERE direction = 'outbound' AND respondsToMessageId = ?`,
      [inboundMessageId],
    );
    expect(responseRows).toHaveLength(1);
    expect(responseRows[0].sanitizedText).toBe(FINAL_TEXT);

    const [claimRowsAfterCompletion] = await connection.execute<RowDataPacket[]>(
      "SELECT messageId FROM whatsappMessageProcessingClaims WHERE messageId = ?",
      [inboundMessageId],
    );
    expect(claimRowsAfterCompletion).toHaveLength(0);

    const beforeTerminalReplay = outboundPayloads.length;
    __resetWhatsAppImageIdempotencyForTests();
    const terminalReplay = await deliver(runtimeC, payload);
    expect(terminalReplay.statusCode).toBe(200);
    expect(terminalReplay.body).toEqual({ ok: true, processed: 0, deduplicated: true });
    expect(controls.downstreamCalls).toBe(2);
    expect(controls.questionCalls).toBe(1);
    expect(outboundPayloads).toHaveLength(beforeTerminalReplay);

    await connection.end();
  }, 20_000);
});
