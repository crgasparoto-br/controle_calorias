import { createHash } from "node:crypto";
import type { WhatsappAiToolId } from "./aiToolContract";
import type { WhatsappIntentName } from "./intentSchema";

export type WhatsappPipelineStage =
  | "normalization"
  | "router"
  | "llm"
  | "validation"
  | "nutrition_source"
  | "memory"
  | "tools"
  | "persistence";

export type WhatsappPipelineOutcome = "success" | "failure" | "timeout" | "retry" | "fallback" | "skipped";
export type WhatsappPipelineChannel = "whatsapp";
export type WhatsappPipelineStrategy = "deterministic" | "llm_structured" | "safe_fallback";

export type WhatsappPipelineTraceSpan = {
  stage: WhatsappPipelineStage;
  outcome: WhatsappPipelineOutcome;
  latencyMs: number;
  estimatedCostUnits: number;
  retryCount: number;
  modelName: string | null;
  version: string | null;
  toolId: WhatsappAiToolId | null;
  errorCode?: string;
  fallbackReason?: string;
};

export type WhatsappPipelineTraceEntry = {
  id: number;
  traceId: string;
  createdAt: string;
  expiresAt: string | null;
  userId: number;
  channel: WhatsappPipelineChannel;
  messageHash: string;
  messageIdHash: string | null;
  intent: WhatsappIntentName | "unknown";
  contextVersion: string | null;
  schemaVersion: string | null;
  promptVersion: string | null;
  ruleVersion: string | null;
  strategy: WhatsappPipelineStrategy;
  modelName: string | null;
  spans: WhatsappPipelineTraceSpan[];
  totalLatencyMs: number;
  totalEstimatedCostUnits: number;
  hasError: boolean;
  hasTimeout: boolean;
  usedFallback: boolean;
};

type RecordWhatsappPipelineTraceInput = {
  traceId?: string;
  userId: number;
  channel?: WhatsappPipelineChannel;
  messageText?: string | null;
  messageHash?: string | null;
  messageId?: string | null;
  createdAt?: Date;
  retentionDays?: number;
  intent?: WhatsappIntentName | "unknown";
  contextVersion?: string | null;
  schemaVersion?: string | null;
  promptVersion?: string | null;
  ruleVersion?: string | null;
  strategy?: WhatsappPipelineStrategy;
  modelName?: string | null;
  spans: Array<Partial<WhatsappPipelineTraceSpan> & { stage: WhatsappPipelineStage; outcome: WhatsappPipelineOutcome }>;
};

type ListWhatsappPipelineTracesFilter = {
  traceId?: string;
  channel?: WhatsappPipelineChannel;
  intent?: WhatsappIntentName | "unknown";
  stage?: WhatsappPipelineStage;
  modelName?: string;
  version?: string;
  hasError?: boolean;
  hasTimeout?: boolean;
  usedFallback?: boolean;
  from?: Date | string;
  to?: Date | string;
};

type StageSummary = {
  count: number;
  averageLatencyMs: number;
  estimatedCostUnits: number;
  errorCount: number;
  timeoutCount: number;
  fallbackCount: number;
  retryCount: number;
};

type WhatsappPipelineObservabilitySummary = {
  totalMessages: number;
  totalSpans: number;
  averageLatencyMs: number;
  estimatedCostUnits: number;
  errorCount: number;
  timeoutCount: number;
  fallbackCount: number;
  retryCount: number;
  byIntent: Partial<Record<WhatsappIntentName | "unknown", { count: number; estimatedCostUnits: number }>>;
  byModel: Record<string, { count: number; estimatedCostUnits: number }>;
  byStage: Partial<Record<WhatsappPipelineStage, StageSummary>>;
};

const MAX_PIPELINE_TRACE_ENTRIES = 1_000;
const DEFAULT_RETENTION_DAYS = 30;
const entries: WhatsappPipelineTraceEntry[] = [];
let nextTraceEntryId = 1;

function hashValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function toTime(value?: Date | string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function sanitizeNumber(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
}

function sanitizeCost(value: unknown) {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function sanitizeSpan(span: RecordWhatsappPipelineTraceInput["spans"][number]): WhatsappPipelineTraceSpan {
  return {
    stage: span.stage,
    outcome: span.outcome,
    latencyMs: sanitizeNumber(span.latencyMs),
    estimatedCostUnits: sanitizeCost(span.estimatedCostUnits),
    retryCount: sanitizeNumber(span.retryCount),
    modelName: span.modelName ?? null,
    version: span.version ?? null,
    toolId: span.toolId ?? null,
    ...(span.errorCode ? { errorCode: span.errorCode } : {}),
    ...(span.fallbackReason ? { fallbackReason: span.fallbackReason } : {}),
  };
}

function hasErrorOutcome(span: WhatsappPipelineTraceSpan) {
  return span.outcome === "failure" || span.outcome === "timeout" || Boolean(span.errorCode);
}

function hasFallbackOutcome(span: WhatsappPipelineTraceSpan) {
  return span.outcome === "fallback" || Boolean(span.fallbackReason);
}

function buildMessageHash(input: RecordWhatsappPipelineTraceInput) {
  if (input.messageHash) return input.messageHash;
  if (input.messageText) return hashValue(input.messageText);
  return hashValue(`${input.userId}:${input.traceId ?? nextTraceEntryId}`);
}

function buildExpiresAt(createdAt: Date, retentionDays: number | undefined) {
  const days = retentionDays ?? DEFAULT_RETENTION_DAYS;
  if (days <= 0) return null;
  return new Date(createdAt.getTime() + days * 86_400_000).toISOString();
}

function pruneExpiredEntries(now: Date) {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const expiresAt = entries[index].expiresAt;
    if (expiresAt && new Date(expiresAt).getTime() <= now.getTime()) {
      entries.splice(index, 1);
    }
  }
  if (entries.length > MAX_PIPELINE_TRACE_ENTRIES) {
    entries.splice(0, entries.length - MAX_PIPELINE_TRACE_ENTRIES);
  }
}

function matchesVersion(entry: WhatsappPipelineTraceEntry, version: string) {
  return entry.contextVersion === version
    || entry.schemaVersion === version
    || entry.promptVersion === version
    || entry.ruleVersion === version
    || entry.spans.some(span => span.version === version);
}

export function recordWhatsappPipelineTrace(input: RecordWhatsappPipelineTraceInput) {
  const createdAt = input.createdAt ?? new Date();
  const spans = input.spans.map(sanitizeSpan);
  const totalLatencyMs = spans.reduce((sum, span) => sum + span.latencyMs, 0);
  const totalEstimatedCostUnits = spans.reduce((sum, span) => sum + span.estimatedCostUnits, 0);
  const hasError = spans.some(hasErrorOutcome);
  const hasTimeout = spans.some(span => span.outcome === "timeout");
  const usedFallback = spans.some(hasFallbackOutcome) || input.strategy === "safe_fallback";

  const entry: WhatsappPipelineTraceEntry = {
    id: nextTraceEntryId,
    traceId: input.traceId ?? `whatsapp-trace-${nextTraceEntryId}`,
    createdAt: createdAt.toISOString(),
    expiresAt: buildExpiresAt(createdAt, input.retentionDays),
    userId: input.userId,
    channel: input.channel ?? "whatsapp",
    messageHash: buildMessageHash(input),
    messageIdHash: input.messageId ? hashValue(input.messageId) : null,
    intent: input.intent ?? "unknown",
    contextVersion: input.contextVersion ?? null,
    schemaVersion: input.schemaVersion ?? null,
    promptVersion: input.promptVersion ?? null,
    ruleVersion: input.ruleVersion ?? null,
    strategy: input.strategy ?? "deterministic",
    modelName: input.modelName ?? null,
    spans,
    totalLatencyMs,
    totalEstimatedCostUnits,
    hasError,
    hasTimeout,
    usedFallback,
  };

  nextTraceEntryId += 1;
  entries.push(entry);
  pruneExpiredEntries(createdAt);
  return entry;
}

export function listWhatsappPipelineTraces(filter: ListWhatsappPipelineTracesFilter = {}) {
  const from = toTime(filter.from);
  const to = toTime(filter.to);
  return entries.filter(entry => {
    const createdAt = new Date(entry.createdAt).getTime();
    if (filter.traceId && entry.traceId !== filter.traceId) return false;
    if (filter.channel && entry.channel !== filter.channel) return false;
    if (filter.intent && entry.intent !== filter.intent) return false;
    if (filter.stage && !entry.spans.some(span => span.stage === filter.stage)) return false;
    if (filter.modelName && entry.modelName !== filter.modelName && !entry.spans.some(span => span.modelName === filter.modelName)) return false;
    if (filter.version && !matchesVersion(entry, filter.version)) return false;
    if (typeof filter.hasError === "boolean" && entry.hasError !== filter.hasError) return false;
    if (typeof filter.hasTimeout === "boolean" && entry.hasTimeout !== filter.hasTimeout) return false;
    if (typeof filter.usedFallback === "boolean" && entry.usedFallback !== filter.usedFallback) return false;
    if (from !== null && createdAt < from) return false;
    if (to !== null && createdAt > to) return false;
    return true;
  });
}

function emptyStageSummary(): StageSummary {
  return {
    count: 0,
    averageLatencyMs: 0,
    estimatedCostUnits: 0,
    errorCount: 0,
    timeoutCount: 0,
    fallbackCount: 0,
    retryCount: 0,
  };
}

export function summarizeWhatsappPipelineObservability(filter: ListWhatsappPipelineTracesFilter = {}): WhatsappPipelineObservabilitySummary {
  const traces = listWhatsappPipelineTraces(filter);
  const summary: WhatsappPipelineObservabilitySummary = {
    totalMessages: traces.length,
    totalSpans: 0,
    averageLatencyMs: 0,
    estimatedCostUnits: 0,
    errorCount: 0,
    timeoutCount: 0,
    fallbackCount: 0,
    retryCount: 0,
    byIntent: {},
    byModel: {},
    byStage: {},
  };

  for (const trace of traces) {
    summary.estimatedCostUnits += trace.totalEstimatedCostUnits;
    summary.errorCount += trace.hasError ? 1 : 0;
    summary.timeoutCount += trace.hasTimeout ? 1 : 0;
    summary.fallbackCount += trace.usedFallback ? 1 : 0;

    const intentSummary = summary.byIntent[trace.intent] ?? { count: 0, estimatedCostUnits: 0 };
    intentSummary.count += 1;
    intentSummary.estimatedCostUnits += trace.totalEstimatedCostUnits;
    summary.byIntent[trace.intent] = intentSummary;

    if (trace.modelName) {
      const modelSummary = summary.byModel[trace.modelName] ?? { count: 0, estimatedCostUnits: 0 };
      modelSummary.count += 1;
      modelSummary.estimatedCostUnits += trace.totalEstimatedCostUnits;
      summary.byModel[trace.modelName] = modelSummary;
    }

    for (const span of trace.spans) {
      summary.totalSpans += 1;
      summary.retryCount += span.retryCount;
      const stageSummary = summary.byStage[span.stage] ?? emptyStageSummary();
      stageSummary.count += 1;
      stageSummary.averageLatencyMs += span.latencyMs;
      stageSummary.estimatedCostUnits += span.estimatedCostUnits;
      stageSummary.errorCount += hasErrorOutcome(span) ? 1 : 0;
      stageSummary.timeoutCount += span.outcome === "timeout" ? 1 : 0;
      stageSummary.fallbackCount += hasFallbackOutcome(span) ? 1 : 0;
      stageSummary.retryCount += span.retryCount;
      summary.byStage[span.stage] = stageSummary;
    }
  }

  const totalLatency = traces.reduce((sum, trace) => sum + trace.totalLatencyMs, 0);
  summary.averageLatencyMs = traces.length ? Math.round(totalLatency / traces.length) : 0;

  for (const stage of Object.values(summary.byStage)) {
    stage.averageLatencyMs = stage.count ? Math.round(stage.averageLatencyMs / stage.count) : 0;
  }

  return summary;
}

export function __resetWhatsappPipelineObservabilityForTests() {
  entries.length = 0;
  nextTraceEntryId = 1;
}
