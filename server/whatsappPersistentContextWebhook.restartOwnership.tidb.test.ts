import mysql, { type ResultSetHeader, type RowDataPacket } from "mysql2/promise";
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
  const actual = await vi.importActual<typeof import("./nutritionEngine")>("./nutritionEngine");
  return { ...actual, processMealInput: controls.processMealInput };
});

vi.mock("./modules/whatsapp/aiQuestionAssistant", async () => {
  const actual = await vi.importActual<typeof import("./modules/whatsapp/aiQuestionAssistant")>(
    "./modules/whatsapp/aiQuestionAssistant",
  );
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
        throw new Error("simulated abrupt runtime termination after ACK delivery");
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
const { createDrizzleWhatsAppQuestionRecoveryRepository } = await import(
  "./repositories/whatsappQuestionRecoveryRepository"
);
const { runWhatsappQuestionRecoveryCycle } = await import(
  "./modules/whatsapp/questionRecovery"
);
const {
  handleWhatsAppPersistentContextWebhook,
} = await import("./whatsappPersistentContextWebhook");
const {
  __resetWhatsAppImageIdempotencyForTests,
} = await import("./whatsappImageIdempotencyWebhook");

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
  timestamp = "1789164000",
) {
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
            timestamp,
            type: "text",
            text: { body: text },
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

async function createPersistedQuestionFixture(connection: mysql.Connection) {
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

  return { userId, phoneNumber, messageId, payload };
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

const describeTidb = process.env.WHATSAPP_RESTART_TIDB_REGRESSION === "1"
  ? describe
  : describe.skip;

describeTidb("RESTART-IDEM-001: webhook canônico + lifecycle persistente em TiDB", () => {
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
    const { messageId, payload } = await createPersistedQuestionFixture(connection);

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

  it("retoma a QUESTION órfã após crash sem qualquer redelivery do provider", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    expect(databaseUrl).toBeTruthy();
    const connection = await mysql.createConnection(databaseUrl!);
    const { messageId, payload } = await createPersistedQuestionFixture(connection);

    const runtimeA = createRuntime("runtime-a-no-redelivery");
    const runtimeB = createRuntime("runtime-b-recovery");

    await expect(deliver(runtimeA, payload)).rejects.toThrow(
      "simulated abrupt runtime termination after persistent claim",
    );
    expect(controls.downstreamCalls).toBe(1);
    expect(controls.questionCalls).toBe(0);
    expect(outboundPayloads).toHaveLength(0);

    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750));

    const candidate = await findPersistedRecoveryCandidate(messageId);
    expect(candidate).toBeTruthy();
    const recoveryRepository = createDrizzleWhatsAppQuestionRecoveryRepository({
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
      }),
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

    await connection.end();
  }, 20_000);

  it("não duplica ACK físico quando o runtime morre depois do ACK e o recovery envia apenas a final", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    expect(databaseUrl).toBeTruthy();
    const connection = await mysql.createConnection(databaseUrl!);
    const { messageId, payload } = await createPersistedQuestionFixture(connection);

    controls.crashNextDownstream = false;
    controls.crashQuestionAfterAck = true;
    const runtimeA = createRuntime("runtime-a-after-ack");
    const runtimeB = createRuntime("runtime-b-after-ack-recovery");

    await expect(deliver(runtimeA, payload)).rejects.toThrow(
      "simulated abrupt runtime termination after ACK delivery",
    );
    expect(controls.downstreamCalls).toBe(1);
    expect(controls.questionCalls).toBe(1);
    const afterCrashBodies = outboundPayloads
      .filter(payloadItem => payloadItem.type === "text")
      .map(payloadItem => payloadItem.text?.body);
    expect(afterCrashBodies).toEqual([ACK_TEXT]);

    await new Promise(resolve => setTimeout(resolve, HEARTBEAT_TIMEOUT_MS + 750));
    const candidate = await findPersistedRecoveryCandidate(messageId);
    expect(candidate).toBeTruthy();
    const recoveryRepository = createDrizzleWhatsAppQuestionRecoveryRepository({
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
      }),
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
      [`whatsapp:inbound:${messageId}`],
    );
    expect(responseRows).toHaveLength(1);
    expect(responseRows[0].sanitizedText).toBe(FINAL_TEXT);

    await connection.end();
  }, 20_000);

  it("fecha o lifecycle sem nova IA/outbound quando a final já foi persistida antes de processedAt", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    expect(databaseUrl).toBeTruthy();
    const connection = await mysql.createConnection(databaseUrl!);
    const { messageId, payload } = await createPersistedQuestionFixture(connection);

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
        .map(payloadItem => payloadItem.text?.body),
    ).toEqual([ACK_TEXT, FINAL_TEXT]);

    const [rows] = await connection.execute<RowDataPacket[]>(
      `SELECT id FROM whatsappConversationMessages WHERE idempotencyKey = ?`,
      [`whatsapp:inbound:${messageId}`],
    );
    expect(rows).toHaveLength(1);
    const inboundMessageId = Number(rows[0].id);

    // Reconstitui exatamente a janela crash-after-final/before-processedAt:
    // resposta funcional continua persistida, inbound volta a aberto e existe
    // um owner antigo já fora da janela de liveness.
    await connection.execute(
      "UPDATE whatsappConversationMessages SET processedAt = NULL WHERE id = ?",
      [inboundMessageId],
    );
    await connection.execute(
      `INSERT INTO whatsappMessageProcessingClaims (messageId, ownerToken, claimedAt, heartbeatAt)
       VALUES (?, ?, DATE_SUB(NOW(), INTERVAL 10 SECOND), DATE_SUB(NOW(), INTERVAL 10 SECOND))`,
      [inboundMessageId, "dead-final-owner"],
    );

    const candidate = await findPersistedRecoveryCandidate(messageId);
    expect(candidate).toBeTruthy();
    const recoveryRepository = createDrizzleWhatsAppQuestionRecoveryRepository({
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
      }),
    );

    expect(cycle).toEqual({
      candidates: 1,
      outcomes: [{ messageId: inboundMessageId, outcome: "completed_existing" }],
    });
    expect(controls.questionCalls).toBe(1);
    expect(outboundPayloads).toHaveLength(deliveredBeforeRecovery);

    const [completedRows] = await connection.execute<RowDataPacket[]>(
      "SELECT processedAt FROM whatsappConversationMessages WHERE id = ?",
      [inboundMessageId],
    );
    expect(completedRows[0].processedAt).not.toBeNull();
    const [claimRows] = await connection.execute<RowDataPacket[]>(
      "SELECT messageId FROM whatsappMessageProcessingClaims WHERE messageId = ?",
      [inboundMessageId],
    );
    expect(claimRows).toHaveLength(0);

    await connection.end();
  }, 20_000);

  it("registra pelo serviço real e ajusta via webhook sem duplicar na redelivery", async () => {
    const databaseUrl = process.env.DATABASE_URL?.trim();
    expect(databaseUrl).toBeTruthy();
    const connection = await mysql.createConnection(databaseUrl!);

    try {
      const fixture = await createPersistedQuestionFixture(connection);
      const { listMeals } = await import("./modules/meals/service");
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

      const initialMeals = await listMeals(fixture.userId);
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
      expect(initialPresunto).toMatchObject({
        quantity: 1,
        unit: "fatia",
        estimatedGrams: 18,
      });
      expect(initialMussarela).toMatchObject({
        quantity: 1,
        unit: "fatia",
        estimatedGrams: 20,
      });
      expect(initialPresunto.foodId).toBeUndefined();
      expect(initialMussarela.foodId).toBeUndefined();

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

      const finalMeals = await listMeals(fixture.userId);
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
        estimatedGrams: 40,
      });
      expect(finalRequeijao.estimatedGrams).toBe(93);
    } finally {
      await connection.end();
    }
  }, 20_000);
});
