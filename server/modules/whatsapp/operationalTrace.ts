import { createHash } from "node:crypto";

export const whatsappOperationalTraceStages = [
  "normalization",
  "idempotency",
  "conversation_context",
  "professional_access",
  "time_reference",
  "multi_action",
  "water_food_split",
  "llm_router",
  "deterministic_intent",
  "record_adjustment",
  "food_assistant",
  "canonical_router",
  "nutrition_persistence",
  "response",
] as const;

export type WhatsappOperationalTraceStage = typeof whatsappOperationalTraceStages[number];
export type WhatsappOperationalTraceStatus = "success" | "warning" | "fallback" | "error" | "timeout" | "skipped";

export type WhatsappOperationalTraceStep = {
  stage: WhatsappOperationalTraceStage;
  status: WhatsappOperationalTraceStatus;
  durationMs: number;
  modelName?: string;
  schemaVersion?: string;
  ruleVersion?: string;
  processingStrategy?: string;
  intent?: string;
  toolNames?: string[];
  fallbackReason?: string;
  errorCode?: string;
  retryCount?: number;
  estimatedCostUsd?: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type WhatsappOperationalTrace = {
  id: number;
  traceId: string;
  createdAt: string;
  userId: number;
  channel: "whatsapp";
  messageHash: string;
  messageId?: string;
  eventId?: string;
  inputModality?: string;
  intent?: string;
  totalDurationMs: number;
  totalEstimatedCostUsd: number;
  statuses: WhatsappOperationalTraceStatus[];
  steps: WhatsappOperationalTraceStep[];
};

type StartWhatsappOperationalTraceInput = {
  userId: number;
  messageText?: string | null;
  messageId?: string | null;
  eventId?: string | null;
  inputModality?: string | null;
  createdAt?: Date;
};

type ListWhatsappOperationalTracesFilter = {
  userId?: number;
  stage?: WhatsappOperationalTraceStage;
  status?: WhatsappOperationalTraceStatus;
  intent?: string;
  modelName?: string;
  hasError?: boolean;
};

const MAX_TRACE_ENTRIES = 500;
const traces: WhatsappOperationalTrace[] = [];
let nextTraceId = 1;

function hashMessage(value?: string | null) {
  return createHash("sha256").update(value?.trim().toLowerCase() || "").digest("hex");
}

function clampDuration(value: number) {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function estimateCostUsd(input: { modelName?: string; inputChars?: number | null; outputChars?: number | null }) {
  if (!input.modelName) return 0;
  const totalChars = Math.max(0, Number(input.inputChars || 0) + Number(input.outputChars || 0));
  if (!totalChars) return 0;
  const estimatedTokens = Math.ceil(totalChars / 4);
  const lowerModel = input.modelName.toLowerCase();
  const perMillionTokens = lowerModel.includes("mini") ? 0.15 : 2;
  return Number(((estimatedTokens / 1_000_000) * perMillionTokens).toFixed(8));
}

export function startWhatsappOperationalTrace(input: StartWhatsappOperationalTraceInput) {
  const createdAt = input.createdAt ?? new Date();
  const trace: WhatsappOperationalTrace = {
    id: nextTraceId,
    traceId: `whatsapp-trace-${nextTraceId}`,
    createdAt: createdAt.toISOString(),
    userId: input.userId,
    channel: "whatsapp",
    messageHash: hashMessage(input.messageText),
    ...(input.messageId ? { messageId: input.messageId } : {}),
    ...(input.eventId ? { eventId: input.eventId } : {}),
    ...(input.inputModality ? { inputModality: input.inputModality } : {}),
    totalDurationMs: 0,
    totalEstimatedCostUsd: 0,
    statuses: [],
    steps: [],
  };
  nextTraceId += 1;
  traces.push(trace);
  if (traces.length > MAX_TRACE_ENTRIES) {
    traces.splice(0, traces.length - MAX_TRACE_ENTRIES);
  }
  return trace;
}

export function recordWhatsappOperationalTraceStep(
  trace: WhatsappOperationalTrace | null | undefined,
  step: Omit<WhatsappOperationalTraceStep, "durationMs" | "estimatedCostUsd"> & {
    durationMs?: number;
    estimatedCostUsd?: number;
    inputChars?: number | null;
    outputChars?: number | null;
  },
) {
  if (!trace) return null;
  const nextStep: WhatsappOperationalTraceStep = {
    stage: step.stage,
    status: step.status,
    durationMs: clampDuration(step.durationMs ?? 0),
    ...(step.modelName ? { modelName: step.modelName } : {}),
    ...(step.schemaVersion ? { schemaVersion: step.schemaVersion } : {}),
    ...(step.ruleVersion ? { ruleVersion: step.ruleVersion } : {}),
    ...(step.processingStrategy ? { processingStrategy: step.processingStrategy } : {}),
    ...(step.intent ? { intent: step.intent } : {}),
    ...(step.toolNames?.length ? { toolNames: [...new Set(step.toolNames)] } : {}),
    ...(step.fallbackReason ? { fallbackReason: step.fallbackReason } : {}),
    ...(step.errorCode ? { errorCode: step.errorCode } : {}),
    ...(typeof step.retryCount === "number" ? { retryCount: step.retryCount } : {}),
    estimatedCostUsd: step.estimatedCostUsd ?? estimateCostUsd(step),
    ...(step.metadata ? { metadata: step.metadata } : {}),
  };

  trace.steps.push(nextStep);
  trace.totalDurationMs = trace.steps.reduce((total, current) => total + current.durationMs, 0);
  trace.totalEstimatedCostUsd = Number(trace.steps.reduce((total, current) => total + Number(current.estimatedCostUsd || 0), 0).toFixed(8));
  trace.statuses = [...new Set(trace.steps.map(current => current.status))];
  if (nextStep.intent) {
    trace.intent = nextStep.intent;
  }
  if (step.stage === "normalization" && step.metadata?.inputModality) {
    trace.inputModality = String(step.metadata.inputModality);
  }
  return nextStep;
}

export function listWhatsappOperationalTraces(filter: ListWhatsappOperationalTracesFilter = {}) {
  return traces.filter(trace => {
    if (typeof filter.userId === "number" && trace.userId !== filter.userId) return false;
    if (filter.intent && trace.intent !== filter.intent) return false;
    if (filter.stage && !trace.steps.some(step => step.stage === filter.stage)) return false;
    if (filter.status && !trace.statuses.includes(filter.status)) return false;
    if (filter.modelName && !trace.steps.some(step => step.modelName === filter.modelName)) return false;
    if (filter.hasError && !trace.steps.some(step => step.status === "error" || step.status === "timeout" || step.errorCode)) return false;
    return true;
  });
}

export function summarizeWhatsappOperationalTraces(filter: ListWhatsappOperationalTracesFilter = {}) {
  const selected = listWhatsappOperationalTraces(filter);
  const byStage = new Map<WhatsappOperationalTraceStage, { count: number; totalDurationMs: number; errors: number; totalEstimatedCostUsd: number }>();
  for (const trace of selected) {
    for (const step of trace.steps) {
      const current = byStage.get(step.stage) ?? { count: 0, totalDurationMs: 0, errors: 0, totalEstimatedCostUsd: 0 };
      current.count += 1;
      current.totalDurationMs += step.durationMs;
      current.totalEstimatedCostUsd += Number(step.estimatedCostUsd || 0);
      if (step.status === "error" || step.status === "timeout" || step.errorCode) current.errors += 1;
      byStage.set(step.stage, current);
    }
  }

  return {
    traceCount: selected.length,
    totalDurationMs: selected.reduce((total, trace) => total + trace.totalDurationMs, 0),
    totalEstimatedCostUsd: Number(selected.reduce((total, trace) => trace.totalEstimatedCostUsd + total, 0).toFixed(8)),
    byStage: Object.fromEntries([...byStage.entries()].map(([stage, value]) => [stage, {
      count: value.count,
      avgDurationMs: value.count ? Math.round(value.totalDurationMs / value.count) : 0,
      errors: value.errors,
      totalEstimatedCostUsd: Number(value.totalEstimatedCostUsd.toFixed(8)),
    }])),
  };
}

export function __resetWhatsappOperationalTracesForTests() {
  traces.length = 0;
  nextTraceId = 1;
}
