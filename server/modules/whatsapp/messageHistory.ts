import { createHash } from "node:crypto";
import {
  buildAiLearningPrivacyRecord,
  sanitizeSampleForLearning,
  type AiLearningPrivacyRecord,
  type AiLearningPurpose,
} from "../aiLearningPrivacy";
import type { WhatsappAiToolTrace } from "./aiToolContract";
import type { WhatsappIntentName, WhatsappInterpretedIntent } from "./intentSchema";
import type { WhatsappIntentOperationalTrace, WhatsappIntentValidationStatus } from "./intentAuditLog";
import {
  listPersistedWhatsappLearningArtifacts,
  persistWhatsappLearningArtifact,
} from "./learningArtifactPersistence";

export type WhatsappMessageHistoryInputType =
  | "text"
  | "audio_transcript"
  | "image_caption"
  | "media_reference"
  | "multimodal"
  | "multi_turn"
  | "unknown";

export type WhatsappMessageHistoryStatus =
  | "success"
  | "ambiguous"
  | "low_confidence"
  | "error"
  | "ignored"
  | "blocked"
  | "pending"
  | "duplicate";

export type WhatsappMessageItemObservation = {
  itemIndex: number;
  foodName: string;
  brand: string | null;
  variant: string | null;
  quantity: number | null;
  unit: string | null;
  portion: string | null;
  nutritionSource: string | null;
  nutritionEstimated: boolean | null;
  confidence: number | null;
  ambiguous: boolean;
  corrected: boolean;
  fallback: boolean;
  fallbackSafe: boolean | null;
  brandEvidence: "text" | "transcription" | "ocr" | "vision" | "memory" | "unknown";
  variantEvidence: "text" | "transcription" | "ocr" | "vision" | "memory" | "unknown";
  quantityEvidence: "text" | "transcription" | "ocr" | "vision" | "memory" | "unknown";
};

export type WhatsappMessageHistoryPurpose = "operation" | "audit" | "individual_learning" | "global_learning";

export type WhatsappMessageHistoryEntry = {
  id: number;
  createdAt: string;
  receivedAt: string;
  processedAt: string;
  userId: number | null;
  channel: "whatsapp";
  inputType: WhatsappMessageHistoryInputType;
  messageHash: string;
  messageIdHash: string | null;
  idempotencyKeyHash: string | null;
  phoneHash: string | null;
  rawContentStored: boolean;
  rawContent: string | null;
  sanitizedContent: string | null;
  normalizedInput: string | null;
  pendingContext: {
    kind: string;
    active: boolean;
    referenceId?: string | number | null;
  } | null;
  intent: WhatsappIntentName | "unknown";
  confidence: number | null;
  validationStatus: WhatsappIntentValidationStatus | null;
  entities: {
    hasDate: boolean;
    hasMeal: boolean;
    itemCount: number;
    hasSourceFood: boolean;
    hasTargetFood: boolean;
    hasQuantity: boolean;
    foods: string[];
    brands: string[];
    variants?: string[];
    quantity: { value: number; unit: string } | null;
    mealLabel: string | null;
    date: string | null;
  };
  itemObservations?: WhatsappMessageItemObservation[];
  calculation: {
    expression: string;
    result: number | null;
    unit: string | null;
  } | null;
  nutritionSource: {
    sourceId?: string | number | null;
    sourceType?: string | null;
    confidence?: number | null;
    estimated?: boolean | null;
  } | null;
  versions: {
    contextVersion: string | null;
    schemaVersion: string | null;
    promptVersion: string | null;
    ruleVersion: string | null;
    modelName: string | null;
    parserVersion: string | null;
  };
  strategy: WhatsappIntentOperationalTrace["strategy"] | null;
  toolTrace: WhatsappAiToolTrace[];
  action: string;
  persisted: {
    happened: boolean;
    kind: "meal" | "water" | "weight" | "context" | "none" | "unknown";
    ids: Array<string | number>;
  };
  reply: {
    kind: "executed" | "clarification" | "fallback" | "none";
    text: string | null;
  };
  status: WhatsappMessageHistoryStatus;
  statusReason: string | null;
  linkedHistoryId: number | null;
  correctionOfHistoryId: number | null;
  purposes: Record<WhatsappMessageHistoryPurpose, AiLearningPrivacyRecord>;
  learningAllowed: boolean;
};

type RecordWhatsappMessageHistoryInput = {
  userId?: number | null;
  messageText?: string | null;
  normalizedInput?: string | null;
  messageId?: string | null;
  idempotencyKey?: string | null;
  phoneNumber?: string | null;
  inputType?: WhatsappMessageHistoryInputType;
  receivedAt?: Date;
  processedAt?: Date;
  pendingContext?: WhatsappMessageHistoryEntry["pendingContext"];
  intent?: WhatsappInterpretedIntent | null;
  validationStatus?: WhatsappIntentValidationStatus | null;
  operationalTrace?: Partial<WhatsappIntentOperationalTrace>;
  toolTrace?: WhatsappAiToolTrace[];
  action?: string;
  replyKind?: WhatsappMessageHistoryEntry["reply"]["kind"];
  replyText?: string | null;
  status?: WhatsappMessageHistoryStatus;
  statusReason?: string | null;
  fallbackReason?: string | null;
  errorCode?: string | null;
  calculation?: WhatsappMessageHistoryEntry["calculation"];
  nutritionSource?: WhatsappMessageHistoryEntry["nutritionSource"];
  persisted?: Partial<WhatsappMessageHistoryEntry["persisted"]>;
  linkedHistoryId?: number | null;
  correctionOfHistoryId?: number | null;
  itemObservations?: WhatsappMessageItemObservation[];
  fallbackSafe?: boolean | null;
  allowRawContentStorage?: boolean;
  createdAt?: Date;
};

type ListWhatsappMessageHistoryFilter = {
  userId?: number;
  intent?: WhatsappIntentName | "unknown";
  status?: WhatsappMessageHistoryStatus;
  inputType?: WhatsappMessageHistoryInputType;
  hasError?: boolean;
  lowConfidence?: boolean;
  minConfidence?: number;
  maxConfidence?: number;
  version?: string;
  toolId?: string;
  from?: Date | string;
  to?: Date | string;
  linkedHistoryId?: number;
  correctionOfHistoryId?: number;
  learningAllowed?: boolean;
};

const MAX_MESSAGE_HISTORY_ENTRIES = 1_000;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const MESSAGE_HISTORY_SCHEMA_VERSION = "whatsapp-message-history/v1";
const MESSAGE_HISTORY_RULE_VERSION = "whatsapp-history-policy/v1";
const entries: WhatsappMessageHistoryEntry[] = [];
let nextHistoryId = 1;

function hashValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function toIso(value?: Date) {
  return (value ?? new Date()).toISOString();
}

function toTime(value?: Date | string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function clampConfidence(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

function buildMessageHash(input: RecordWhatsappMessageHistoryInput) {
  if (input.messageText) return hashValue(input.messageText);
  return hashValue(`${input.userId ?? "unknown"}:${input.messageId ?? nextHistoryId}`);
}

function buildSanitizedContent(input: RecordWhatsappMessageHistoryInput, createdAt: string) {
  if (!input.messageText) {
    return { rawContentStored: false, rawContent: null, sanitizedContent: null };
  }

  const sample = sanitizeSampleForLearning({
    kind: input.inputType === "audio_transcript" ? "transcript" : "raw_message",
    purpose: "operation",
    text: input.messageText,
    origin: "whatsapp-message-history",
    createdAt,
  });
  const rawContentStored = Boolean(input.allowRawContentStorage && sample.metadata.rawTextAllowed && !sample.metadata.anonymizationRequired);

  return {
    rawContentStored,
    rawContent: rawContentStored ? input.messageText : null,
    sanitizedContent: sample.text,
  };
}

function buildPrivacyPurposes(createdAt: string): WhatsappMessageHistoryEntry["purposes"] {
  const build = (purpose: AiLearningPurpose) => buildAiLearningPrivacyRecord({
    kind: purpose === "audit" ? "audit_event" : "structured_decision",
    purpose,
    origin: "whatsapp-message-history",
    createdAt,
    scope: purpose === "global_learning" ? "global" : "user",
  });

  return {
    operation: build("operation"),
    audit: build("audit"),
    individual_learning: build("individual_learning"),
    global_learning: build("global_learning"),
  };
}

function buildEntities(intent?: WhatsappInterpretedIntent | null): WhatsappMessageHistoryEntry["entities"] {
  return {
    hasDate: Boolean(intent?.date),
    hasMeal: Boolean(intent?.meal?.label),
    itemCount: intent?.items.length ?? 0,
    hasSourceFood: Boolean(intent?.sourceFood),
    hasTargetFood: Boolean(intent?.targetFood),
    hasQuantity: Boolean(intent?.quantity),
    foods: intent?.items.map(item => item.foodName).filter(Boolean) ?? [],
    brands: intent?.items.map(item => item.brand).filter((brand): brand is string => Boolean(brand)) ?? [],
    variants: intent?.items.map(item => item.variant).filter((variant): variant is string => Boolean(variant)) ?? [],
    quantity: intent?.quantity ? { value: intent.quantity.value, unit: intent.quantity.unit } : null,
    mealLabel: intent?.meal?.label ?? null,
    date: intent?.date ?? null,
  };
}

function evidenceFor(inputType: WhatsappMessageHistoryInputType, value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "unknown" as const;
  if (inputType === "audio_transcript") return "transcription" as const;
  if (inputType === "image_caption") return "ocr" as const;
  if (inputType === "multimodal") return "vision" as const;
  return "text" as const;
}

function buildItemObservations(input: RecordWhatsappMessageHistoryInput): WhatsappMessageItemObservation[] {
  if (input.itemObservations) return input.itemObservations.map(item => ({ ...item }));
  const intent = input.intent;
  if (!intent?.items.length) return [];
  const inputType = input.inputType ?? "text";
  const fallback = Boolean(input.replyKind === "fallback" || input.action?.includes("fallback") || input.fallbackReason === "fallback");
  return intent.items.map((item, itemIndex) => ({
    itemIndex,
    foodName: item.foodName,
    brand: item.brand ?? null,
    variant: item.variant ?? null,
    quantity: item.quantity ?? null,
    unit: item.unit ?? null,
    portion: item.unit && item.quantity ? `${item.quantity} ${item.unit}` : null,
    nutritionSource: input.nutritionSource?.sourceType ?? null,
    nutritionEstimated: input.nutritionSource?.estimated ?? null,
    confidence: clampConfidence(intent.confidence),
    ambiguous: input.status === "ambiguous" || input.replyKind === "clarification" || Boolean(intent.requiresConfirmation),
    corrected: input.correctionOfHistoryId !== undefined && input.correctionOfHistoryId !== null,
    fallback,
    fallbackSafe: input.fallbackSafe ?? null,
    brandEvidence: evidenceFor(inputType, item.brand),
    variantEvidence: evidenceFor(inputType, item.variant),
    quantityEvidence: evidenceFor(inputType, item.quantity),
  }));
}

function hasPersistentTool(toolTrace: WhatsappAiToolTrace[]) {
  return toolTrace.some(trace => (
    trace.decision === "allowed"
    && (trace.kind === "write" || trace.kind === "correction" || trace.kind === "removal")
    && trace.outcome === "success"
  ));
}

function inferPersisted(input: RecordWhatsappMessageHistoryInput): WhatsappMessageHistoryEntry["persisted"] {
  return {
    happened: input.persisted?.happened ?? hasPersistentTool(input.toolTrace ?? []),
    kind: input.persisted?.kind ?? (hasPersistentTool(input.toolTrace ?? []) ? "meal" : "none"),
    ids: input.persisted?.ids ?? [],
  };
}

function inferStatus(input: RecordWhatsappMessageHistoryInput, confidence: number | null): WhatsappMessageHistoryStatus {
  if (input.status) return input.status;
  if (input.fallbackReason === "security_guard") return "blocked";
  if (input.errorCode || input.validationStatus === "invalid_json" || input.validationStatus === "invalid_payload") return "error";
  if (input.fallbackReason === "low_confidence" || (confidence !== null && confidence < LOW_CONFIDENCE_THRESHOLD)) return "low_confidence";
  if (input.replyKind === "clarification") return "ambiguous";
  if (input.action?.includes("duplicate")) return "duplicate";
  if (input.action?.includes("fallback")) return "pending";
  if (!input.action || input.action === "none") return "ignored";
  return "success";
}

function matchesVersion(entry: WhatsappMessageHistoryEntry, version: string) {
  return entry.versions.contextVersion === version
    || entry.versions.schemaVersion === version
    || entry.versions.promptVersion === version
    || entry.versions.ruleVersion === version
    || entry.versions.parserVersion === version
    || entry.versions.modelName === version
    || entry.toolTrace.some(trace => trace.version === version);
}

function pruneHistory() {
  if (entries.length > MAX_MESSAGE_HISTORY_ENTRIES) {
    entries.splice(0, entries.length - MAX_MESSAGE_HISTORY_ENTRIES);
  }
}

export function recordWhatsappMessageHistory(input: RecordWhatsappMessageHistoryInput) {
  const createdAt = toIso(input.createdAt);
  const receivedAt = toIso(input.receivedAt ?? input.createdAt);
  const processedAt = toIso(input.processedAt ?? input.createdAt);
  const confidence = clampConfidence(input.intent?.confidence);
  const toolTrace = input.toolTrace ?? [];
  const privacy = buildPrivacyPurposes(createdAt);
  const content = buildSanitizedContent(input, createdAt);
  const status = inferStatus(input, confidence);

  const entry: WhatsappMessageHistoryEntry = {
    id: nextHistoryId,
    createdAt,
    receivedAt,
    processedAt,
    userId: input.userId ?? null,
    channel: "whatsapp",
    inputType: input.inputType ?? "text",
    messageHash: buildMessageHash(input),
    messageIdHash: input.messageId ? hashValue(input.messageId) : null,
    idempotencyKeyHash: input.idempotencyKey ? hashValue(input.idempotencyKey) : null,
    phoneHash: input.phoneNumber ? hashValue(input.phoneNumber) : null,
    ...content,
    normalizedInput: input.normalizedInput ?? null,
    pendingContext: input.pendingContext ?? null,
    intent: input.intent?.intent ?? "unknown",
    confidence,
    validationStatus: input.validationStatus ?? null,
    entities: buildEntities(input.intent),
    itemObservations: buildItemObservations(input),
    calculation: input.calculation ?? null,
    nutritionSource: input.nutritionSource ?? null,
    versions: {
      contextVersion: null,
      schemaVersion: MESSAGE_HISTORY_SCHEMA_VERSION,
      promptVersion: null,
      ruleVersion: MESSAGE_HISTORY_RULE_VERSION,
      modelName: input.operationalTrace?.modelName ?? null,
      parserVersion: input.operationalTrace?.strategy ? `whatsapp-${input.operationalTrace.strategy}` : null,
    },
    strategy: input.operationalTrace?.strategy ?? null,
    toolTrace,
    action: input.action ?? "none",
    persisted: inferPersisted({ ...input, toolTrace }),
    reply: {
      kind: input.replyKind ?? "none",
      text: input.replyText ?? null,
    },
    status,
    statusReason: input.statusReason ?? input.errorCode ?? input.fallbackReason ?? null,
    linkedHistoryId: input.linkedHistoryId ?? null,
    correctionOfHistoryId: input.correctionOfHistoryId ?? null,
    purposes: privacy,
    learningAllowed: privacy.global_learning.globalPromotionAllowed && !content.rawContentStored,
  };

  nextHistoryId += 1;
  entries.push(entry);
  pruneHistory();
  void persistWhatsappMessageHistoryEntry(entry);
  return entry;
}

export async function persistWhatsappMessageHistoryEntry(entry: WhatsappMessageHistoryEntry) {
  return persistWhatsappLearningArtifact({
    scope: entry.userId === null ? "global" : "user",
    userId: entry.userId,
    kind: "message_history",
    key: `history:${entry.id}`,
    value: entry,
    createdAt: new Date(entry.createdAt),
  });
}

export async function recordWhatsappMessageHistoryDurably(input: RecordWhatsappMessageHistoryInput) {
  const entry = recordWhatsappMessageHistory(input);
  const persisted = await persistWhatsappMessageHistoryEntry(entry);
  return { entry, persisted: Boolean(persisted) };
}

export async function loadPersistedWhatsappMessageHistory(userId: number): Promise<WhatsappMessageHistoryEntry[] | null> {
  const artifacts = await listPersistedWhatsappLearningArtifacts<WhatsappMessageHistoryEntry>({
    scope: "user",
    userId,
    kind: "message_history",
  });
  if (artifacts === null) return null;
  return artifacts
    .map(artifact => artifact.value)
    .filter((entry): entry is WhatsappMessageHistoryEntry => Boolean(entry && typeof entry.id === "number"))
    .sort((a, b) => a.id - b.id);
}

export function hydrateWhatsappMessageHistory(entriesToHydrate: WhatsappMessageHistoryEntry[]) {
  const knownIds = new Set(entries.map(entry => entry.id));
  for (const entry of entriesToHydrate) {
    if (!knownIds.has(entry.id)) entries.push(entry);
  }
  entries.sort((a, b) => a.id - b.id);
  nextHistoryId = Math.max(nextHistoryId, (entries.at(-1)?.id ?? 0) + 1);
  pruneHistory();
}

export function listWhatsappMessageHistory(filter: ListWhatsappMessageHistoryFilter = {}) {
  const from = toTime(filter.from);
  const to = toTime(filter.to);
  return entries.filter(entry => {
    const createdAt = new Date(entry.createdAt).getTime();
    if (filter.userId !== undefined && entry.userId !== filter.userId) return false;
    if (filter.intent && entry.intent !== filter.intent) return false;
    if (filter.status && entry.status !== filter.status) return false;
    if (filter.inputType && entry.inputType !== filter.inputType) return false;
    if (typeof filter.hasError === "boolean" && (entry.status === "error") !== filter.hasError) return false;
    if (filter.lowConfidence && entry.status !== "low_confidence") return false;
    if (filter.minConfidence !== undefined && (entry.confidence ?? -1) < filter.minConfidence) return false;
    if (filter.maxConfidence !== undefined && (entry.confidence ?? 2) > filter.maxConfidence) return false;
    if (filter.version && !matchesVersion(entry, filter.version)) return false;
    if (filter.toolId && !entry.toolTrace.some(trace => trace.toolId === filter.toolId)) return false;
    if (filter.linkedHistoryId !== undefined && entry.linkedHistoryId !== filter.linkedHistoryId) return false;
    if (filter.correctionOfHistoryId !== undefined && entry.correctionOfHistoryId !== filter.correctionOfHistoryId) return false;
    if (typeof filter.learningAllowed === "boolean" && entry.learningAllowed !== filter.learningAllowed) return false;
    if (from !== null && createdAt < from) return false;
    if (to !== null && createdAt > to) return false;
    return true;
  });
}

export function linkWhatsappMessageHistory(input: {
  sourceHistoryId: number;
  action: "feedback" | "correction" | "reprocess";
  targetHistoryId?: number | null;
}) {
  const source = entries.find(entry => entry.id === input.sourceHistoryId);
  if (!source) return null;
  const target = input.targetHistoryId ? entries.find(entry => entry.id === input.targetHistoryId) : null;
  if (input.action === "correction") {
    source.correctionOfHistoryId = target?.id ?? input.targetHistoryId ?? null;
  } else {
    source.linkedHistoryId = target?.id ?? input.targetHistoryId ?? null;
  }
  return source;
}

export function __resetWhatsappMessageHistoryForTests() {
  entries.length = 0;
  nextHistoryId = 1;
}
