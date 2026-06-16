import { sanitizeSampleForLearning, type SanitizedLearningSample } from "../aiLearningPrivacy";

export const WHATSAPP_STRUCTURED_HISTORY_VERSION = "whatsapp-structured-history-v1";

export type WhatsappHistoryInputType = "text" | "audio" | "image" | "caption" | "multi_turn" | "mixed";
export type WhatsappHistoryStatus = "success" | "ambiguous" | "low_confidence" | "error" | "ignored" | "blocked" | "pending";

export type WhatsappHistoryToolCall = {
  name: string;
  status: "success" | "error" | "timeout" | "fallback";
  summary: string;
  durationMs?: number;
};

export type WhatsappStructuredHistoryRecord = {
  messageId: string;
  idempotencyKey: string | null;
  userId: number;
  channel: "whatsapp";
  phoneRef: string | null;
  receivedAt: string;
  processedAt: string | null;
  inputType: WhatsappHistoryInputType;
  privacy: SanitizedLearningSample;
  normalizedInput: string | null;
  pendingContext: Record<string, unknown> | null;
  intent: string | null;
  confidence: number | null;
  entities: Record<string, unknown>;
  calculation: Record<string, unknown> | null;
  nutritionSource: Record<string, unknown> | null;
  versions: Record<string, string>;
  tools: WhatsappHistoryToolCall[];
  action: string | null;
  persisted: Record<string, unknown> | null;
  reply: string | null;
  status: WhatsappHistoryStatus;
  statusReason: string;
  duplicateOfMessageId: string | null;
  linkedMessageId: string | null;
  feedbackIds: string[];
  reprocessIds: string[];
  historyVersion: typeof WHATSAPP_STRUCTURED_HISTORY_VERSION;
};

export type WhatsappHistoryFilter = {
  intent?: string;
  status?: WhatsappHistoryStatus;
  minConfidence?: number;
  maxConfidence?: number;
  inputType?: WhatsappHistoryInputType;
  from?: string;
  to?: string;
  versionKey?: string;
  versionValue?: string;
};

function clampConfidence(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return null;
  return Math.max(0, Math.min(1, Number(value)));
}

export function createWhatsappStructuredHistoryRecord(input: {
  messageId: string;
  idempotencyKey?: string | null;
  userId: number;
  phoneRef?: string | null;
  receivedAt: string;
  inputType: WhatsappHistoryInputType;
  rawText?: string | null;
  transcript?: string | null;
  caption?: string | null;
  normalizedInput?: string | null;
  pendingContext?: Record<string, unknown> | null;
  versions?: Record<string, string>;
  duplicateOfMessageId?: string | null;
}): WhatsappStructuredHistoryRecord {
  const rawText = [input.rawText, input.transcript, input.caption].filter(Boolean).join("\n") || null;
  const privacy = sanitizeSampleForLearning({
    kind: input.inputType === "audio" ? "transcript" : "raw_message",
    purpose: "audit",
    text: rawText,
    origin: "whatsapp",
    createdAt: input.receivedAt,
  });

  return {
    messageId: input.messageId,
    idempotencyKey: input.idempotencyKey ?? null,
    userId: input.userId,
    channel: "whatsapp",
    phoneRef: input.phoneRef ?? null,
    receivedAt: input.receivedAt,
    processedAt: null,
    inputType: input.inputType,
    privacy,
    normalizedInput: input.normalizedInput ?? null,
    pendingContext: input.pendingContext ?? null,
    intent: null,
    confidence: null,
    entities: {},
    calculation: null,
    nutritionSource: null,
    versions: input.versions ?? {},
    tools: [],
    action: null,
    persisted: null,
    reply: null,
    status: input.duplicateOfMessageId ? "ignored" : "pending",
    statusReason: input.duplicateOfMessageId ? "duplicate_message" : "received",
    duplicateOfMessageId: input.duplicateOfMessageId ?? null,
    linkedMessageId: null,
    feedbackIds: [],
    reprocessIds: [],
    historyVersion: WHATSAPP_STRUCTURED_HISTORY_VERSION,
  };
}

export function completeWhatsappStructuredHistoryRecord(
  record: WhatsappStructuredHistoryRecord,
  update: {
    processedAt: string;
    intent?: string | null;
    confidence?: number | null;
    entities?: Record<string, unknown>;
    calculation?: Record<string, unknown> | null;
    nutritionSource?: Record<string, unknown> | null;
    versions?: Record<string, string>;
    tools?: WhatsappHistoryToolCall[];
    action?: string | null;
    persisted?: Record<string, unknown> | null;
    reply?: string | null;
    status: WhatsappHistoryStatus;
    statusReason: string;
  },
): WhatsappStructuredHistoryRecord {
  return {
    ...record,
    processedAt: update.processedAt,
    intent: update.intent ?? record.intent,
    confidence: clampConfidence(update.confidence ?? record.confidence),
    entities: update.entities ?? record.entities,
    calculation: update.calculation ?? record.calculation,
    nutritionSource: update.nutritionSource ?? record.nutritionSource,
    versions: { ...record.versions, ...(update.versions ?? {}) },
    tools: update.tools ?? record.tools,
    action: update.action ?? record.action,
    persisted: update.persisted ?? record.persisted,
    reply: update.reply ?? record.reply,
    status: update.status,
    statusReason: update.statusReason,
  };
}

export function linkWhatsappHistoryFollowUp(
  record: WhatsappStructuredHistoryRecord,
  input: { linkedMessageId?: string; feedbackId?: string; reprocessId?: string },
): WhatsappStructuredHistoryRecord {
  return {
    ...record,
    linkedMessageId: input.linkedMessageId ?? record.linkedMessageId,
    feedbackIds: input.feedbackId ? [...record.feedbackIds, input.feedbackId] : record.feedbackIds,
    reprocessIds: input.reprocessId ? [...record.reprocessIds, input.reprocessId] : record.reprocessIds,
  };
}

export function filterWhatsappStructuredHistory(records: WhatsappStructuredHistoryRecord[], filter: WhatsappHistoryFilter) {
  const from = filter.from ? new Date(filter.from).getTime() : null;
  const to = filter.to ? new Date(filter.to).getTime() : null;

  return records.filter(record => {
    const receivedAt = new Date(record.receivedAt).getTime();
    if (filter.intent && record.intent !== filter.intent) return false;
    if (filter.status && record.status !== filter.status) return false;
    if (filter.inputType && record.inputType !== filter.inputType) return false;
    if (filter.minConfidence !== undefined && (record.confidence ?? -1) < filter.minConfidence) return false;
    if (filter.maxConfidence !== undefined && (record.confidence ?? 2) > filter.maxConfidence) return false;
    if (from !== null && receivedAt < from) return false;
    if (to !== null && receivedAt > to) return false;
    if (filter.versionKey && record.versions[filter.versionKey] !== filter.versionValue) return false;
    return true;
  });
}

export function assertHistoryBeforeSensitivePersistence(record: WhatsappStructuredHistoryRecord) {
  if (record.status === "pending" || !record.processedAt) {
    throw new Error("Historico estruturado deve registrar a decisao antes de persistencia sensivel.");
  }
  return true;
}