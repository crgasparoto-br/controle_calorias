import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const sourceRoot = path.resolve(process.env.QUESTION_BENCH_SOURCE_ROOT || "");
const manifestPath = path.resolve(process.env.QUESTION_BENCH_MANIFEST || "");
const mode = process.env.QUESTION_BENCH_MODE || "unknown";
const sourceSha = process.env.QUESTION_BENCH_SOURCE_SHA || "unknown";
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));

process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "synthetic-question-benchmark-placeholder";
process.env.AI_QUESTION_PROVIDER = "openai";
process.env.AI_QUESTION_MODEL = "gpt-4.1-mini";
process.env.AI_QUESTION_TIMEOUT_MS = "2000";
process.env.AI_QUESTION_MAX_ATTEMPTS = "1";
process.env.AI_QUESTION_FALLBACK_ENABLED = "false";
process.env.AI_QUESTION_WEB_SEARCH_MODE = "auto";

const delays = Object.freeze({
  userLookup: 5,
  conversation: 8,
  inboundPersist: 12,
  outboundPersist: 10,
  responseLinkPersist: 5,
  processedPersist: 8,
  delivery: 10,
  history: 10,
  today: 30,
  currentWeek: 45,
  last30Days: 120,
  llm: 80,
});

function createConversationRepository(state) {
  let nextMessageId = 1000;
  return {
    async createOrGetActiveConversation() {
      state.persistenceOperations.conversation += 1;
      await state.sleep(state.delays.conversation);
      return { id: 77 };
    },
    async appendMessage(input) {
      const outbound = input?.direction === "outbound";
      state.persistenceOperations[outbound ? "outbound" : "inbound"] += 1;
      await state.sleep(outbound ? state.delays.outboundPersist : state.delays.inboundPersist);
      nextMessageId += 1;
      return { message: { id: nextMessageId }, wasNewInsert: true };
    },
    async linkResponse() {
      state.persistenceOperations.responseLink += 1;
      await state.sleep(state.delays.responseLinkPersist);
    },
    async markProcessed() {
      state.persistenceOperations.processed += 1;
      await state.sleep(state.delays.processedPersist);
      if (state.persistenceFailure) throw new Error("synthetic persistence failure");
    },
    async findDomainLinksForMessage() { return []; },
    async linkDomainRecord() {},
    async findRecentMessages() { return []; },
    async findRecentMessagesByUser() { return []; },
    async createOrGetActiveConversationForUpdate() { return { id: 77 }; },
  };
}

function createObservationState(fixture = {}) {
  const state = {
    events: [],
    providerCalls: 0,
    deliveryCalls: 0,
    offeredWebSearch: false,
    contextLoads: { history: 0, today: 0, currentWeek: 0, last30Days: 0, unusedDomainSnapshot: 0 },
    persistenceOperations: { conversation: 0, inbound: 0, outbound: 0, responseLink: 0, processed: 0 },
    delays,
    failureMode: fixture.failureMode ?? "none",
    deliveryFailure: fixture.deliveryFailure === true,
    persistenceFailure: fixture.persistenceFailure === true,
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
    defaultConversationRepository: null,
  };
  state.defaultConversationRepository = createConversationRepository(state);
  return state;
}

async function moduleExists(relativePath) {
  try {
    await fs.access(path.join(sourceRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

globalThis.__questionLatencyBench = createObservationState();

const assistantUrl = pathToFileURL(path.join(sourceRoot, "server/modules/whatsapp/aiQuestionAssistant.ts")).href;
const lifecycleUrl = pathToFileURL(path.join(sourceRoot, "server/modules/whatsapp/messageLifecycle.ts")).href;
const deliveryUrl = pathToFileURL(path.join(sourceRoot, "server/modules/whatsapp/logicalReplyDelivery.ts")).href;
const { executeWhatsappAiQuestionIntent } = await import(assistantUrl);
const {
  beginInboundMessage,
  createMessageLifecycleService,
  markMessageProcessed,
  withMessageLifecycleService,
} = await import(lifecycleUrl);
const { sendWhatsAppLogicalDomainReply } = await import(deliveryUrl);

let questionLatencyContext = null;
if (await moduleExists("server/modules/whatsapp/questionLatencyContext.ts")) {
  questionLatencyContext = await import(
    pathToFileURL(path.join(sourceRoot, "server/modules/whatsapp/questionLatencyContext.ts")).href
  );
}

function findFinalLatencyEvent(state) {
  for (let index = state.events.length - 1; index >= 0; index -= 1) {
    const event = state.events[index];
    if (event?.eventType !== "whatsapp.ai_question.latency") continue;
    try {
      const parsed = JSON.parse(event.detail);
      if (parsed?.schemaVersion === 2 && parsed?.boundary === "inbound_persistence_to_processed_reply") {
        return parsed;
      }
    } catch {
      // Ignore malformed or legacy component-level events.
    }
  }
  return null;
}

async function executePipeline(fixture, repetition) {
  const state = globalThis.__questionLatencyBench;
  const lifecycleService = createMessageLifecycleService({
    conversationRepository: state.defaultConversationRepository,
  });
  const runQuestionScope = questionLatencyContext?.runWithQuestionLatencyContext ?? (operation => operation());

  return runQuestionScope(async () => {
    questionLatencyContext?.beginCurrentQuestionLatencyTrace?.({
      userId: null,
      contentType: "text",
      text: `/ ${fixture.question}`,
    });
    await state.sleep(state.delays.userLookup);

    return withMessageLifecycleService(lifecycleService, async () => {
      const handle = await beginInboundMessage({
        userId: 42,
        whatsappConnectionId: null,
        phoneNumber: "5511999999999",
        externalMessageId: `synthetic-${fixture.id}-${repetition}`,
        contentType: "text",
        text: `/ ${fixture.question}`,
        occurredAt: new Date("2026-08-17T18:00:00Z"),
        allowRawContentStorage: true,
      });

      const result = await executeWhatsappAiQuestionIntent(42, {
        text: `/ ${fixture.question}`,
        receivedAt: new Date("2026-08-17T18:00:00Z"),
        userTimezone: "America/Sao_Paulo",
        externalMessageId: `synthetic-${fixture.id}-${repetition}`,
      });

      if (result) {
        await sendWhatsAppLogicalDomainReply({
          to: "5511999999999",
          userId: 42,
          replyText: result.reply,
          lifecycleHandle: handle,
        });
        await markMessageProcessed(handle);
      }
      return result;
    });
  });
}

const observations = [];
for (const fixture of manifest.fixtures) {
  for (let repetition = 1; repetition <= manifest.repetitionsPerFixture; repetition += 1) {
    globalThis.__questionLatencyBench = createObservationState(fixture);
    const startedAt = performance.now();
    let outcome = "success";
    let errorCode = null;
    let contextScope = null;
    try {
      const result = await executePipeline(fixture, repetition);
      contextScope = result?.data?.contextScope ?? null;
      if (!result || result.action !== "ai_question_answered") {
        outcome = "error";
        errorCode = result?.data?.reason ?? result?.action ?? "unexpected_result";
      }
    } catch (error) {
      errorCode = typeof error?.code === "string" ? error.code : "unexpected_error";
      outcome = errorCode === "timeout" ? "timeout" : "error";
    }
    const state = globalThis.__questionLatencyBench;
    const totalMs = Math.round(performance.now() - startedAt);
    const finalLatency = findFinalLatencyEvent(state);
    observations.push({
      fixtureId: fixture.id,
      repetition,
      totalMs,
      outcome,
      errorCode,
      contextScope,
      providerCalls: state.providerCalls,
      deliveryCalls: state.deliveryCalls,
      offeredWebSearch: state.offeredWebSearch,
      contextLoads: state.contextLoads,
      persistenceOperations: state.persistenceOperations,
      finalLatency: finalLatency
        ? {
            totalMs: finalLatency.total_ms,
            dbMs: finalLatency.db_ms,
            contextMs: finalLatency.context_ms,
            persistMs: finalLatency.persist_ms,
            boundary: finalLatency.boundary,
            outcome: finalLatency.outcome,
            deliveryOk: finalLatency.delivery_ok,
          }
        : null,
    });
  }
}

process.stdout.write(`${JSON.stringify({ mode, sourceSha, delays, observations })}\n`);
