import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.env.QUESTION_BENCH_SOURCE_ROOT || "");
const manifest = JSON.parse(
  await fs.readFile(path.resolve(process.env.QUESTION_BENCH_MANIFEST || ""), "utf8"),
);

process.env.NODE_ENV = "test";
process.env.OPENAI_API_KEY = "synthetic";
process.env.AI_QUESTION_PROVIDER = "openai";
process.env.AI_QUESTION_MODEL = "gpt-4.1-mini";
process.env.AI_QUESTION_TIMEOUT_MS = "2000";
process.env.AI_QUESTION_MAX_ATTEMPTS = "1";
process.env.AI_QUESTION_FALLBACK_ENABLED = "false";
process.env.AI_QUESTION_WEB_SEARCH_MODE = "auto";

const execution = Object.freeze({
  timezone: manifest.timezone || "America/Sao_Paulo",
  provider: "openai-adapter-contract-via-hermetic-provider-double",
  providerId: process.env.AI_QUESTION_PROVIDER,
  model: process.env.AI_QUESTION_MODEL,
  policy: Object.freeze({
    timeoutMs: Number(process.env.AI_QUESTION_TIMEOUT_MS),
    maxAttempts: Number(process.env.AI_QUESTION_MAX_ATTEMPTS),
    fallback: process.env.AI_QUESTION_FALLBACK_ENABLED === "true",
    webSearch: process.env.AI_QUESTION_WEB_SEARCH_MODE === "auto"
      ? "auto-available-not-forced"
      : process.env.AI_QUESTION_WEB_SEARCH_MODE,
  }),
});

const delays = Object.freeze({
  userLookup: 5,
  timeZone: 6,
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

function repo(state) {
  let id = 1000;
  return {
    async createOrGetActiveConversation() {
      state.persistence.conversation++;
      await state.sleep(delays.conversation);
      return { id: 77 };
    },
    async appendMessage(input) {
      const key = input?.direction === "outbound" ? "outbound" : "inbound";
      state.persistence[key]++;
      await state.sleep(delays[key === "outbound" ? "outboundPersist" : "inboundPersist"]);
      return { message: { id: ++id }, wasNewInsert: true };
    },
    async linkResponse() {
      state.persistence.responseLink++;
      await state.sleep(delays.responseLinkPersist);
    },
    async markProcessed() {
      state.persistence.processed++;
      await state.sleep(delays.processedPersist);
    },
    async findDomainLinksForMessage() { return []; },
    async linkDomainRecord() {},
    async findRecentMessages() { return []; },
    async findRecentMessagesByUser() {
      state.contextLoads.history++;
      state.historySourceLoads.persistent++;
      await state.sleep(delays.history);
      return [{
        id: 900,
        conversationId: 77,
        userId: 42,
        direction: "inbound",
        contentType: "text",
        text: "historical-marker",
        sanitizedText: "historical-marker",
        externalMessageId: "wamid.history",
        occurredAt: new Date("2026-08-17T17:00:00.000Z"),
        createdAt: new Date("2026-08-17T17:00:00.000Z"),
        updatedAt: new Date("2026-08-17T17:00:00.000Z"),
      }];
    },
    async createOrGetActiveConversationForUpdate() { return { id: 77 }; },
  };
}

function createState() {
  const state = {
    events: [],
    providerCalls: 0,
    deliveryCalls: 0,
    offeredWebSearch: false,
    historySent: false,
    contextLoads: { history: 0, today: 0, currentWeek: 0, last30Days: 0, unusedDomainSnapshot: 0 },
    contextHelperCalls: { history: 0 },
    historySourceLoads: { legacy: 0, persistent: 0 },
    dbOperations: { userLookup: 0, timeZone: 0 },
    persistence: { conversation: 0, inbound: 0, outbound: 0, responseLink: 0, processed: 0 },
    delays,
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    repo: null,
  };
  state.repo = repo(state);
  return state;
}

globalThis.__q = createState();
const sourceUrl = relativePath => pathToFileURL(path.join(root, relativePath)).href;

const { executeWhatsappAiQuestionIntent } = await import(sourceUrl("server/modules/whatsapp/aiQuestionAssistant.ts"));
const db = await import(sourceUrl("server/db.ts"));
const tz = await import(sourceUrl("server/modules/whatsapp/timeZoneContext.ts"));
const life = await import(sourceUrl("server/modules/whatsapp/messageLifecycle.ts"));
const { sendWhatsAppLogicalDomainReply } = await import(sourceUrl("server/modules/whatsapp/logicalReplyDelivery.ts"));
let latency = null;
try {
  latency = await import(sourceUrl("server/modules/whatsapp/questionLatencyContext.ts"));
} catch {}

function finalLatency(state) {
  for (let index = state.events.length - 1; index >= 0; index--) {
    const event = state.events[index];
    if (event?.eventType !== "whatsapp.ai_question.latency") continue;
    try {
      const detail = JSON.parse(event.detail);
      if (detail?.boundary === "inbound_persistence_to_processed_reply") return detail;
    } catch {}
  }
  return null;
}

async function runFixture(fixture, repetition) {
  const state = globalThis.__q;
  const service = life.createMessageLifecycleService({ conversationRepository: state.repo });
  const scope = latency?.runWithQuestionLatencyContext ?? (operation => operation());
  return scope(async () => {
    latency?.beginCurrentQuestionLatencyTrace?.({
      userId: null,
      contentType: "text",
      text: `/ ${fixture.question}`,
    });
    const userId = await db.getUserIdByWhatsappPhone("5511999999999");
    const zone = await tz.resolveWhatsAppOperationTimeZone(userId);
    return life.withMessageLifecycleService(service, async () => {
      const handle = await life.beginInboundMessage({
        userId,
        whatsappConnectionId: null,
        phoneNumber: "5511999999999",
        externalMessageId: `v4-${fixture.id}-${repetition}`,
        contentType: "text",
        text: `/ ${fixture.question}`,
        occurredAt: new Date("2026-08-17T18:00:00Z"),
        allowRawContentStorage: true,
      });
      const result = await executeWhatsappAiQuestionIntent(userId, {
        text: `/ ${fixture.question}`,
        receivedAt: new Date("2026-08-17T18:00:00Z"),
        userTimezone: zone.timeZone,
        externalMessageId: `v4-${fixture.id}-${repetition}`,
      });
      if (result) {
        await sendWhatsAppLogicalDomainReply({
          to: "5511999999999",
          userId,
          replyText: result.reply,
          lifecycleHandle: handle,
        });
        await life.markMessageProcessed(handle);
      }
      return result;
    });
  });
}

async function runGenericHistoryBypassProbe(fixture, rolloutMode) {
  const previousMode = process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT;
  const previousPercent = process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT;
  process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = rolloutMode;
  if (rolloutMode === "persistent") {
    process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT = "100";
  } else {
    delete process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT;
  }
  globalThis.__q = createState();
  try {
    const result = await runFixture(fixture, `probe-${rolloutMode}`);
    const state = globalThis.__q;
    return {
      rolloutMode,
      contextScope: result?.data?.contextScope ?? null,
      historySent: state.historySent,
      contextLoadsHistory: state.contextLoads.history,
      historySourceLoads: state.historySourceLoads,
    };
  } finally {
    if (previousMode === undefined) delete process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT;
    else process.env.WHATSAPP_CONTEXT_READ_MODE_TEXT = previousMode;
    if (previousPercent === undefined) delete process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT;
    else process.env.WHATSAPP_CONTEXT_ROLLOUT_PERCENT_TEXT = previousPercent;
  }
}

const observations = [];
for (const fixture of manifest.fixtures) {
  for (let repetition = 1; repetition <= manifest.repetitionsPerFixture; repetition++) {
    globalThis.__q = createState();
    const startedAt = performance.now();
    let outcome = "success";
    let contextScope = null;
    try {
      const result = await runFixture(fixture, repetition);
      contextScope = result?.data?.contextScope ?? null;
      if (!result || result.action !== "ai_question_answered") outcome = "error";
    } catch {
      outcome = "error";
    }
    const state = globalThis.__q;
    const final = finalLatency(state);
    observations.push({
      fixtureId: fixture.id,
      totalMs: Math.round(performance.now() - startedAt),
      outcome,
      contextScope,
      providerCalls: state.providerCalls,
      deliveryCalls: state.deliveryCalls,
      offeredWebSearch: state.offeredWebSearch,
      historySent: state.historySent,
      contextLoads: state.contextLoads,
      contextHelperCalls: state.contextHelperCalls,
      historySourceLoads: state.historySourceLoads,
      dbOperations: state.dbOperations,
      persistenceOperations: state.persistence,
      finalLatency: final ? {
        totalMs: final.total_ms,
        dbMs: final.db_ms,
        contextMs: final.context_ms,
        persistMs: final.persist_ms,
        boundary: final.boundary,
        outcome: final.outcome,
        deliveryOk: final.delivery_ok,
      } : null,
    });
  }
}

const genericFixture = manifest.fixtures.find(fixture => fixture.expectedScope === "none");
const historyBypassProbes = process.env.QUESTION_BENCH_MODE === "candidate" && genericFixture
  ? await Promise.all(["write_only", "shadow", "persistent"].map(mode => runGenericHistoryBypassProbe(genericFixture, mode)))
  : [];

process.stdout.write(`${JSON.stringify({
  mode: process.env.QUESTION_BENCH_MODE,
  sourceSha: process.env.QUESTION_BENCH_SOURCE_SHA,
  execution,
  delays,
  observations,
  historyBypassProbes,
})}\n`);
