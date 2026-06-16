import { createHash } from "node:crypto";
import type { WhatsappAiToolId, WhatsappAiToolTrace } from "./aiToolContract";
import type { WhatsappIntentName, WhatsappInterpretedIntent } from "./intentSchema";
import { recordWhatsappPipelineTrace, type WhatsappPipelineTraceSpan } from "./operationalObservability";

export type WhatsappIntentValidationStatus = "valid" | "invalid_json" | "invalid_payload" | "skipped";

export type WhatsappIntentProcessingStrategy = "deterministic" | "llm_structured" | "safe_fallback";

export type WhatsappIntentOperationalTrace = {
  strategy: WhatsappIntentProcessingStrategy;
  modelName: string | null;
  latencyMs: number;
  estimatedCostUnits: number;
  fallbackReason?: string;
};

export type WhatsappIntentAuditLogEntry = {
  id: number;
  createdAt: string;
  userId: number;
  channel: "whatsapp";
  messageHash: string;
  contextVersion: string;
  intent: WhatsappIntentName;
  confidence: number;
  payloadSummary: {
    hasDate: boolean;
    hasMeal: boolean;
    itemCount: number;
    hasSourceFood: boolean;
    hasTargetFood: boolean;
    hasQuantity: boolean;
    requiresConfirmation: boolean;
    possibleIntents: WhatsappIntentName[];
  };
  operationalTrace: WhatsappIntentOperationalTrace;
  toolTrace: WhatsappAiToolTrace[];
  validationStatus: WhatsappIntentValidationStatus;
  action: string;
  replyKind: "executed" | "clarification" | "fallback" | "none";
  fallbackReason?: string;
  errorCode?: string;
};

type RecordWhatsappIntentAuditLogInput = {
  userId: number;
  messageText: string;
  contextVersion?: string;
  intent: WhatsappInterpretedIntent;
  validationStatus: WhatsappIntentValidationStatus;
  action: string;
  replyKind: WhatsappIntentAuditLogEntry["replyKind"];
  operationalTrace?: Partial<WhatsappIntentOperationalTrace>;
  toolTrace?: WhatsappAiToolTrace[];
  fallbackReason?: string;
  errorCode?: string;
  createdAt?: Date;
};

type ListWhatsappIntentAuditLogsFilter = {
  intent?: WhatsappIntentName;
  hasError?: boolean;
  lowConfidence?: boolean;
  fallbackReason?: string;
  strategy?: WhatsappIntentProcessingStrategy;
  toolId?: WhatsappAiToolId;
};

const MAX_AUDIT_LOG_ENTRIES = 500;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const entries: WhatsappIntentAuditLogEntry[] = [];
let nextEntryId = 1;

function hashMessage(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function buildPayloadSummary(intent: WhatsappInterpretedIntent): WhatsappIntentAuditLogEntry["payloadSummary"] {
  return {
    hasDate: Boolean(intent.date),
    hasMeal: Boolean(intent.meal?.label),
    itemCount: intent.items.length,
    hasSourceFood: Boolean(intent.sourceFood),
    hasTargetFood: Boolean(intent.targetFood),
    hasQuantity: Boolean(intent.quantity),
    requiresConfirmation: intent.requiresConfirmation,
    possibleIntents: [...intent.possibleIntents],
  };
}

function buildOperationalTrace(input: RecordWhatsappIntentAuditLogInput): WhatsappIntentOperationalTrace {
  return {
    strategy: input.operationalTrace?.strategy ?? "deterministic",
    modelName: input.operationalTrace?.modelName ?? null,
    latencyMs: Math.max(0, Math.round(input.operationalTrace?.latencyMs ?? 0)),
    estimatedCostUnits: Math.max(0, Number(input.operationalTrace?.estimatedCostUnits ?? 0)),
    ...(input.operationalTrace?.fallbackReason || input.fallbackReason
      ? { fallbackReason: input.operationalTrace?.fallbackReason ?? input.fallbackReason }
      : {}),
  };
}

function buildValidationSpan(entry: WhatsappIntentAuditLogEntry): WhatsappPipelineTraceSpan {
  const schemaFailed = entry.validationStatus === "invalid_json" || entry.validationStatus === "invalid_payload";
  const backendFailed = entry.fallbackReason === "backend_validation_failed" || Boolean(entry.errorCode && entry.validationStatus === "valid");
  const failed = schemaFailed || backendFailed;
  return {
    stage: "validation",
    outcome: entry.validationStatus === "skipped" ? "skipped" : failed ? "failure" : "success",
    latencyMs: 0,
    estimatedCostUnits: 0,
    retryCount: 0,
    modelName: null,
    version: "whatsapp-intent-output/v1",
    toolId: null,
    ...(failed ? { errorCode: schemaFailed ? entry.validationStatus : entry.errorCode ?? entry.validationStatus } : {}),
    ...(backendFailed && entry.fallbackReason ? { fallbackReason: entry.fallbackReason } : {}),
  };
}

function buildLlmOutcome(entry: WhatsappIntentAuditLogEntry): WhatsappPipelineTraceSpan["outcome"] {
  if (entry.operationalTrace.fallbackReason === "timeout") return "timeout";
  if (entry.validationStatus === "invalid_json" || entry.validationStatus === "invalid_payload") return "failure";
  if (entry.errorCode && entry.operationalTrace.strategy === "safe_fallback") return "failure";
  if (entry.operationalTrace.fallbackReason) return "fallback";
  return "success";
}

function buildPipelineSpans(entry: WhatsappIntentAuditLogEntry): WhatsappPipelineTraceSpan[] {
  const spans: WhatsappPipelineTraceSpan[] = [{
    stage: "router",
    outcome: entry.operationalTrace.strategy === "safe_fallback" ? "fallback" : "success",
    latencyMs: entry.operationalTrace.modelName ? 0 : entry.operationalTrace.latencyMs,
    estimatedCostUnits: 0,
    retryCount: 0,
    modelName: null,
    version: entry.contextVersion,
    toolId: null,
    ...(entry.operationalTrace.fallbackReason ? { fallbackReason: entry.operationalTrace.fallbackReason } : {}),
  }];

  if (entry.operationalTrace.modelName) {
    spans.push({
      stage: "llm",
      outcome: buildLlmOutcome(entry),
      latencyMs: entry.operationalTrace.latencyMs,
      estimatedCostUnits: entry.operationalTrace.estimatedCostUnits,
      retryCount: Math.max(0, Math.round(entry.operationalTrace.estimatedCostUnits) - 1),
      modelName: entry.operationalTrace.modelName,
      version: "whatsapp-llm-intent/v1",
      toolId: null,
      ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
      ...(entry.operationalTrace.fallbackReason ? { fallbackReason: entry.operationalTrace.fallbackReason } : {}),
    });
  }

  spans.push(buildValidationSpan(entry));

  for (const trace of entry.toolTrace) {
    const toolSpan: WhatsappPipelineTraceSpan = {
      stage: "tools",
      outcome: trace.outcome,
      latencyMs: 0,
      estimatedCostUnits: 0,
      retryCount: 0,
      modelName: null,
      version: trace.version,
      toolId: trace.toolId,
      ...(trace.failureReason ? { errorCode: trace.failureReason } : {}),
    };
    spans.push(toolSpan);

    if (trace.kind === "write" || trace.kind === "correction" || trace.kind === "removal") {
      spans.push({
        ...toolSpan,
        stage: "persistence",
      });
    }
  }

  return spans;
}

function recordOperationalPipelineTrace(entry: WhatsappIntentAuditLogEntry) {
  recordWhatsappPipelineTrace({
    traceId: `intent-audit-${entry.id}`,
    userId: entry.userId,
    channel: entry.channel,
    messageHash: entry.messageHash,
    createdAt: new Date(entry.createdAt),
    intent: entry.intent,
    contextVersion: entry.contextVersion,
    schemaVersion: "whatsapp-intent-output/v1",
    promptVersion: "whatsapp-prompt/v1",
    ruleVersion: entry.contextVersion,
    strategy: entry.operationalTrace.strategy,
    modelName: entry.operationalTrace.modelName,
    spans: buildPipelineSpans(entry),
  });
}

export function recordWhatsappIntentAuditLog(input: RecordWhatsappIntentAuditLogInput) {
  const entry: WhatsappIntentAuditLogEntry = {
    id: nextEntryId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    userId: input.userId,
    channel: "whatsapp",
    messageHash: hashMessage(input.messageText),
    contextVersion: input.contextVersion ?? "whatsapp-intent-v1",
    intent: input.intent.intent,
    confidence: input.intent.confidence,
    payloadSummary: buildPayloadSummary(input.intent),
    operationalTrace: buildOperationalTrace(input),
    toolTrace: input.toolTrace ?? [],
    validationStatus: input.validationStatus,
    action: input.action,
    replyKind: input.replyKind,
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };

  nextEntryId += 1;
  entries.push(entry);
  recordOperationalPipelineTrace(entry);
  if (entries.length > MAX_AUDIT_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_AUDIT_LOG_ENTRIES);
  }
  return entry;
}

export function listWhatsappIntentAuditLogs(filter: ListWhatsappIntentAuditLogsFilter = {}) {
  return entries.filter(entry => {
    if (filter.intent && entry.intent !== filter.intent) return false;
    if (typeof filter.hasError === "boolean") {
      const hasError = Boolean(entry.errorCode || entry.validationStatus === "invalid_json" || entry.validationStatus === "invalid_payload");
      if (hasError !== filter.hasError) return false;
    }
    if (filter.lowConfidence && entry.confidence >= LOW_CONFIDENCE_THRESHOLD) return false;
    if (filter.fallbackReason && entry.fallbackReason !== filter.fallbackReason) return false;
    if (filter.strategy && entry.operationalTrace.strategy !== filter.strategy) return false;
    if (filter.toolId && !entry.toolTrace.some(trace => trace.toolId === filter.toolId)) return false;
    return true;
  });
}

export function __resetWhatsappIntentAuditLogsForTests() {
  entries.length = 0;
  nextEntryId = 1;
}
