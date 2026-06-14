import { createHash } from "node:crypto";
import type { WhatsappAutonomyLevel, WhatsappAutonomyOutcome } from "./autonomyPolicy";
import type { WhatsappIntentName, WhatsappInterpretedIntent } from "./intentSchema";

export type WhatsappIntentValidationStatus = "valid" | "invalid_json" | "invalid_payload" | "skipped";

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
  validationStatus: WhatsappIntentValidationStatus;
  action: string;
  replyKind: "executed" | "clarification" | "fallback" | "none";
  processingStrategy?: string;
  durationMs?: number;
  modelName?: string;
  toolNames?: string[];
  autonomyLevel?: WhatsappAutonomyLevel;
  autonomyOutcome?: WhatsappAutonomyOutcome;
  autonomyReason?: string;
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
  processingStrategy?: string;
  durationMs?: number;
  modelName?: string;
  toolNames?: string[];
  autonomyLevel?: WhatsappAutonomyLevel;
  autonomyOutcome?: WhatsappAutonomyOutcome;
  autonomyReason?: string;
  fallbackReason?: string;
  errorCode?: string;
  createdAt?: Date;
};

type ListWhatsappIntentAuditLogsFilter = {
  intent?: WhatsappIntentName;
  hasError?: boolean;
  lowConfidence?: boolean;
  fallbackReason?: string;
  processingStrategy?: string;
  toolName?: string;
  autonomyLevel?: WhatsappAutonomyLevel;
  autonomyOutcome?: WhatsappAutonomyOutcome;
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
    validationStatus: input.validationStatus,
    action: input.action,
    replyKind: input.replyKind,
    ...(input.processingStrategy ? { processingStrategy: input.processingStrategy } : {}),
    ...(typeof input.durationMs === "number" ? { durationMs: Math.max(0, Math.round(input.durationMs)) } : {}),
    ...(input.modelName ? { modelName: input.modelName } : {}),
    ...(input.toolNames?.length ? { toolNames: [...new Set(input.toolNames)] } : {}),
    ...(input.autonomyLevel ? { autonomyLevel: input.autonomyLevel } : {}),
    ...(input.autonomyOutcome ? { autonomyOutcome: input.autonomyOutcome } : {}),
    ...(input.autonomyReason ? { autonomyReason: input.autonomyReason } : {}),
    ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
    ...(input.errorCode ? { errorCode: input.errorCode } : {}),
  };

  nextEntryId += 1;
  entries.push(entry);
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
    if (filter.processingStrategy && entry.processingStrategy !== filter.processingStrategy) return false;
    if (filter.toolName && !entry.toolNames?.includes(filter.toolName)) return false;
    if (filter.autonomyLevel && entry.autonomyLevel !== filter.autonomyLevel) return false;
    if (filter.autonomyOutcome && entry.autonomyOutcome !== filter.autonomyOutcome) return false;
    return true;
  });
}

export function __resetWhatsappIntentAuditLogsForTests() {
  entries.length = 0;
  nextEntryId = 1;
}
