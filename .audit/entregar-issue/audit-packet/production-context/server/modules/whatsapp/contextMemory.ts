import { createHash } from "node:crypto";
import {
  buildAiLearningPrivacyRecord,
  sanitizeSampleForLearning,
  type AiLearningPrivacyRecord,
} from "../aiLearningPrivacy";
import type { WhatsappFeedbackEntry } from "./feedbackLoop";
import type { WhatsappIntentName } from "./intentSchema";

export type WhatsappContextMemoryKind =
  | "individual_preference"
  | "individual_alias"
  | "recurring_correction"
  | "validated_source"
  | "global_alias"
  | "global_rule"
  | "candidate_knowledge";

export type WhatsappContextMemoryScope = "individual" | "candidate_global" | "global";

export type WhatsappContextMemoryStatus = "active" | "inactive" | "replaced" | "expired" | "needs_review";

export type WhatsappContextMemorySource = {
  feedbackId?: number | null;
  historyId?: number | null;
  ruleVersion?: string | null;
  sourceType: "feedback" | "review" | "validated_source" | "global_rule" | "manual";
};

export type WhatsappContextMemoryEntry = {
  id: number;
  createdAt: string;
  updatedAt: string;
  userId: number | null;
  scope: WhatsappContextMemoryScope;
  kind: WhatsappContextMemoryKind;
  status: WhatsappContextMemoryStatus;
  key: string;
  keyHash: string;
  value: string;
  valueHash: string;
  confidence: number;
  priority: number;
  appliesToIntents: Array<WhatsappIntentName | "unknown">;
  source: WhatsappContextMemorySource;
  replacesMemoryId: number | null;
  replacedByMemoryId: number | null;
  expiresAt: string | null;
  disabledReason: string | null;
  privacy: AiLearningPrivacyRecord;
};

export type WhatsappMemoryRetrievalConflict = {
  winningMemoryId: number;
  suppressedMemoryId: number;
  key: string;
  reason: string;
};

export type WhatsappMemoryRetrievalContext = {
  contextVersion: typeof WHATSAPP_CONTEXT_MEMORY_VERSION;
  userId: number;
  intent: WhatsappIntentName | "unknown" | null;
  createdAt: string;
  maxItems: number;
  maxContextChars: number;
  memories: WhatsappContextMemoryEntry[];
  llmContext: Array<{
    id: number;
    kind: WhatsappContextMemoryKind;
    scope: WhatsappContextMemoryScope;
    key: string;
    value: string;
    confidence: number;
  }>;
  audit: {
    consultedMemoryIds: number[];
    consultedRuleIds: number[];
    consultedSourceIds: number[];
    omittedMemoryIds: number[];
    conflicts: WhatsappMemoryRetrievalConflict[];
  };
};

export type WhatsappMemoryUsageEntry = {
  id: number;
  createdAt: string;
  userId: number;
  historyId: number | null;
  intent: WhatsappIntentName | "unknown" | null;
  contextVersion: typeof WHATSAPP_CONTEXT_MEMORY_VERSION;
  consultedMemoryIds: number[];
  consultedRuleIds: number[];
  consultedSourceIds: number[];
  omittedMemoryIds: number[];
  conflicts: WhatsappMemoryRetrievalConflict[];
};

type RecordWhatsappContextMemoryInput = {
  userId?: number | null;
  scope: WhatsappContextMemoryScope;
  kind: WhatsappContextMemoryKind;
  key: string;
  value: string;
  confidence?: number;
  priority?: number;
  appliesToIntents?: Array<WhatsappIntentName | "unknown">;
  source?: Partial<WhatsappContextMemorySource>;
  replacesMemoryId?: number | null;
  expiresAt?: Date | string | null;
  status?: WhatsappContextMemoryStatus;
  createdAt?: Date;
};

type RetrieveWhatsappContextMemoryInput = {
  userId: number;
  intent?: WhatsappIntentName | "unknown" | null;
  text?: string | null;
  maxItems?: number;
  maxContextChars?: number;
  now?: Date;
};

const MAX_MEMORY_ENTRIES = 1_000;
const DEFAULT_MAX_CONTEXT_ITEMS = 6;
const DEFAULT_MAX_CONTEXT_CHARS = 900;
const DEFAULT_MEMORY_TTL_DAYS = 180;
const memoryEntries: WhatsappContextMemoryEntry[] = [];
const usageEntries: WhatsappMemoryUsageEntry[] = [];
let nextMemoryId = 1;
let nextUsageId = 1;

export const WHATSAPP_CONTEXT_MEMORY_VERSION = "whatsapp-context-memory/v1";

function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function addDays(createdAt: string, days: number) {
  const date = new Date(createdAt);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function hashValue(value: string) {
  return createHash("sha256").update(normalize(value)).digest("hex");
}

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function defaultPriority(input: Pick<RecordWhatsappContextMemoryInput, "scope" | "kind">) {
  if (input.scope === "individual") return 100;
  if (input.kind === "validated_source") return 80;
  if (input.scope === "global") return 60;
  return 20;
}

function defaultStatus(input: Pick<RecordWhatsappContextMemoryInput, "scope">) {
  return input.scope === "candidate_global" ? "needs_review" : "active";
}

function buildPrivacy(input: {
  scope: WhatsappContextMemoryScope;
  kind: WhatsappContextMemoryKind;
  createdAt: string;
}) {
  return buildAiLearningPrivacyRecord({
    kind: input.scope === "global" ? "candidate_rule" : "structured_decision",
    purpose: input.scope === "global" ? "global_learning" : "individual_learning",
    origin: "whatsapp-context-memory",
    createdAt: input.createdAt,
    scope: input.scope === "global" ? "global" : "user",
  });
}

function sanitizeMemoryValue(input: RecordWhatsappContextMemoryInput, createdAt: string) {
  const sample = sanitizeSampleForLearning({
    kind: input.scope === "global" ? "candidate_rule" : "structured_decision",
    purpose: input.scope === "global" ? "global_learning" : "individual_learning",
    text: input.value,
    origin: "whatsapp-context-memory",
    createdAt,
  });
  return sample.text ?? "";
}

function pruneMemory() {
  if (memoryEntries.length > MAX_MEMORY_ENTRIES) {
    memoryEntries.splice(0, memoryEntries.length - MAX_MEMORY_ENTRIES);
  }
}

function isExpired(entry: WhatsappContextMemoryEntry, now: Date) {
  return Boolean(entry.expiresAt && new Date(entry.expiresAt).getTime() <= now.getTime());
}

function isIntentRelevant(entry: WhatsappContextMemoryEntry, intent?: WhatsappIntentName | "unknown" | null) {
  return !intent || entry.appliesToIntents.length === 0 || entry.appliesToIntents.includes(intent);
}

function isTextRelevant(entry: WhatsappContextMemoryEntry, text?: string | null) {
  if (!text) return true;
  const normalizedText = normalize(text);
  if (!entry.key) return true;
  return normalizedText.includes(normalize(entry.key)) || normalize(entry.key).includes(normalizedText);
}

function conflictKey(entry: WhatsappContextMemoryEntry) {
  return `${entry.kind}:${entry.keyHash}`;
}

function rankMemory(entry: WhatsappContextMemoryEntry) {
  const scopeBoost = entry.scope === "individual" ? 1_000 : entry.scope === "global" ? 100 : 0;
  return scopeBoost + entry.priority + entry.confidence;
}

function classifyMemoryIds(entries: WhatsappContextMemoryEntry[]) {
  return {
    consultedMemoryIds: entries
      .filter(entry => entry.scope === "individual" || entry.scope === "candidate_global")
      .map(entry => entry.id),
    consultedRuleIds: entries
      .filter(entry => entry.kind === "global_rule" || entry.kind === "global_alias")
      .map(entry => entry.id),
    consultedSourceIds: entries
      .filter(entry => entry.kind === "validated_source")
      .map(entry => entry.id),
  };
}

function buildLimitedContext(entries: WhatsappContextMemoryEntry[], maxContextChars: number) {
  const context: WhatsappMemoryRetrievalContext["llmContext"] = [];
  let usedChars = 0;

  for (const entry of entries) {
    const item = {
      id: entry.id,
      kind: entry.kind,
      scope: entry.scope,
      key: entry.key,
      value: entry.value,
      confidence: entry.confidence,
    };
    const size = JSON.stringify(item).length;
    if (usedChars + size > maxContextChars) break;
    usedChars += size;
    context.push(item);
  }

  return context;
}

export function recordWhatsappContextMemory(input: RecordWhatsappContextMemoryInput) {
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const expiresAt = input.expiresAt === null
    ? null
    : toIso(input.expiresAt) ?? (input.scope === "global" ? null : addDays(createdAt, DEFAULT_MEMORY_TTL_DAYS));
  const sanitizedValue = sanitizeMemoryValue(input, createdAt);
  const memoryId = nextMemoryId;

  if (input.replacesMemoryId) {
    const replaced = memoryEntries.find(entry => entry.id === input.replacesMemoryId);
    if (replaced) {
      replaced.status = "replaced";
      replaced.replacedByMemoryId = memoryId;
      replaced.updatedAt = createdAt;
    }
  }

  const entry: WhatsappContextMemoryEntry = {
    id: memoryId,
    createdAt,
    updatedAt: createdAt,
    userId: input.scope === "individual" ? input.userId ?? null : null,
    scope: input.scope,
    kind: input.kind,
    status: input.status ?? defaultStatus(input),
    key: input.key.trim(),
    keyHash: hashValue(input.key),
    value: sanitizedValue,
    valueHash: hashValue(sanitizedValue),
    confidence: clampConfidence(input.confidence ?? 0.7),
    priority: input.priority ?? defaultPriority(input),
    appliesToIntents: input.appliesToIntents ?? [],
    source: {
      sourceType: input.source?.sourceType ?? "manual",
      feedbackId: input.source?.feedbackId ?? null,
      historyId: input.source?.historyId ?? null,
      ruleVersion: input.source?.ruleVersion ?? WHATSAPP_CONTEXT_MEMORY_VERSION,
    },
    replacesMemoryId: input.replacesMemoryId ?? null,
    replacedByMemoryId: null,
    expiresAt,
    disabledReason: null,
    privacy: buildPrivacy({ scope: input.scope, kind: input.kind, createdAt }),
  };

  nextMemoryId += 1;
  memoryEntries.push(entry);
  pruneMemory();
  return entry;
}

export function recordWhatsappMemoryFromFeedback(feedback: WhatsappFeedbackEntry) {
  if (feedback.status === "blocked" || feedback.generatedMemory.kind === "none") return null;

  const generated = feedback.generatedMemory;
  const source: WhatsappContextMemorySource = {
    sourceType: "feedback",
    feedbackId: feedback.id,
    historyId: generated.sourceHistoryId,
    ruleVersion: WHATSAPP_CONTEXT_MEMORY_VERSION,
  };

  if (generated.kind === "alias") {
    return recordWhatsappContextMemory({
      userId: feedback.userId,
      scope: "individual",
      kind: "individual_alias",
      key: generated.key ?? feedback.sanitizedFeedback,
      value: generated.value ?? feedback.sanitizedFeedback,
      confidence: generated.confidence,
      source,
      appliesToIntents: feedback.targetIntent ? [feedback.targetIntent] : [],
      createdAt: new Date(feedback.createdAt),
    });
  }

  if (generated.kind === "preference" || generated.kind === "recurring_instruction") {
    return recordWhatsappContextMemory({
      userId: feedback.userId,
      scope: "individual",
      kind: generated.kind === "preference" ? "individual_preference" : "recurring_correction",
      key: generated.key ?? generated.kind,
      value: generated.value ?? feedback.sanitizedFeedback,
      confidence: generated.confidence,
      source,
      appliesToIntents: feedback.targetIntent ? [feedback.targetIntent] : [],
      createdAt: new Date(feedback.createdAt),
    });
  }

  if (generated.kind === "correction_signal") {
    return recordWhatsappContextMemory({
      scope: "candidate_global",
      kind: "candidate_knowledge",
      key: generated.key ?? "correction",
      value: generated.value ?? feedback.sanitizedFeedback,
      confidence: generated.confidence,
      source,
      appliesToIntents: feedback.targetIntent ? [feedback.targetIntent] : [],
      status: "needs_review",
      createdAt: new Date(feedback.createdAt),
    });
  }

  return null;
}

export function deactivateWhatsappContextMemory(input: { memoryId: number; reason: string; now?: Date }) {
  const entry = memoryEntries.find(memory => memory.id === input.memoryId);
  if (!entry) return null;
  entry.status = "inactive";
  entry.disabledReason = input.reason;
  entry.updatedAt = (input.now ?? new Date()).toISOString();
  return entry;
}

export function listWhatsappContextMemories(filter: {
  userId?: number;
  scope?: WhatsappContextMemoryScope;
  kind?: WhatsappContextMemoryKind;
  status?: WhatsappContextMemoryStatus;
} = {}) {
  return memoryEntries.filter(entry => {
    if (filter.userId !== undefined && entry.userId !== filter.userId) return false;
    if (filter.scope && entry.scope !== filter.scope) return false;
    if (filter.kind && entry.kind !== filter.kind) return false;
    if (filter.status && entry.status !== filter.status) return false;
    return true;
  });
}

export function retrieveWhatsappContextMemory(input: RetrieveWhatsappContextMemoryInput): WhatsappMemoryRetrievalContext {
  const now = input.now ?? new Date();
  const maxItems = input.maxItems ?? DEFAULT_MAX_CONTEXT_ITEMS;
  const maxContextChars = input.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const candidates = memoryEntries.filter(entry => {
    if (entry.status !== "active") return false;
    if (entry.scope === "individual" && entry.userId !== input.userId) return false;
    if (isExpired(entry, now)) return false;
    if (!isIntentRelevant(entry, input.intent)) return false;
    if (!isTextRelevant(entry, input.text)) return false;
    return true;
  });

  const winners = new Map<string, WhatsappContextMemoryEntry>();
  const conflicts: WhatsappMemoryRetrievalConflict[] = [];

  for (const entry of [...candidates].sort((a, b) => rankMemory(b) - rankMemory(a))) {
    const key = conflictKey(entry);
    const existing = winners.get(key);
    if (!existing) {
      winners.set(key, entry);
      continue;
    }

    conflicts.push({
      winningMemoryId: existing.id,
      suppressedMemoryId: entry.id,
      key: entry.key,
      reason: existing.scope === "individual" && entry.scope === "global"
        ? "Memoria individual tem prioridade sobre regra global generica."
        : "Memoria com maior prioridade, escopo ou confianca foi selecionada.",
    });
  }

  const selected = [...winners.values()]
    .sort((a, b) => rankMemory(b) - rankMemory(a))
    .slice(0, maxItems);
  const selectedIds = new Set(selected.map(entry => entry.id));
  const omittedMemoryIds = candidates
    .filter(entry => !selectedIds.has(entry.id))
    .map(entry => entry.id);
  const ids = classifyMemoryIds(selected);

  return {
    contextVersion: WHATSAPP_CONTEXT_MEMORY_VERSION,
    userId: input.userId,
    intent: input.intent ?? null,
    createdAt: now.toISOString(),
    maxItems,
    maxContextChars,
    memories: selected,
    llmContext: buildLimitedContext(selected, maxContextChars),
    audit: {
      ...ids,
      omittedMemoryIds,
      conflicts,
    },
  };
}

export function recordWhatsappMemoryUsage(input: {
  userId: number;
  historyId?: number | null;
  intent?: WhatsappIntentName | "unknown" | null;
  retrieval: WhatsappMemoryRetrievalContext;
  createdAt?: Date;
}) {
  const entry: WhatsappMemoryUsageEntry = {
    id: nextUsageId,
    createdAt: (input.createdAt ?? new Date()).toISOString(),
    userId: input.userId,
    historyId: input.historyId ?? null,
    intent: input.intent ?? input.retrieval.intent,
    contextVersion: input.retrieval.contextVersion,
    consultedMemoryIds: [...input.retrieval.audit.consultedMemoryIds],
    consultedRuleIds: [...input.retrieval.audit.consultedRuleIds],
    consultedSourceIds: [...input.retrieval.audit.consultedSourceIds],
    omittedMemoryIds: [...input.retrieval.audit.omittedMemoryIds],
    conflicts: [...input.retrieval.audit.conflicts],
  };

  nextUsageId += 1;
  usageEntries.push(entry);
  return entry;
}

export function listWhatsappMemoryUsage() {
  return [...usageEntries];
}

export function __resetWhatsappContextMemoryForTests() {
  memoryEntries.length = 0;
  usageEntries.length = 0;
  nextMemoryId = 1;
  nextUsageId = 1;
}
