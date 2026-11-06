import { createHash } from "node:crypto";
import mysql, {
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";
import { beforeEach, describe, expect, it, vi } from "vitest";

const controls = vi.hoisted(() => ({
  crashNextDownstream: true,
  crashQuestionAfterAck: false,
  downstreamCalls: 0,
  questionCalls: 0,
  processMealInput: vi.fn(),
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

vi.mock("./nutritionEngine", async () => {
  const actual =
    await vi.importActual<typeof import("./nutritionEngine")>(
      "./nutritionEngine"
    );
  return { ...actual, processMealInput: controls.processMealInput };
});

vi.mock("./modules/whatsapp/aiQuestionAssistant", async () => {
  const actual = await vi.importActual<
    typeof import("./modules/whatsapp/aiQuestionAssistant")
  >("./modules/whatsapp/aiQuestionAssistant");
  return {
    ...actual,
    executeWhatsappAiQuestionIntent: vi.fn(async () => {
      controls.questionCalls += 1;
      if (controls.crashQuestionAfterAck) {
        controls.crashQuestionAfterAck = false;
        // O ACK é disparado em paralelo antes da IA. Aguardar brevemente permite
        // que a entrega física e sua trilha idempotente sejam concluídas antes
        // de simular a morte abrupta durante o processamento caro.
        await new Promise(resolve => setTimeout(resolve, 250));
        throw new Error(
          "simulated abrupt runtime termination after ACK delivery"
        );
      }
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
  const actual = await vi.importActual<
    typeof import("./whatsappIntentWebhook")
  >("./whatsappIntentWebhook");
  return {
    ...actual,
    handleWhatsAppWebhookWithTextIntent: async (
      ...args: Parameters<typeof actual.handleWhatsAppWebhookWithTextIntent>
    ) => {
      controls.downstreamCalls += 1;
      if (controls.crashNextDownstream) {
        controls.crashNextDownstream = false;
        throw new Error(
          "simulated abrupt runtime termination after persistent claim"
        );
      }
      return actual.handleWhatsAppWebhookWithTextIntent(...args);
    },
  };
});

const { getDb, logPersistenceWarning, upsertUserWhatsappConnection } =
  await import("./db");
const { createMessageLifecycleService, withMessageLifecycleService } =
  await import("./modules/whatsapp/messageLifecycle");
const { createDrizzleWhatsAppConversationRepository } = await import(
  "./repositories/whatsappConversationRepository"
);
const { createDrizzleWhatsAppProcessingClaimRepository } = await import(
  "./repositories/whatsappProcessingClaimRepository"
);
const { createDrizzleWhatsAppQuestionRecoveryRepository } = await import(
  "./repositories/whatsappQuestionRecoveryRepository"
);
const { runWhatsappQuestionRecoveryCycle } = await import(
  "./modules/whatsapp/questionRecovery"
);
const { handleWhatsAppPersistentContextWebhook } = await import(
  "./whatsappPersistentContextWebhook"
);
const { __resetWhatsAppImageIdempotencyForTests } = await import(
  "./whatsappImageIdempotencyWebhook"
);

const ACK_TEXT = "✅ Recebi sua mensagem. Estou preparando a resposta…";
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

function createPayload(
  phoneNumber: string,
  messageId: string,
  text = "/como está minha proteína hoje?",
  timestamp = "1789164000"
) {
  return {
    entry: [
      {
        changes: [
          {
            value: {
              metadata: {
                phone_number_id: "phone-number-test",
                display_phone_number: "5511000000000",
              },
              messages: [
                {
                  id: messageId,
                  from: phoneNumber,
                  timestamp,
                  type: "text",
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
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
  payload: ReturnType<typeof createPayload>
) {
  const response = createResponse();
  await withMessageLifecycleService(runtime, () =>
    handleWhatsAppPersistentContextWebhook(
      { body: structuredClone(payload) } as never,
      response as never
    )
  );
  return response;
}

async function createPersistedQuestionFixture(connection: mysql.Connection) {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const openId = `restart-idem-${suffix}`;
  const phoneNumber = `5511${suffix.slice(-9).padStart(9, "7")}`;
  const messageId = `wamid.restart-idem.${suffix}`;
  const payload = createPayload(phoneNumber, messageId);

  const [created] = await connection.execute<ResultSetHeader>(
    "INSERT INTO users (openId, name) VALUES (?, ?)",
    [openId, "Restart idempotency regression"]
  );
  const userId = created.insertId;
  expect(userId).toBeGreaterThan(0);
  await upsertUserWhatsappConnection({
    userId,
    phoneNumber,
    displayName: "Restart Idempotency",
  });

  return { userId, phoneNumber, messageId, payload };
}

async function createGlobalPortionFixture(
  connection: mysql.Connection,
  suffix: string
) {
  const foodName = `Mussarela global QA ${suffix}`;
  const brand = "Issue 997 QA brand";
  const productVariant = `slice-variant-${suffix}`;
  const normalizedName = foodName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  const [foodInsert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO foods (
       owner_user_id, name, scope, canonical_name, canonical_key, normalized_name,
       brand_name, status, calories_kcal_per_100g, protein_grams_per_100g,
       carbs_grams_per_100g, fat_grams_per_100g
     ) VALUES (NULL, ?, 'global', ?, ?, ?, ?, 'active', 400, 25, 3, 32)`,
    [foodName, foodName, `issue997:food:${suffix}`, normalizedName, brand]
  );
  const foodId = foodInsert.insertId;
  const [variantInsert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO food_variants (
       food_id, variant_type, display_name, normalized_name, variant_name,
       identity_key, status, governance_status, revision
     ) VALUES (?, 'branded', ?, ?, ?, ?, 'active', 'verified', 1)`,
    [
      foodId,
      foodName,
      normalizedName,
      productVariant,
      `issue997:variant:${suffix}`,
    ]
  );
  const foodVariantId = variantInsert.insertId;
  const subjectKey = `issue997:portion:${suffix}`;
  const contentHash = createHash("sha256").update(subjectKey).digest("hex");
  const payloadJson = JSON.stringify({
    foodName,
    productVariant,
    portion: "1 fatia",
    grams: 30,
  });
  const [evidenceInsert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO food_evidence (
       subject_key, food_variant_id, evidence_type, source_reference,
       content_hash, payload_json, confidence
     ) VALUES (?, ?, 'official_source', 'fixture:issue997', ?, ?, 1)`,
    [subjectKey, foodVariantId, contentHash, payloadJson]
  );
  const evidenceId = evidenceInsert.insertId;
  const [portionInsert] = await connection.execute<ResultSetHeader>(
    `INSERT INTO food_portions (
       food_id, label, normalized_label, unit, quantity, grams, food_variant_id,
       measure_kind, evidence_id, confidence, status, valid_from, is_default
     ) VALUES (?, '1 fatia', '1 fatia', 'fatia', 1, 30, ?, 'exact', ?, 1, 'verified', CURRENT_TIMESTAMP, 1)`,
    [foodId, foodVariantId, evidenceId]
  );

  return {
    foodId,
    foodVariantId,
    foodPortionId: portionInsert.insertId,
    evidenceId,
    foodName,
    brand,
    productVariant,
  };
}

async function deleteGlobalPortionFixture(
  connection: mysql.Connection,
  fixture: Awaited<ReturnType<typeof createGlobalPortionFixture>>
) {
  await connection.execute(
    `UPDATE mealItems
        SET foodId = NULL, foodVariantId = NULL, nutritionProfileId = NULL,
            foodPortionId = NULL, foodSnapshotJson = NULL
      WHERE foodId = ?`,
    [fixture.foodId]
  );
  await connection.execute("DELETE FROM food_portions WHERE id = ?", [
    fixture.foodPortionId,
  ]);
  await connection.execute("DELETE FROM food_evidence WHERE id = ?", [
    fixture.evidenceId,
  ]);
  await connection.execute("DELETE FROM food_variants WHERE id = ?", [
    fixture.foodVariantId,
  ]);
  await connection.execute("DELETE FROM foods WHERE id = ?", [fixture.foodId]);
}

async function findPersistedRecoveryCandidate(messageId: string) {
  const realRepository = createDrizzleWhatsAppQuestionRecoveryRepository({
    getDb,
    onWarning: logPersistenceWarning,
  });
  const candidates = await realRepository.findRecoverableQuestions({
    now: new Date(),
    horizonMs: 20 * 60 * 1000,
    limit: 20,
    processingStaleBefore: new Date(Date.now() - HEARTBEAT_TIMEOUT_MS),
  });
  return candidates.find(item => item.externalMessageId === messageId);
}

const describeTidb =
  process.env.WHATSAPP_RESTART_TIDB_REGRESSION === "1"
    ? describe
    : describe.skip;

describeTidb(
  "RESTART-IDEM-001: webhook canônico + lifecycle persistente em TiDB",
  () => {
    let outboundPayloads: Array<Record<string, any>> = [];

    beforeEach(() => {
      controls.crashNextDownstream = true;
      controls.crashQuestionAfterAck = false;
      controls.downstreamCalls = 0;
      controls.questionCalls = 0;
      controls.processMealInput.mockReset();
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

      global.fetch = vi.fn(
        async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/messages")) {
            const payload = JSON.parse(String(init?.body ?? "{}"));
            outboundPayloads.push(payload);
            return {
              ok: true,
              status: 200,
              statusText: "OK",
              json: async () => ({
                messages: [{ id: `wamid.out.${outboundPayloads.length}` }],
              }),
            } as Response;
          }
          return {
            ok: true,
            status: 200,
            statusText: "OK",
            json: async () => ({}),
          } as Response;
        }
      ) as typeof fetch;
    });

    it("repete o mesmo POST/messageId após crash, não confirma owner ativo e recupera uma única resposta", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);
      const { messageId, payload } =
        await createPersistedQuestionFixture(connection);

      const runtimeA = createRuntime("runtime-a");
      const runtimeB = createRuntime("runtime-b");
      const runtimeC = createRuntime("runtime-c");

      await expect(deliver(runtimeA, payload)).rejects.toThrow(
        "simulated abrupt runtime termination after persistent claim"
      );

      const [claimedRows] = await connection.execute<RowDataPacket[]>(
        `SELECT m.id, m.processedAt, c.ownerToken
         FROM whatsappConversationMessages m
         JOIN whatsappMessageProcessingClaims c ON c.messageId = m.id
        WHERE m.idempotencyKey = ?`,
        [`whatsapp:inbound:${messageId}`]
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

      await new Promise(resolve =>
        setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750)
      );

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
        [`whatsapp:inbound:${messageId}`]
      );
      expect(completedRows).toHaveLength(1);
      expect(completedRows[0].processedAt).not.toBeNull();
      const inboundMessageId = Number(completedRows[0].id);

      const [responseRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, sanitizedText
         FROM whatsappConversationMessages
        WHERE direction = 'outbound' AND respondsToMessageId = ?`,
        [inboundMessageId]
      );
      expect(responseRows).toHaveLength(1);
      expect(responseRows[0].sanitizedText).toBe(FINAL_TEXT);

      const [claimRowsAfterCompletion] = await connection.execute<
        RowDataPacket[]
      >(
        "SELECT messageId FROM whatsappMessageProcessingClaims WHERE messageId = ?",
        [inboundMessageId]
      );
      expect(claimRowsAfterCompletion).toHaveLength(0);

      const beforeTerminalReplay = outboundPayloads.length;
      __resetWhatsAppImageIdempotencyForTests();
      const terminalReplay = await deliver(runtimeC, payload);
      expect(terminalReplay.statusCode).toBe(200);
      expect(terminalReplay.body).toEqual({
        ok: true,
        processed: 0,
        deduplicated: true,
      });
      expect(controls.downstreamCalls).toBe(2);
      expect(controls.questionCalls).toBe(1);
      expect(outboundPayloads).toHaveLength(beforeTerminalReplay);

      await connection.end();
    }, 20_000);

    it("retoma a QUESTION órfã após crash sem qualquer redelivery do provider", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);
      const { messageId, payload } =
        await createPersistedQuestionFixture(connection);

      const runtimeA = createRuntime("runtime-a-no-redelivery");
      const runtimeB = createRuntime("runtime-b-recovery");

      await expect(deliver(runtimeA, payload)).rejects.toThrow(
        "simulated abrupt runtime termination after persistent claim"
      );
      expect(controls.downstreamCalls).toBe(1);
      expect(controls.questionCalls).toBe(0);
      expect(outboundPayloads).toHaveLength(0);

      await new Promise(resolve =>
        setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750)
      );

      const candidate = await findPersistedRecoveryCandidate(messageId);
      expect(candidate).toBeTruthy();
      const recoveryRepository =
        createDrizzleWhatsAppQuestionRecoveryRepository({
          getDb,
          onWarning: logPersistenceWarning,
        });
      const recoveryNow = new Date(Date.now() + 31_000);

      const cycle = await withMessageLifecycleService(runtimeB, () =>
        runWhatsappQuestionRecoveryCycle({
          repository: recoveryRepository,
          now: recoveryNow,
          horizonMs: 20 * 60 * 1000,
          limit: 1,
        })
      );

      expect(cycle).toEqual({
        candidates: 1,
        outcomes: [{ messageId: candidate!.messageId, outcome: "recovered" }],
      });
      // Nenhum segundo POST foi executado: o downstream do webhook segue com uma única chamada.
      expect(controls.downstreamCalls).toBe(1);
      expect(controls.questionCalls).toBe(1);

      const textBodies = outboundPayloads
        .filter(payloadItem => payloadItem.type === "text")
        .map(payloadItem => payloadItem.text?.body);
      expect(textBodies).toEqual([ACK_TEXT, FINAL_TEXT]);

      const [completedRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, processedAt
         FROM whatsappConversationMessages
        WHERE idempotencyKey = ?`,
        [`whatsapp:inbound:${messageId}`]
      );
      expect(completedRows).toHaveLength(1);
      expect(completedRows[0].processedAt).not.toBeNull();
      const inboundMessageId = Number(completedRows[0].id);

      const [responseRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, sanitizedText
         FROM whatsappConversationMessages
        WHERE direction = 'outbound' AND respondsToMessageId = ?`,
        [inboundMessageId]
      );
      expect(responseRows).toHaveLength(1);
      expect(responseRows[0].sanitizedText).toBe(FINAL_TEXT);

      const [claimRowsAfterCompletion] = await connection.execute<
        RowDataPacket[]
      >(
        "SELECT messageId FROM whatsappMessageProcessingClaims WHERE messageId = ?",
        [inboundMessageId]
      );
      expect(claimRowsAfterCompletion).toHaveLength(0);

      await connection.end();
    }, 20_000);

    it("não duplica ACK físico quando o runtime morre depois do ACK e o recovery envia apenas a final", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);
      const { messageId, payload } =
        await createPersistedQuestionFixture(connection);

      controls.crashNextDownstream = false;
      controls.crashQuestionAfterAck = true;
      const runtimeA = createRuntime("runtime-a-after-ack");
      const runtimeB = createRuntime("runtime-b-after-ack-recovery");

      await expect(deliver(runtimeA, payload)).rejects.toThrow(
        "simulated abrupt runtime termination after ACK delivery"
      );
      expect(controls.downstreamCalls).toBe(1);
      expect(controls.questionCalls).toBe(1);
      const afterCrashBodies = outboundPayloads
        .filter(payloadItem => payloadItem.type === "text")
        .map(payloadItem => payloadItem.text?.body);
      expect(afterCrashBodies).toEqual([ACK_TEXT]);

      await new Promise(resolve =>
        setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750)
      );
      const candidate = await findPersistedRecoveryCandidate(messageId);
      expect(candidate).toBeTruthy();
      const recoveryRepository =
        createDrizzleWhatsAppQuestionRecoveryRepository({
          getDb,
          onWarning: logPersistenceWarning,
        });
      const recoveryNow = new Date(Date.now() + 31_000);

      const cycle = await withMessageLifecycleService(runtimeB, () =>
        runWhatsappQuestionRecoveryCycle({
          repository: recoveryRepository,
          now: recoveryNow,
          horizonMs: 20 * 60 * 1000,
          limit: 1,
        })
      );

      expect(cycle).toEqual({
        candidates: 1,
        outcomes: [{ messageId: candidate!.messageId, outcome: "recovered" }],
      });
      expect(controls.questionCalls).toBe(2);
      const finalBodies = outboundPayloads
        .filter(payloadItem => payloadItem.type === "text")
        .map(payloadItem => payloadItem.text?.body);
      expect(finalBodies).toEqual([ACK_TEXT, FINAL_TEXT]);

      const [responseRows] = await connection.execute<RowDataPacket[]>(
        `SELECT id, sanitizedText
         FROM whatsappConversationMessages
        WHERE direction = 'outbound'
          AND respondsToMessageId = (
            SELECT id FROM whatsappConversationMessages WHERE idempotencyKey = ? LIMIT 1
          )`,
        [`whatsapp:inbound:${messageId}`]
      );
      expect(responseRows).toHaveLength(1);
      expect(responseRows[0].sanitizedText).toBe(FINAL_TEXT);

      await connection.end();
    }, 20_000);

    it("fecha o lifecycle sem nova IA/outbound quando a final já foi persistida antes de processedAt", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);
      const { messageId, payload } =
        await createPersistedQuestionFixture(connection);

      controls.crashNextDownstream = false;
      const runtimeA = createRuntime("runtime-a-final-persisted");
      const runtimeB = createRuntime("runtime-b-final-recovery");

      const initial = await deliver(runtimeA, payload);
      expect(initial.statusCode).toBe(200);
      expect(controls.questionCalls).toBe(1);
      const deliveredBeforeRecovery = outboundPayloads.length;
      expect(
        outboundPayloads
          .filter(payloadItem => payloadItem.type === "text")
          .map(payloadItem => payloadItem.text?.body)
      ).toEqual([ACK_TEXT, FINAL_TEXT]);

      const [rows] = await connection.execute<RowDataPacket[]>(
        `SELECT id FROM whatsappConversationMessages WHERE idempotencyKey = ?`,
        [`whatsapp:inbound:${messageId}`]
      );
      expect(rows).toHaveLength(1);
      const inboundMessageId = Number(rows[0].id);

      // Reconstitui exatamente a janela crash-after-final/before-processedAt:
      // resposta funcional continua persistida, inbound volta a aberto e existe
      // um owner antigo já fora da janela de liveness.
      await connection.execute(
        "UPDATE whatsappConversationMessages SET processedAt = NULL WHERE id = ?",
        [inboundMessageId]
      );
      await connection.execute(
        `INSERT INTO whatsappMessageProcessingClaims (messageId, ownerToken, claimedAt, heartbeatAt)
       VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 10 SECOND), DATE_SUB(NOW(), INTERVAL 10 SECOND))`,
        [inboundMessageId, "dead-final-owner"]
      );

      const candidate = await findPersistedRecoveryCandidate(messageId);
      expect(candidate).toBeTruthy();
      const recoveryRepository =
        createDrizzleWhatsAppQuestionRecoveryRepository({
          getDb,
          onWarning: logPersistenceWarning,
        });
      const recoveryNow = new Date(Date.now() + 31_000);
      const cycle = await withMessageLifecycleService(runtimeB, () =>
        runWhatsappQuestionRecoveryCycle({
          repository: recoveryRepository,
          now: recoveryNow,
          horizonMs: 20 * 60 * 1000,
          limit: 1,
        })
      );

      expect(cycle).toEqual({
        candidates: 1,
        outcomes: [
          { messageId: inboundMessageId, outcome: "completed_existing" },
        ],
      });
      expect(controls.questionCalls).toBe(1);
      expect(outboundPayloads).toHaveLength(deliveredBeforeRecovery);

      const [completedRows] = await connection.execute<RowDataPacket[]>(
        "SELECT processedAt FROM whatsappConversationMessages WHERE id = ?",
        [inboundMessageId]
      );
      expect(completedRows[0].processedAt).not.toBeNull();
      const [claimRows] = await connection.execute<RowDataPacket[]>(
        "SELECT messageId FROM whatsappMessageProcessingClaims WHERE messageId = ?",
        [inboundMessageId]
      );
      expect(claimRows).toHaveLength(0);

      await connection.end();
    }, 20_000);

    it("mantém só a clarificação durável quando nenhum segmento do registro inicial pode ser salvo", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);

      try {
        const fixture = await createPersistedQuestionFixture(connection);
        const { listMealsForAdjustment } = await import(
          "./modules/meals/service"
        );
        // Both the initial all-pending command and the weighted continuation enter
        // through the public webhook. The countable gate, pending state and writes
        // are real; model inference is deterministic only for the resolved reply.
        const registrationText = "1 fatia queijo prato";
        controls.crashNextDownstream = false;
        const registrationMessageId = `wamid.issue997.all-pending.${Date.now()}`;
        const initial = await deliver(
          createRuntime(`runtime-all-pending-initial-${Date.now()}`),
          createPayload(
            fixture.phoneNumber,
            registrationMessageId,
            registrationText,
            String(Math.floor(Date.now() / 1000))
          )
        );

        expect(initial.statusCode).toBe(200);
        expect(initial.body).toEqual({ ok: true, processed: 1 });
        expect(controls.processMealInput).not.toHaveBeenCalled();
        expect(await listMealsForAdjustment(fixture.userId)).toHaveLength(0);

        const [mealRows] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM meals WHERE userId = ?",
          [fixture.userId]
        );
        const [draftRows] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM mealInferences WHERE userId = ?",
          [fixture.userId]
        );
        const [pendingRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, state FROM whatsappPendingOperations
          WHERE userId = ? AND state = 'active'`,
          [fixture.userId]
        );
        expect(mealRows).toHaveLength(0);
        expect(draftRows).toHaveLength(0);
        expect(pendingRows).toHaveLength(1);
        expect(pendingRows[0].state).toBe("active");

        const { buildHeuristicItem } = await import("./mealItemBuilders");
        const { calculateMealTotals } = await import("../shared/mealTotals");
        controls.crashNextDownstream = false;
        controls.processMealInput.mockImplementation(
          async (input: { text?: string }) => {
            const text = input.text ?? "25 g de queijo prato";
            const items = [buildHeuristicItem(text)];
            return {
              detectedMealLabel: "Refeição",
              sourceText: text,
              confidence: 0.95,
              needsConfirmation: false,
              reasoning:
                "Fixture determinística após resolver a quantidade pendente.",
              items,
              totals: calculateMealTotals(items),
            } as never;
          }
        );
        const answerMessageId = `wamid.issue997.all-pending-answer.${Date.now()}`;
        const response = await deliver(
          createRuntime(`runtime-all-pending-${Date.now()}`),
          createPayload(
            fixture.phoneNumber,
            answerMessageId,
            "25 g",
            String(Math.floor(Date.now() / 1000))
          )
        );

        expect(response.statusCode).toBe(200);
        expect(response.body).toEqual({ ok: true, processed: 1 });
        expect(controls.processMealInput).toHaveBeenCalledTimes(1);
        expect(await listMealsForAdjustment(fixture.userId)).toHaveLength(1);
        const [activePendingRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM whatsappPendingOperations
          WHERE userId = ? AND state = 'active'`,
          [fixture.userId]
        );
        expect(activePendingRows).toHaveLength(0);
        expect(outboundPayloads.map(item => item.type)).toContain("text");
      } finally {
        await connection.end();
      }
    }, 20_000);

    it("registra pelo serviço real e ajusta via webhook sem duplicar na redelivery", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);
      let globalPortionFixture: Awaited<
        ReturnType<typeof createGlobalPortionFixture>
      > | null = null;

      try {
        const fixture = await createPersistedQuestionFixture(connection);
        const { listMealsForAdjustment } = await import(
          "./modules/meals/service"
        );
        const { buildHeuristicItem } = await import("./mealItemBuilders");
        const { calculateMealTotals } = await import("../shared/mealTotals");
        const registrationText = [
          "1 pão francês",
          "1 ovo frito",
          "1 fatia presunto",
          "1 fatia mussarela",
          "45g requeijão catupiry light",
          "3 xícaras de café sem açúcar",
        ].join("\n");
        // This integration exercises the real countable gate, registration service,
        // TiDB persistence/reload, and adjustment webhook. Only model inference is
        // deterministic here; it does not claim to test a live provider pipeline.
        controls.processMealInput.mockImplementation(
          async (input: { text?: string }) => {
            const text = input.text ?? "";
            if (/presunto|mussarela|muçarela|mozarela/i.test(text)) {
              throw new Error(
                `medida contável resolvida localmente foi enviada ao motor nutricional: ${text}`
              );
            }
            const items = [buildHeuristicItem(text)];
            return {
              detectedMealLabel: "Refeição",
              sourceText: text,
              confidence: 0.95,
              needsConfirmation: false,
              reasoning:
                "Fixture local determinística para os segmentos não contáveis do cenário.",
              items,
              totals: calculateMealTotals(items),
            } as never;
          }
        );
        controls.crashNextDownstream = false;
        const { executeConfirmedWhatsAppMealRegistration } = await import(
          "./modules/whatsapp/confirmedMealRegistration"
        );
        const registrationMessageId = `wamid.issue997.registration.${Date.now()}`;
        const registrationOutcome =
          await executeConfirmedWhatsAppMealRegistration({
            userId: fixture.userId,
            registrationText,
            originalText: registrationText,
            occurredAt: new Date(),
            userTimezone: "America/Sao_Paulo",
            inboundMessageId: registrationMessageId,
          });

        expect(registrationOutcome.status).toBe("registered");
        expect(
          controls.processMealInput.mock.calls.some(([input]) =>
            /presunto|mussarela|muçarela|mozarela/i.test(input.text ?? "")
          )
        ).toBe(false);

        const registeredMeals = await listMealsForAdjustment(fixture.userId);
        const registeredMeal = registeredMeals.find(meal =>
          meal.items.some(item => /mussarela|mozarela/i.test(item.foodName))
        );
        expect(registeredMeal).toBeTruthy();
        globalPortionFixture = await createGlobalPortionFixture(
          connection,
          `${Date.now()}-${Math.floor(Math.random() * 100000)}`
        );
        const [mussarelaRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id FROM mealItems
          WHERE mealId = ? AND (foodName LIKE '%mussarela%' OR canonicalName LIKE '%mussarela%')`,
          [registeredMeal!.id]
        );
        expect(mussarelaRows).toHaveLength(1);
        await connection.execute(
          `UPDATE mealItems
            SET calories = 0, protein = 0, carbs = 0, fat = 0,
                caloriesKcal = 0, proteinG = 0, carbG = 0, fatG = 0
          WHERE mealId = ?`,
          [registeredMeal!.id]
        );
        const [registeredItemRows] = await connection.execute<RowDataPacket[]>(
          "SELECT id, foodName FROM mealItems WHERE mealId = ?",
          [registeredMeal!.id]
        );
        for (const control of [
          { pattern: /presunto/i, values: [30, 5, 1, 2] },
          { pattern: /requeijão/i, values: [90, 4.5, 2.25, 9] },
        ]) {
          const matches = registeredItemRows.filter(row =>
            control.pattern.test(String(row.foodName))
          );
          expect(matches).toHaveLength(1);
          await connection.execute(
            `UPDATE mealItems
              SET calories = ?, protein = ?, carbs = ?, fat = ?,
                  caloriesKcal = ?, proteinG = ?, carbG = ?, fatG = ?
            WHERE id = ?`,
            [...control.values, ...control.values, matches[0].id]
          );
        }
        const globalItemNutrients = {
          calories: 120,
          protein: 7.5,
          carbs: 0.9,
          fat: 9.6,
        };
        const globalSnapshot = JSON.stringify({
          confirmedCommercialIdentity: {
            brand: globalPortionFixture.brand,
            productVariant: globalPortionFixture.productVariant,
          },
        });
        await connection.execute(
          `UPDATE mealItems
            SET foodId = ?, foodCatalogId = NULL, foodVariantId = ?, nutritionProfileId = NULL,
                foodPortionId = ?, portionId = NULL, foodName = ?, canonicalName = ?,
                portionText = '1 fatia', quantity = 1, unit = 'fatia', servings = 1,
                estimatedGrams = 30, grams = 30, calories = ?, protein = ?, carbs = ?, fat = ?,
                caloriesKcal = ?, proteinG = ?, carbG = ?, fatG = ?, foodSnapshotJson = ?
          WHERE id = ?`,
          [
            globalPortionFixture.foodId,
            globalPortionFixture.foodVariantId,
            globalPortionFixture.foodPortionId,
            globalPortionFixture.foodName,
            globalPortionFixture.foodName,
            globalItemNutrients.calories,
            globalItemNutrients.protein,
            globalItemNutrients.carbs,
            globalItemNutrients.fat,
            globalItemNutrients.calories,
            globalItemNutrients.protein,
            globalItemNutrients.carbs,
            globalItemNutrients.fat,
            globalSnapshot,
            mussarelaRows[0].id,
          ]
        );

        const initialMeals = await listMealsForAdjustment(fixture.userId);
        const initialMeal = initialMeals.find(
          meal =>
            meal.items.some(item => /presunto/i.test(item.foodName)) &&
            meal.items.some(item => /mussarela|mozarela/i.test(item.foodName))
        );
        expect(initialMeal).toBeTruthy();
        const initialPresunto = initialMeal!.items.find(item =>
          /presunto/i.test(item.foodName)
        )!;
        const initialMussarela = initialMeal!.items.find(item =>
          /mussarela|mozarela/i.test(item.foodName)
        )!;
        const initialRequeijao = initialMeal!.items.find(item =>
          /requeijão/i.test(item.foodName)
        )!;
        const { resolveSafeCountableCatalogGrams } = await import(
          "./foodItemResolution"
        );
        expect(
          resolveSafeCountableCatalogGrams("mussarela", 1, "fatia")?.grams
        ).toBe(20);
        expect(initialPresunto).toMatchObject({
          quantity: 1,
          unit: "fatia",
          estimatedGrams: 18,
          calories: 30,
          protein: 5,
          carbs: 1,
          fat: 2,
        });
        expect(initialMussarela).toMatchObject({
          quantity: 1,
          unit: "fatia",
          estimatedGrams: 30,
          foodId: globalPortionFixture.foodId,
          foodVariantId: globalPortionFixture.foodVariantId,
          foodPortionId: globalPortionFixture.foodPortionId,
          brand: globalPortionFixture.brand,
          productVariant: globalPortionFixture.productVariant,
          calories: 120,
          protein: 7.5,
          carbs: 0.9,
          fat: 9.6,
        });
        expect(initialRequeijao).toMatchObject({
          estimatedGrams: 45,
          calories: 90,
          protein: 4.5,
          carbs: 2.25,
          fat: 9,
        });
        expect(initialPresunto.foodId).toBeUndefined();

        controls.crashNextDownstream = false;
        const adjustmentMessageId = `wamid.issue997.adjustment.${Date.now()}`;
        const adjustmentPayload = createPayload(
          fixture.phoneNumber,
          adjustmentMessageId,
          "Adicionar 48g ao requeijão, 1 fatia ao presunto e uma na mussarela",
          String(Math.floor(Date.now() / 1000))
        );
        const downstreamBefore = controls.downstreamCalls;
        const repliesBefore = outboundPayloads.length;
        const adjustment = await deliver(
          createRuntime(`runtime-issue997-${Date.now()}`),
          adjustmentPayload
        );
        expect(adjustment.statusCode).toBe(200);
        expect(adjustment.body).toEqual({ ok: true, processed: 1 });
        expect(controls.downstreamCalls).toBe(downstreamBefore + 1);
        const repliesAfterAdjustment = outboundPayloads.length;
        expect(repliesAfterAdjustment).toBeGreaterThan(repliesBefore);

        __resetWhatsAppImageIdempotencyForTests();
        const duplicate = await deliver(
          createRuntime(`runtime-issue997-replay-${Date.now()}`),
          adjustmentPayload
        );
        expect(duplicate.statusCode).toBe(200);
        expect(duplicate.body).toEqual({
          ok: true,
          processed: 0,
          deduplicated: true,
        });
        expect(controls.downstreamCalls).toBe(downstreamBefore + 1);
        expect(outboundPayloads).toHaveLength(repliesAfterAdjustment);

        const finalMeals = await listMealsForAdjustment(fixture.userId);
        const finalMeal = finalMeals.find(meal => meal.id === initialMeal!.id)!;
        const finalPresunto = finalMeal.items.find(item =>
          /presunto/i.test(item.foodName)
        )!;
        const finalMussarela = finalMeal.items.find(item =>
          /mussarela|mozarela/i.test(item.foodName)
        )!;
        const finalRequeijao = finalMeal.items.find(item =>
          /requeijão/i.test(item.foodName)
        )!;
        expect(finalPresunto).toMatchObject({
          quantity: 2,
          unit: "fatia",
          portionText: "2 fatias",
          estimatedGrams: 36,
        });
        expect(finalMussarela).toMatchObject({
          quantity: 2,
          unit: "fatia",
          portionText: "2 fatias",
          estimatedGrams: 60,
          foodId: globalPortionFixture.foodId,
          foodVariantId: globalPortionFixture.foodVariantId,
          foodPortionId: globalPortionFixture.foodPortionId,
          brand: globalPortionFixture.brand,
          productVariant: globalPortionFixture.productVariant,
        });
        expect(finalRequeijao.estimatedGrams).toBe(93);

        expect(finalMeal.items.map(item => item.foodName)).toEqual(
          initialMeal!.items.map(item => item.foodName)
        );
        const expectedFinalNutrients = finalMeal.items.map(item =>
          /presunto/i.test(item.foodName)
            ? { calories: 60, protein: 10, carbs: 2, fat: 4 }
            : /mussarela|mozarela/i.test(item.foodName)
              ? { calories: 240, protein: 15, carbs: 1.8, fat: 19.2 }
              : /requeijão/i.test(item.foodName)
                ? { calories: 186, protein: 9.3, carbs: 4.7, fat: 18.6 }
                : { calories: 0, protein: 0, carbs: 0, fat: 0 }
        );
        const actualFinalNutrients = finalMeal.items.map(item => ({
          calories: item.calories,
          protein: item.protein,
          carbs: item.carbs,
          fat: item.fat,
        }));
        expect(actualFinalNutrients).toEqual(expectedFinalNutrients);

        const expectedFinalTotals = {
          calories: 486,
          protein: 34.3,
          carbs: 8.5,
          fat: 41.8,
        };
        expect(calculateMealTotals(finalMeal.items)).toEqual(
          expectedFinalTotals
        );
        const dateParts = new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Sao_Paulo",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date());
        const datePart = (type: string) =>
          dateParts.find(part => part.type === type)?.value ?? "";
        const localDate = `${datePart("year")}-${datePart("month")}-${datePart("day")}`;
        const { getDayTotals } = await import("./modules/meals/service");
        expect(
          await getDayTotals(fixture.userId, localDate, "America/Sao_Paulo")
        ).toEqual(expectedFinalTotals);
      } finally {
        if (globalPortionFixture) {
          await deleteGlobalPortionFixture(connection, globalPortionFixture);
        }
        await connection.end();
      }
    }, 20_000);

    it("rejeita em TiDB um gravador com pre-image obsoleto sem sobrescrever a atualização concorrente", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);

      try {
        const fixture = await createPersistedQuestionFixture(connection);
        const occurredAt = new Date();
        const [mealInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO meals (userId, source, status, mealLabel, sourceText, confidence, occurredAt)
         VALUES (?, 'whatsapp', 'confirmed', 'Almoço', 'fixture CAS issue 997', 0.95, ?)`,
          [fixture.userId, occurredAt]
        );
        const mealId = mealInsert.insertId;
        const [itemInsert] = await connection.execute<ResultSetHeader>(
          `INSERT INTO mealItems (
           mealId, itemType, foodName, canonicalName, portionText, quantity, unit,
           servings, estimatedGrams, grams, calories, protein, carbs, fat,
           caloriesKcal, proteinG, carbG, fatG, source
         ) VALUES (?, 'food', 'Arroz integral', 'Arroz integral', '40 g', 40, 'g',
                   1, 40, 40, 50, 2, 10, 1, 50, 2, 10, 1, 'heuristic')`,
          [mealId]
        );

        const {
          listMealsForAdjustment,
          updateMeal,
          MEAL_UPDATE_SERVICE_OPTIONS,
          getMealMutationPreImage,
        } = await import("./modules/meals/service");
        const original = (await listMealsForAdjustment(fixture.userId)).find(
          meal => meal.id === mealId
        );
        expect(original).toBeTruthy();
        const expectedPreImage = getMealMutationPreImage(original!);
        expect(expectedPreImage).toMatch(/^[a-f0-9]{64}$/);

        await connection.execute(
          `UPDATE mealItems
            SET portionText = '60 g', quantity = 60, unit = 'g', estimatedGrams = 60, grams = 60,
                calories = 75, protein = 3, carbs = 15, fat = 1.5,
                caloriesKcal = 75, proteinG = 3, carbG = 15, fatG = 1.5
          WHERE id = ?`,
          [itemInsert.insertId]
        );

        const staleWrite = {
          mealId,
          mealLabel: original!.mealLabel,
          occurredAt: new Date(original!.occurredAt).toISOString(),
          notes: original!.notes ?? undefined,
          items: original!.items,
          [MEAL_UPDATE_SERVICE_OPTIONS]: {
            expectedPreImage,
            recordCatalogUsage: false,
            updateHabits: false,
            logEvent: false,
          },
        };
        await expect(
          updateMeal(fixture.userId, staleWrite as never)
        ).rejects.toThrow(/pre-image/i);

        const reloaded = (await listMealsForAdjustment(fixture.userId)).find(
          meal => meal.id === mealId
        )!;
        expect(reloaded.items[0]).toMatchObject({
          estimatedGrams: 60,
          quantity: 60,
          calories: 75,
          protein: 3,
          carbs: 15,
          fat: 1.5,
        });
      } finally {
        await connection.end();
      }
    }, 20_000);

    it("transiciona pendências ativas e em processamento para expired e purga somente após a retenção", async () => {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      expect(databaseUrl).toBeTruthy();
      const connection = await mysql.createConnection(databaseUrl!);

      try {
        const fixture = await createPersistedQuestionFixture(connection);
        const repository = createDrizzleWhatsAppPendingOperationRepository({
          getDb,
          onWarning: logPersistenceWarning,
        });
        const now = new Date();
        const createdAt = new Date(now.getTime() - 12 * 60 * 1000);
        const ttlMs = 10 * 60 * 1000;
        const active = await repository.createPendingOperation({
          userId: fixture.userId,
          type: "issue997_ttl_active",
          target: { source: "active" },
          dedupeKey: `issue997:ttl:active:${Date.now()}`,
          origin: "issue997_ttl_test",
          ttlMs,
          now: createdAt,
        });
        const processing = await repository.createPendingOperation({
          userId: fixture.userId,
          type: "issue997_ttl_processing",
          target: { source: "processing" },
          dedupeKey: `issue997:ttl:processing:${Date.now()}`,
          origin: "issue997_ttl_test",
          ttlMs,
          now: createdAt,
        });
        expect(active).toBeTruthy();
        expect(processing).toBeTruthy();
        const claim = await repository.beginPendingOperationProcessing({
          id: processing!.id,
          expectedVersion: processing!.version,
          now: new Date(createdAt.getTime() + 9 * 60 * 1000),
        });
        expect(claim.claimed).toBe(true);

        expect(
          await repository.getActivePendingOperationByType!(
            fixture.userId,
            active!.type,
            now
          )
        ).toBeNull();
        expect(
          await repository.getActivePendingOperationByType!(
            fixture.userId,
            processing!.type,
            now
          )
        ).toBeNull();
        const [expiredRows] = await connection.execute<RowDataPacket[]>(
          `SELECT id, state, dedupeKey FROM whatsappPendingOperations
          WHERE id IN (?, ?) ORDER BY id`,
          [active!.id, processing!.id]
        );
        expect(expiredRows).toHaveLength(2);
        expect(expiredRows.map(row => row.state)).toEqual([
          "expired",
          "expired",
        ]);
        expect(expiredRows.every(row => row.dedupeKey === null)).toBe(true);

        const deleted = await repository.purgeInactiveOperations(
          30,
          new Date(now.getTime() + 31 * 24 * 60 * 60 * 1000)
        );
        expect(deleted).toBeGreaterThanOrEqual(2);
        const [retainedRows] = await connection.execute<RowDataPacket[]>(
          "SELECT id FROM whatsappPendingOperations WHERE id IN (?, ?)",
          [active!.id, processing!.id]
        );
        expect(retainedRows).toHaveLength(0);
      } finally {
        await connection.end();
      }
    }, 20_000);
  }
);
