import { createHash } from "node:crypto";
import {
  buildAiLearningPrivacyRecord,
  sanitizeSampleForLearning,
  type AiLearningPrivacyRecord,
} from "../aiLearningPrivacy";
import type { WhatsappFeedbackEntry } from "./feedbackLoop";
import type { WhatsappIntentName } from "./intentSchema";
import type { WhatsappMessageHistoryEntry } from "./messageHistory";

export type WhatsappReviewQueueItemType =
  | "ambiguous_message"
  | "low_confidence_decision"
  | "interpretation_failure"
  | "unresolved_food_or_brand"
  | "nutrition_source_issue"
  | "classification_pending"
  | "correction_signal"
  | "negative_feedback"
  | "nutrition_divergence"
  | "regression_candidate";

export type WhatsappReviewQueueOrigin =
  | "message_history"
  | "feedback"
  | "nutrition_source"
  | "classification"
  | "offline_replay"
  | "support"
  | "manual";

export type WhatsappReviewQueueStatus =
  | "open"
  | "in_review"
  | "approved"
  | "rejected"
  | "needs_more_info"
  | "converted"
  | "closed";

export type WhatsappReviewQueuePriority = "low" | "medium" | "high" | "critical";

export type WhatsappReviewQueueImpact = "low" | "medium" | "high" | "critical";

export type WhatsappReviewDecisionResult =
  | "candidate_knowledge"
  | "regression_fixture"
  | "curated_classification"
  | "curated_nutrition_source"
  | "candidate_rule"
  | "no_change";

export type WhatsappReviewQueueItem = {
  id: number;
  createdAt: string;
  updatedAt: string;
  type: WhatsappReviewQueueItemType;
  origin: WhatsappReviewQueueOrigin;
  status: WhatsappReviewQueueStatus;
  priority: WhatsappReviewQueuePriority;
  impact: WhatsappReviewQueueImpact;
  confidence: number | null;
  userId: number | null;
  intent: WhatsappIntentName | "unknown" | null;
  title: string;
  reason: string;
  sanitizedSample: string | null;
  fingerprint: string;
  occurrences: number;
  links: {
    historyId: number | null;
    feedbackId: number | null;
    sourceId: string | number | null;
    foodName: string | null;
    brand: string | null;
    classification: string | null;
  };
  review: {
    reviewer: string | null;
    mechanism: "admin" | "curator" | "nutritionist" | "technical" | "automated" | null;
    decidedAt: string | null;
    decision: WhatsappReviewDecisionResult | null;
    justification: string | null;
  };
  conversion: {
    convertedAt: string | null;
    outputType: WhatsappReviewDecisionResult | null;
    payload: Record<string, unknown> | null;
    globalPromotion: {
      allowed: false;
      requiresVersioning: true;
      reason: string;
    };
  };
  privacy: AiLearningPrivacyRecord;
};

type RecordWhatsappReviewQueueItemInput = {
  type: WhatsappReviewQueueItemType;
  origin: WhatsappReviewQueueOrigin;
  title: string;
  reason: string;
  sampleText?: string | null;
  confidence?: number | null;
  userId?: number | null;
  intent?: WhatsappIntentName | "unknown" | null;
  priority?: WhatsappReviewQueuePriority;
  impact?: WhatsappReviewQueueImpact;
  links?: Partial<WhatsappReviewQueueItem["links"]>;
  createdAt?: Date;
};

type ListWhatsappReviewQueueFilter = {
  type?: WhatsappReviewQueueItemType;
  origin?: WhatsappReviewQueueOrigin;
  status?: WhatsappReviewQueueStatus;
  priority?: WhatsappReviewQueuePriority;
  impact?: WhatsappReviewQueueImpact;
  intent?: WhatsappIntentName | "unknown";
  userId?: number;
  minConfidence?: number;
  maxConfidence?: number;
  from?: Date | string;
  to?: Date | string;
};

const MAX_REVIEW_QUEUE_ITEMS = 1_000;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const REVIEW_QUEUE_POLICY_VERSION = "whatsapp-review-queue/v1";
const entries: WhatsappReviewQueueItem[] = [];
let nextReviewId = 1;

export const WHATSAPP_REVIEW_QUEUE_VERSION = REVIEW_QUEUE_POLICY_VERSION;

function toIso(value?: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toTime(value?: Date | string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function hashValue(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function clampConfidence(value?: number | null) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function priorityRank(priority: WhatsappReviewQueuePriority) {
  return { low: 1, medium: 2, high: 3, critical: 4 }[priority];
}

function maxPriority(a: WhatsappReviewQueuePriority, b: WhatsappReviewQueuePriority) {
  return priorityRank(a) >= priorityRank(b) ? a : b;
}

function inferPriority(input: Pick<RecordWhatsappReviewQueueItemInput, "type" | "confidence" | "impact">): WhatsappReviewQueuePriority {
  if (input.impact === "critical") return "critical";
  if (input.type === "nutrition_divergence" || input.type === "interpretation_failure") return "high";
  if ((input.confidence ?? 1) < 0.35) return "high";
  if (input.type === "correction_signal" || input.type === "negative_feedback") return "medium";
  return "low";
}

function inferImpact(input: Pick<RecordWhatsappReviewQueueItemInput, "type" | "confidence">): WhatsappReviewQueueImpact {
  if (input.type === "nutrition_divergence" || input.type === "nutrition_source_issue") return "high";
  if (input.type === "correction_signal" || input.type === "interpretation_failure") return "high";
  if ((input.confidence ?? 1) < 0.35) return "medium";
  return "low";
}

function buildFingerprint(input: RecordWhatsappReviewQueueItemInput, sanitizedSample: string | null) {
  return hashValue(JSON.stringify({
    type: input.type,
    origin: input.origin,
    userId: input.userId ?? null,
    intent: input.intent ?? null,
    links: input.links ?? {},
    sample: sanitizedSample,
  }));
}

function buildPrivacy(createdAt: string) {
  return buildAiLearningPrivacyRecord({
    kind: "audit_event",
    purpose: "audit",
    origin: "whatsapp-review-queue",
    createdAt,
  });
}

function sanitizeSample(input: RecordWhatsappReviewQueueItemInput, createdAt: string) {
  if (!input.sampleText) return null;
  return sanitizeSampleForLearning({
    kind: "audit_event",
    purpose: "audit",
    text: input.sampleText,
    origin: "whatsapp-review-queue",
    createdAt,
  }).text;
}

function pruneQueue() {
  if (entries.length > MAX_REVIEW_QUEUE_ITEMS) {
    entries.splice(0, entries.length - MAX_REVIEW_QUEUE_ITEMS);
  }
}

function defaultConversion() {
  return {
    convertedAt: null,
    outputType: null,
    payload: null,
    globalPromotion: {
      allowed: false,
      requiresVersioning: true,
      reason: "Revisao aprovada gera saida candidata, mas promocao global exige versionamento, gates e fluxo de promocao.",
    },
  } satisfies WhatsappReviewQueueItem["conversion"];
}

export function recordWhatsappReviewQueueItem(input: RecordWhatsappReviewQueueItemInput) {
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const sanitizedSample = sanitizeSample(input, createdAt);
  const confidence = clampConfidence(input.confidence);
  const impact = input.impact ?? inferImpact({ type: input.type, confidence });
  const priority = input.priority ?? inferPriority({ type: input.type, confidence, impact });
  const fingerprint = buildFingerprint(input, sanitizedSample);
  const existing = entries.find(entry => entry.fingerprint === fingerprint && !["converted", "closed", "rejected"].includes(entry.status));

  if (existing) {
    existing.occurrences += 1;
    existing.priority = maxPriority(existing.priority, priority);
    existing.impact = priorityRank(priority) > priorityRank(existing.priority) ? impact : existing.impact;
    existing.updatedAt = createdAt;
    return existing;
  }

  const entry: WhatsappReviewQueueItem = {
    id: nextReviewId,
    createdAt,
    updatedAt: createdAt,
    type: input.type,
    origin: input.origin,
    status: "open",
    priority,
    impact,
    confidence,
    userId: input.userId ?? null,
    intent: input.intent ?? null,
    title: input.title,
    reason: input.reason,
    sanitizedSample,
    fingerprint,
    occurrences: 1,
    links: {
      historyId: input.links?.historyId ?? null,
      feedbackId: input.links?.feedbackId ?? null,
      sourceId: input.links?.sourceId ?? null,
      foodName: input.links?.foodName ?? null,
      brand: input.links?.brand ?? null,
      classification: input.links?.classification ?? null,
    },
    review: {
      reviewer: null,
      mechanism: null,
      decidedAt: null,
      decision: null,
      justification: null,
    },
    conversion: defaultConversion(),
    privacy: buildPrivacy(createdAt),
  };

  nextReviewId += 1;
  entries.push(entry);
  pruneQueue();
  return entry;
}

export function enqueueWhatsappReviewFromHistory(history: WhatsappMessageHistoryEntry) {
  if (history.status === "ambiguous") {
    return recordWhatsappReviewQueueItem({
      type: "ambiguous_message",
      origin: "message_history",
      title: "Mensagem ambigua aguardando revisao",
      reason: history.statusReason ?? "Mensagem sem intencao clara.",
      sampleText: history.sanitizedContent,
      confidence: history.confidence,
      userId: history.userId,
      intent: history.intent,
      links: { historyId: history.id },
      createdAt: new Date(history.createdAt),
    });
  }

  if (history.status === "low_confidence" || (history.confidence ?? 1) < LOW_CONFIDENCE_THRESHOLD) {
    return recordWhatsappReviewQueueItem({
      type: "low_confidence_decision",
      origin: "message_history",
      title: "Decisao de baixa confianca aguardando revisao",
      reason: history.statusReason ?? "Confianca abaixo do limiar operacional.",
      sampleText: history.sanitizedContent,
      confidence: history.confidence,
      userId: history.userId,
      intent: history.intent,
      links: { historyId: history.id, foodName: history.entities.foods[0] ?? null, brand: history.entities.brands[0] ?? null },
      createdAt: new Date(history.createdAt),
    });
  }

  if (history.status === "error") {
    return recordWhatsappReviewQueueItem({
      type: "interpretation_failure",
      origin: "message_history",
      title: "Falha de interpretacao aguardando revisao tecnica",
      reason: history.statusReason ?? "Erro no pipeline de interpretacao.",
      sampleText: history.sanitizedContent,
      confidence: history.confidence,
      userId: history.userId,
      intent: history.intent,
      priority: "high",
      links: { historyId: history.id },
      createdAt: new Date(history.createdAt),
    });
  }

  if (history.entities.foods.length > 0 && (!history.nutritionSource || history.nutritionSource.confidence === null || (history.nutritionSource.confidence ?? 0) < 0.6)) {
    return recordWhatsappReviewQueueItem({
      type: "nutrition_source_issue",
      origin: "nutrition_source",
      title: "Fonte nutricional ausente ou fraca",
      reason: "Registro alimentar sem fonte nutricional confiavel.",
      sampleText: history.sanitizedContent,
      confidence: history.nutritionSource?.confidence ?? history.confidence,
      userId: history.userId,
      intent: history.intent,
      links: {
        historyId: history.id,
        sourceId: history.nutritionSource?.sourceId ?? null,
        foodName: history.entities.foods[0] ?? null,
        brand: history.entities.brands[0] ?? null,
      },
      createdAt: new Date(history.createdAt),
    });
  }

  return null;
}

export function enqueueWhatsappReviewFromFeedback(feedback: WhatsappFeedbackEntry) {
  if (feedback.status === "blocked") return null;
  if (feedback.kind === "correction") {
    return recordWhatsappReviewQueueItem({
      type: "correction_signal",
      origin: "feedback",
      title: "Correcao posterior indica possivel erro da IA",
      reason: feedback.reason,
      sampleText: feedback.sanitizedFeedback,
      confidence: feedback.confidence,
      userId: feedback.userId,
      intent: feedback.targetIntent,
      priority: "high",
      links: { historyId: feedback.targetHistoryId, feedbackId: feedback.id },
      createdAt: new Date(feedback.createdAt),
    });
  }

  if (feedback.kind === "negative") {
    return recordWhatsappReviewQueueItem({
      type: "negative_feedback",
      origin: "feedback",
      title: "Feedback negativo aguardando analise",
      reason: feedback.reason,
      sampleText: feedback.sanitizedFeedback,
      confidence: feedback.confidence,
      userId: feedback.userId,
      intent: feedback.targetIntent,
      links: { historyId: feedback.targetHistoryId, feedbackId: feedback.id },
      createdAt: new Date(feedback.createdAt),
    });
  }

  return null;
}

export function recordNutritionReviewQueueItem(input: {
  foodName: string;
  brand?: string | null;
  sourceId?: string | number | null;
  confidence?: number | null;
  reason: string;
  createdAt?: Date;
}) {
  return recordWhatsappReviewQueueItem({
    type: "unresolved_food_or_brand",
    origin: "nutrition_source",
    title: "Alimento, produto ou marca nao resolvido",
    reason: input.reason,
    confidence: input.confidence ?? null,
    links: { foodName: input.foodName, brand: input.brand ?? null, sourceId: input.sourceId ?? null },
    createdAt: input.createdAt,
  });
}

export function listWhatsappReviewQueue(filter: ListWhatsappReviewQueueFilter = {}) {
  const from = toTime(filter.from);
  const to = toTime(filter.to);
  return entries.filter(entry => {
    const createdAt = new Date(entry.createdAt).getTime();
    if (filter.type && entry.type !== filter.type) return false;
    if (filter.origin && entry.origin !== filter.origin) return false;
    if (filter.status && entry.status !== filter.status) return false;
    if (filter.priority && entry.priority !== filter.priority) return false;
    if (filter.impact && entry.impact !== filter.impact) return false;
    if (filter.intent && entry.intent !== filter.intent) return false;
    if (filter.userId !== undefined && entry.userId !== filter.userId) return false;
    if (filter.minConfidence !== undefined && (entry.confidence ?? -1) < filter.minConfidence) return false;
    if (filter.maxConfidence !== undefined && (entry.confidence ?? 2) > filter.maxConfidence) return false;
    if (from !== null && createdAt < from) return false;
    if (to !== null && createdAt > to) return false;
    return true;
  });
}

export function transitionWhatsappReviewQueueItem(input: {
  itemId: number;
  status: WhatsappReviewQueueStatus;
  reviewer?: string | null;
  mechanism?: WhatsappReviewQueueItem["review"]["mechanism"];
  decision?: WhatsappReviewDecisionResult | null;
  justification: string;
  decidedAt?: Date;
}) {
  const entry = entries.find(item => item.id === input.itemId);
  if (!entry) return null;
  const decidedAt = (input.decidedAt ?? new Date()).toISOString();
  entry.status = input.status;
  entry.updatedAt = decidedAt;
  entry.review = {
    reviewer: input.reviewer ?? entry.review.reviewer,
    mechanism: input.mechanism ?? entry.review.mechanism,
    decidedAt,
    decision: input.decision ?? entry.review.decision,
    justification: input.justification,
  };
  return entry;
}

export function convertApprovedWhatsappReviewQueueItem(input: {
  itemId: number;
  outputType: Exclude<WhatsappReviewDecisionResult, "no_change">;
  payload: Record<string, unknown>;
  convertedAt?: Date;
}) {
  const entry = entries.find(item => item.id === input.itemId);
  if (!entry || entry.status !== "approved") return null;
  const convertedAt = (input.convertedAt ?? new Date()).toISOString();
  entry.status = "converted";
  entry.updatedAt = convertedAt;
  entry.conversion = {
    convertedAt,
    outputType: input.outputType,
    payload: {
      ...input.payload,
      sourceReviewQueueItemId: entry.id,
      sourceFingerprint: entry.fingerprint,
    },
    globalPromotion: defaultConversion().globalPromotion,
  };
  return entry;
}

export function __resetWhatsappReviewQueueForTests() {
  entries.length = 0;
  nextReviewId = 1;
}
