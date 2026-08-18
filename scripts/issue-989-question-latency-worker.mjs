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
  history: 10,
  today: 30,
  currentWeek: 45,
  last30Days: 120,
  llm: 80,
});

function createObservationState() {
  return {
    events: [],
    providerCalls: 0,
    offeredWebSearch: false,
    contextLoads: { history: 0, today: 0, currentWeek: 0, last30Days: 0 },
    delays,
    failureMode: "none",
    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    },
  };
}

globalThis.__questionLatencyBench = createObservationState();
const assistantUrl = pathToFileURL(
  path.join(sourceRoot, "server/modules/whatsapp/aiQuestionAssistant.ts"),
).href;
const { executeWhatsappAiQuestionIntent } = await import(assistantUrl);

const observations = [];
for (const fixture of manifest.fixtures) {
  for (let repetition = 1; repetition <= manifest.repetitionsPerFixture; repetition += 1) {
    globalThis.__questionLatencyBench = createObservationState();
    const startedAt = performance.now();
    let outcome = "success";
    let errorCode = null;
    let contextScope = null;
    try {
      const result = await executeWhatsappAiQuestionIntent(42, {
        text: `/ ${fixture.question}`,
        receivedAt: new Date("2026-08-17T18:00:00Z"),
        userTimezone: "America/Sao_Paulo",
      });
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
    observations.push({
      fixtureId: fixture.id,
      repetition,
      totalMs: Math.round(performance.now() - startedAt),
      outcome,
      errorCode,
      contextScope,
      providerCalls: state.providerCalls,
      offeredWebSearch: state.offeredWebSearch,
      contextLoads: state.contextLoads,
    });
  }
}

process.stdout.write(`${JSON.stringify({ mode, sourceSha, delays, observations })}\n`);
