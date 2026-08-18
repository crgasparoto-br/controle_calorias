import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { logInferenceEvent } from "../../db";
import { getQuestionContextSections, type QuestionContextScope } from "./questionContextPlan";

export type QuestionLatencyTrace = {
  userId: number | null;
  requestId: string;
  startedAt: number;
  dbMs: number | null;
  contextMs: number | null;
  llmMs: number | null;
  persistMs: number | null;
  contextScope: QuestionContextScope | null;
  configuredProvider: string | null;
  configuredModel: string | null;
  effectiveProvider: string | null;
  effectiveModel: string | null;
  attempts: number | null;
  retryOccurred: boolean | null;
  fallbackOccurred: boolean | null;
  webSearchAvailable: boolean | null;
  webSearchExecuted: boolean | null;
  outcome: "success" | "error" | null;
  errorCode: string | null;
  deliveryOk: boolean | null;
  finalized: boolean;
};

type QuestionLatencyScope = {
  trace: QuestionLatencyTrace | null;
};

const questionLatencyScope = new AsyncLocalStorage<QuestionLatencyScope>();

function roundLatency(value: number | null) {
  return value === null ? null : Math.max(0, Math.round(value));
}

function hasQuestionContent(text?: string | null) {
  const trimmed = text?.trim() ?? "";
  return trimmed.startsWith("/") && trimmed.replace(/^\/+/, "").trim().length > 0;
}

function createTrace(userId: number | null, startedAt = performance.now()): QuestionLatencyTrace {
  return {
    userId,
    requestId: randomUUID(),
    startedAt,
    dbMs: null,
    contextMs: null,
    llmMs: null,
    persistMs: null,
    contextScope: null,
    configuredProvider: null,
    configuredModel: null,
    effectiveProvider: null,
    effectiveModel: null,
    attempts: null,
    retryOccurred: null,
    fallbackOccurred: null,
    webSearchAvailable: null,
    webSearchExecuted: null,
    outcome: null,
    errorCode: null,
    deliveryOk: null,
    finalized: false,
  };
}

export function runWithQuestionLatencyContext<T>(operation: () => T): T {
  if (questionLatencyScope.getStore()) return operation();
  const scope: QuestionLatencyScope = { trace: null };
  return questionLatencyScope.run(scope, () => {
    const finishIncompleteTrace = () => {
      if (!scope.trace || scope.trace.finalized) return;
      if (scope.trace.outcome !== "error") {
        recordCurrentQuestionOutcome("error", "request_incomplete");
      }
      finalizeCurrentQuestionLatencyTrace();
    };

    try {
      const result = operation();
      if (result && typeof (result as PromiseLike<unknown>).then === "function") {
        return Promise.resolve(result)
          .catch(error => {
            if (scope.trace && !scope.trace.finalized && scope.trace.outcome !== "error") {
              recordCurrentQuestionOutcome("error", "request_failed");
            }
            throw error;
          })
          .finally(finishIncompleteTrace) as unknown as T;
      }
      finishIncompleteTrace();
      return result;
    } catch (error) {
      if (scope.trace && !scope.trace.finalized && scope.trace.outcome !== "error") {
        recordCurrentQuestionOutcome("error", "request_failed");
      }
      finalizeCurrentQuestionLatencyTrace();
      throw error;
    }
  });
}

export function beginCurrentQuestionLatencyTrace(input: {
  userId: number | null;
  contentType: string;
  text?: string | null;
}) {
  const scope = questionLatencyScope.getStore();
  if (!scope || input.contentType !== "text" || !hasQuestionContent(input.text)) return null;
  const trace = createTrace(input.userId);
  scope.trace = trace;
  return trace;
}

export function ensureCurrentQuestionLatencyTrace(userId: number) {
  const scope = questionLatencyScope.getStore();
  if (scope?.trace) {
    if (scope.trace.userId === null) scope.trace.userId = userId;
    return scope.trace;
  }
  const trace = createTrace(userId);
  if (scope) scope.trace = trace;
  return trace;
}

export function getCurrentQuestionLatencyTrace() {
  return questionLatencyScope.getStore()?.trace ?? null;
}

export function recordCurrentQuestionPersistenceMs(durationMs: number) {
  const trace = getCurrentQuestionLatencyTrace();
  if (!trace || trace.finalized) return;
  trace.persistMs = (trace.persistMs ?? 0) + Math.max(0, durationMs);
}

export function recordCurrentQuestionAiStage(input: {
  contextScope: QuestionContextScope;
  dbMs: number | null;
  contextMs: number | null;
  llmMs: number | null;
  configuredProvider: string | null;
  configuredModel: string | null;
  effectiveProvider: string | null;
  effectiveModel: string | null;
  attempts: number | null;
  fallbackOccurred: boolean | null;
  webSearchAvailable: boolean;
  webSearchExecuted: boolean | null;
}) {
  const trace = getCurrentQuestionLatencyTrace();
  if (!trace || trace.finalized) return;
  trace.contextScope = input.contextScope;
  trace.dbMs = input.dbMs;
  trace.contextMs = input.contextMs;
  trace.llmMs = input.llmMs;
  trace.configuredProvider = input.configuredProvider;
  trace.configuredModel = input.configuredModel;
  trace.effectiveProvider = input.effectiveProvider;
  trace.effectiveModel = input.effectiveModel;
  trace.attempts = input.attempts;
  trace.fallbackOccurred = input.fallbackOccurred;
  trace.retryOccurred = typeof input.attempts === "number"
    ? input.attempts - (input.fallbackOccurred ? 1 : 0) > 1
    : null;
  trace.webSearchAvailable = input.webSearchAvailable;
  trace.webSearchExecuted = input.webSearchExecuted;
}

export function recordCurrentQuestionOutcome(outcome: "success" | "error", errorCode: string | null) {
  const trace = getCurrentQuestionLatencyTrace();
  if (!trace || trace.finalized) return;
  trace.outcome = outcome;
  trace.errorCode = errorCode;
}

export function recordCurrentQuestionDeliveryOutcome(ok: boolean) {
  const trace = getCurrentQuestionLatencyTrace();
  if (!trace || trace.finalized) return;
  trace.deliveryOk = ok;
  if (!ok && trace.outcome !== "error") {
    trace.outcome = "error";
    trace.errorCode = "delivery_failed";
  }
}

export function finalizeCurrentQuestionLatencyTrace() {
  const scope = questionLatencyScope.getStore();
  const trace = scope?.trace ?? null;
  if (!trace || trace.finalized) return;
  trace.finalized = true;

  const outcome = trace.outcome ?? (trace.deliveryOk === false ? "error" : "success");
  const errorCode = trace.errorCode ?? (trace.deliveryOk === false ? "delivery_failed" : null);
  const sections = trace.contextScope ? getQuestionContextSections(trace.contextScope) : null;

  logInferenceEvent({
    userId: trace.userId,
    origin: "whatsapp",
    status: outcome === "success" ? "success" : "error",
    eventType: "whatsapp.ai_question.latency",
    detail: JSON.stringify({
      schemaVersion: 2,
      requestId: trace.requestId,
      capability: "QUESTION",
      flow: "whatsapp_question",
      boundary: "inbound_persistence_to_processed_reply",
      total_ms: roundLatency(performance.now() - trace.startedAt),
      db_ms: roundLatency(trace.dbMs),
      context_ms: roundLatency(trace.contextMs),
      llm_ms: roundLatency(trace.llmMs),
      persist_ms: roundLatency(trace.persistMs),
      time_to_first_token_ms: null,
      context_scope: trace.contextScope,
      context_sections: sections,
      configured_provider: trace.configuredProvider,
      configured_model: trace.configuredModel,
      effective_provider: trace.effectiveProvider,
      effective_model: trace.effectiveModel,
      attempts: trace.attempts,
      retry_occurred: trace.retryOccurred,
      fallback_occurred: trace.fallbackOccurred,
      web_search_available: trace.webSearchAvailable,
      web_search_executed: trace.webSearchExecuted,
      delivery_ok: trace.deliveryOk,
      outcome,
      error_code: errorCode,
    }),
  });

  if (scope) scope.trace = null;
}
