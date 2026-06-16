import {
  buildAiLearningPrivacyRecord,
  sanitizeSampleForLearning,
  type AiLearningPrivacyRecord,
} from "../aiLearningPrivacy";
import type { WhatsappIntentName } from "./intentSchema";
import {
  linkWhatsappMessageHistory,
  listWhatsappMessageHistory,
  type WhatsappMessageHistoryEntry,
} from "./messageHistory";

export type WhatsappFeedbackKind =
  | "positive"
  | "negative"
  | "correction"
  | "preference"
  | "personal_alias"
  | "recurring_instruction";

export type WhatsappFeedbackScope = "individual" | "global_candidate" | "review_required" | "blocked";

export type WhatsappFeedbackStatus = "recorded" | "needs_review" | "blocked";

export type WhatsappFeedbackEntry = {
  id: number;
  createdAt: string;
  userId: number;
  channel: "whatsapp";
  feedbackHash: string;
  sanitizedFeedback: string;
  kind: WhatsappFeedbackKind;
  confidence: number;
  scope: WhatsappFeedbackScope;
  status: WhatsappFeedbackStatus;
  reason: string;
  targetHistoryId: number | null;
  targetIntent: WhatsappIntentName | "unknown" | null;
  targetAction: string | null;
  generatedMemory: {
    kind: "none" | "preference" | "alias" | "recurring_instruction" | "correction_signal";
    scope: "user" | "global_candidate" | "review" | "blocked";
    key: string | null;
    value: string | null;
    confidence: number;
    sourceFeedbackId: number;
    sourceHistoryId: number | null;
  };
  candidateGlobalKnowledge: {
    allowed: boolean;
    requiresReview: boolean;
    reason: string;
  };
  privacy: {
    audit: AiLearningPrivacyRecord;
    individualLearning: AiLearningPrivacyRecord;
    globalLearning: AiLearningPrivacyRecord;
  };
};

type RecordWhatsappFeedbackInput = {
  userId: number;
  text: string;
  targetHistoryId?: number | null;
  createdAt?: Date;
};

type ListWhatsappFeedbackFilter = {
  userId?: number;
  kind?: WhatsappFeedbackKind;
  scope?: WhatsappFeedbackScope;
  status?: WhatsappFeedbackStatus;
  targetHistoryId?: number;
  targetIntent?: WhatsappIntentName | "unknown";
  from?: Date | string;
  to?: Date | string;
};

export type WhatsappFeedbackMetrics = {
  total: number;
  positive: number;
  negative: number;
  corrections: number;
  preferences: number;
  personalAliases: number;
  recurringInstructions: number;
  needsReview: number;
  blocked: number;
  satisfactionRate: number;
  correctionRate: number;
  retrainingCandidateRate: number;
  byIntent: Partial<Record<WhatsappIntentName | "unknown", { total: number; negative: number; corrections: number }>>;
};

const MAX_FEEDBACK_ENTRIES = 1_000;
const FEEDBACK_POLICY_VERSION = "whatsapp-feedback-loop/v1";
const entries: WhatsappFeedbackEntry[] = [];
let nextFeedbackId = 1;

function hashValue(value: string) {
  const { createHash } = require("node:crypto") as typeof import("node:crypto");
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function normalizeFeedback(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function toTime(value?: Date | string) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

function clampConfidence(value: number) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function findTargetHistory(userId: number, targetHistoryId?: number | null) {
  if (targetHistoryId) {
    return listWhatsappMessageHistory({ userId }).find(entry => entry.id === targetHistoryId) ?? null;
  }
  return listWhatsappMessageHistory({ userId }).at(-1) ?? null;
}

function classifyFeedback(text: string): { kind: WhatsappFeedbackKind; confidence: number; reason: string } {
  const normalized = normalizeFeedback(text);

  if (/\b(?:perfeito|correto|certinho|acertou|boa|obrigado|valeu|funcionou)\b/.test(normalized)) {
    return { kind: "positive", confidence: 0.86, reason: "Feedback positivo explicito." };
  }
  if (/\b(?:errado|incorreto|nao era|não era|nao foi|não foi|corrige|corrigir|troca|troque)\b/.test(normalized)) {
    return { kind: "correction", confidence: 0.84, reason: "Feedback indica correcao ou erro em decisao anterior." };
  }
  if (/\b(?:sempre que eu falar|quando eu falar|pra mim|para mim|meu|minha)\b/.test(normalized) && /\b(?:quer dizer|significa|e|é|eh)\b/.test(normalized)) {
    return { kind: "personal_alias", confidence: 0.82, reason: "Feedback define alias ou interpretacao pessoal." };
  }
  if (/\b(?:prefiro|gosto|costumo|normalmente|geralmente)\b/.test(normalized)) {
    return { kind: "preference", confidence: 0.78, reason: "Feedback descreve preferencia individual." };
  }
  if (/\b(?:nao me pergunte|não me pergunte|sempre registre|nunca registre|da proxima vez|da próxima vez)\b/.test(normalized)) {
    return { kind: "recurring_instruction", confidence: 0.76, reason: "Feedback pede comportamento recorrente futuro." };
  }
  if (/\b(?:ruim|pessimo|péssimo|falhou|nao gostei|não gostei)\b/.test(normalized)) {
    return { kind: "negative", confidence: 0.74, reason: "Feedback negativo explicito." };
  }

  return { kind: "negative", confidence: 0.52, reason: "Feedback pouco especifico tratado como sinal negativo de baixa confianca." };
}

function inferScope(input: {
  kind: WhatsappFeedbackKind;
  confidence: number;
  text: string;
  target: WhatsappMessageHistoryEntry | null;
}): { scope: WhatsappFeedbackScope; status: WhatsappFeedbackStatus; reason: string } {
  const normalized = normalizeFeedback(input.text);
  if (/\b(?:ignore|prompt|sistema|developer|regra global|todos usuarios|todos os usuarios|base global)\b/.test(normalized)) {
    return { scope: "blocked", status: "blocked", reason: "Feedback tenta manipular regra, prompt, sistema ou escopo global." };
  }

  if (input.kind === "personal_alias" || input.kind === "preference" || input.kind === "recurring_instruction") {
    return { scope: "individual", status: "recorded", reason: "Sinal permitido apenas como aprendizado individual do usuario." };
  }

  if (input.kind === "correction" && input.target?.persisted.happened) {
    return { scope: "review_required", status: "needs_review", reason: "Correcao sobre acao persistente exige revisao antes de virar conhecimento global." };
  }

  if (input.kind === "positive" || input.kind === "negative") {
    return { scope: "individual", status: "recorded", reason: "Sinal de satisfacao usado como metrica individual e operacional." };
  }

  return input.confidence < 0.7
    ? { scope: "review_required", status: "needs_review", reason: "Feedback de baixa confianca enviado para revisao." }
    : { scope: "individual", status: "recorded", reason: "Feedback registrado no escopo individual." };
}

function extractAlias(text: string) {
  const match = text.match(/(?:sempre que eu falar|quando eu falar)\s+(.+?)\s+(?:quer dizer|significa|e|é|eh)\s+(.+)$/i);
  if (!match) return null;
  return {
    key: match[1].trim(),
    value: match[2].trim(),
  };
}

function buildGeneratedMemory(input: {
  feedbackId: number;
  kind: WhatsappFeedbackKind;
  scope: WhatsappFeedbackScope;
  confidence: number;
  text: string;
  targetHistoryId: number | null;
}): WhatsappFeedbackEntry["generatedMemory"] {
  if (input.scope === "blocked") {
    return {
      kind: "none",
      scope: "blocked",
      key: null,
      value: null,
      confidence: input.confidence,
      sourceFeedbackId: input.feedbackId,
      sourceHistoryId: input.targetHistoryId,
    };
  }

  if (input.kind === "personal_alias") {
    const alias = extractAlias(input.text);
    return {
      kind: "alias",
      scope: "user",
      key: alias?.key ?? null,
      value: alias?.value ?? input.text,
      confidence: input.confidence,
      sourceFeedbackId: input.feedbackId,
      sourceHistoryId: input.targetHistoryId,
    };
  }

  if (input.kind === "preference" || input.kind === "recurring_instruction") {
    return {
      kind: input.kind === "preference" ? "preference" : "recurring_instruction",
      scope: "user",
      key: input.kind,
      value: input.text,
      confidence: input.confidence,
      sourceFeedbackId: input.feedbackId,
      sourceHistoryId: input.targetHistoryId,
    };
  }

  if (input.kind === "correction") {
    return {
      kind: "correction_signal",
      scope: input.scope === "review_required" ? "review" : "user",
      key: "correction",
      value: input.text,
      confidence: input.confidence,
      sourceFeedbackId: input.feedbackId,
      sourceHistoryId: input.targetHistoryId,
    };
  }

  return {
    kind: "none",
    scope: input.scope === "global_candidate" ? "global_candidate" : "user",
    key: null,
    value: null,
    confidence: input.confidence,
    sourceFeedbackId: input.feedbackId,
    sourceHistoryId: input.targetHistoryId,
  };
}

function buildPrivacy(createdAt: string): WhatsappFeedbackEntry["privacy"] {
  return {
    audit: buildAiLearningPrivacyRecord({ kind: "audit_event", purpose: "audit", origin: "whatsapp-feedback-loop", createdAt }),
    individualLearning: buildAiLearningPrivacyRecord({ kind: "structured_decision", purpose: "individual_learning", origin: "whatsapp-feedback-loop", createdAt }),
    globalLearning: buildAiLearningPrivacyRecord({ kind: "candidate_rule", purpose: "global_learning", origin: "whatsapp-feedback-loop", createdAt, scope: "global" }),
  };
}

function pruneFeedback() {
  if (entries.length > MAX_FEEDBACK_ENTRIES) {
    entries.splice(0, entries.length - MAX_FEEDBACK_ENTRIES);
  }
}

export function recordWhatsappUserFeedback(input: RecordWhatsappFeedbackInput) {
  const createdAt = (input.createdAt ?? new Date()).toISOString();
  const target = findTargetHistory(input.userId, input.targetHistoryId);
  const classified = classifyFeedback(input.text);
  const scopeDecision = inferScope({ ...classified, text: input.text, target });
  const sanitized = sanitizeSampleForLearning({
    kind: "structured_decision",
    purpose: "individual_learning",
    text: input.text,
    origin: "whatsapp-feedback-loop",
    createdAt,
  });
  const feedbackId = nextFeedbackId;
  const generatedMemory = buildGeneratedMemory({
    feedbackId,
    kind: classified.kind,
    scope: scopeDecision.scope,
    confidence: classified.confidence,
    text: sanitized.text ?? "",
    targetHistoryId: target?.id ?? null,
  });

  const entry: WhatsappFeedbackEntry = {
    id: feedbackId,
    createdAt,
    userId: input.userId,
    channel: "whatsapp",
    feedbackHash: hashValue(input.text),
    sanitizedFeedback: sanitized.text ?? "",
    kind: classified.kind,
    confidence: clampConfidence(classified.confidence),
    scope: scopeDecision.scope,
    status: scopeDecision.status,
    reason: scopeDecision.reason || classified.reason,
    targetHistoryId: target?.id ?? input.targetHistoryId ?? null,
    targetIntent: target?.intent ?? null,
    targetAction: target?.action ?? null,
    generatedMemory,
    candidateGlobalKnowledge: {
      allowed: false,
      requiresReview: scopeDecision.scope === "review_required" || scopeDecision.scope === "global_candidate",
      reason: scopeDecision.scope === "blocked"
        ? "Sinal bloqueado nao pode virar conhecimento global."
        : "Feedback isolado nao promove conhecimento global sem agregacao, revisao e gates futuros.",
    },
    privacy: buildPrivacy(createdAt),
  };

  nextFeedbackId += 1;
  entries.push(entry);
  if (target?.id) {
    linkWhatsappMessageHistory({
      sourceHistoryId: target.id,
      action: classified.kind === "correction" ? "correction" : "feedback",
      targetHistoryId: target.id,
    });
  }
  pruneFeedback();
  return entry;
}

export function listWhatsappFeedback(filter: ListWhatsappFeedbackFilter = {}) {
  const from = toTime(filter.from);
  const to = toTime(filter.to);
  return entries.filter(entry => {
    const createdAt = new Date(entry.createdAt).getTime();
    if (filter.userId !== undefined && entry.userId !== filter.userId) return false;
    if (filter.kind && entry.kind !== filter.kind) return false;
    if (filter.scope && entry.scope !== filter.scope) return false;
    if (filter.status && entry.status !== filter.status) return false;
    if (filter.targetHistoryId !== undefined && entry.targetHistoryId !== filter.targetHistoryId) return false;
    if (filter.targetIntent && entry.targetIntent !== filter.targetIntent) return false;
    if (from !== null && createdAt < from) return false;
    if (to !== null && createdAt > to) return false;
    return true;
  });
}

export function summarizeWhatsappFeedback(filter: ListWhatsappFeedbackFilter = {}): WhatsappFeedbackMetrics {
  const feedback = listWhatsappFeedback(filter);
  const summary: WhatsappFeedbackMetrics = {
    total: feedback.length,
    positive: 0,
    negative: 0,
    corrections: 0,
    preferences: 0,
    personalAliases: 0,
    recurringInstructions: 0,
    needsReview: 0,
    blocked: 0,
    satisfactionRate: 0,
    correctionRate: 0,
    retrainingCandidateRate: 0,
    byIntent: {},
  };

  for (const entry of feedback) {
    summary.positive += entry.kind === "positive" ? 1 : 0;
    summary.negative += entry.kind === "negative" ? 1 : 0;
    summary.corrections += entry.kind === "correction" ? 1 : 0;
    summary.preferences += entry.kind === "preference" ? 1 : 0;
    summary.personalAliases += entry.kind === "personal_alias" ? 1 : 0;
    summary.recurringInstructions += entry.kind === "recurring_instruction" ? 1 : 0;
    summary.needsReview += entry.status === "needs_review" ? 1 : 0;
    summary.blocked += entry.status === "blocked" ? 1 : 0;

    if (entry.targetIntent) {
      const intentSummary = summary.byIntent[entry.targetIntent] ?? { total: 0, negative: 0, corrections: 0 };
      intentSummary.total += 1;
      intentSummary.negative += entry.kind === "negative" ? 1 : 0;
      intentSummary.corrections += entry.kind === "correction" ? 1 : 0;
      summary.byIntent[entry.targetIntent] = intentSummary;
    }
  }

  summary.satisfactionRate = summary.total ? Number((summary.positive / summary.total).toFixed(2)) : 0;
  summary.correctionRate = summary.total ? Number((summary.corrections / summary.total).toFixed(2)) : 0;
  summary.retrainingCandidateRate = summary.total ? Number(((summary.needsReview + summary.blocked) / summary.total).toFixed(2)) : 0;
  return summary;
}

export function __resetWhatsappFeedbackForTests() {
  entries.length = 0;
  nextFeedbackId = 1;
}

export const WHATSAPP_FEEDBACK_POLICY_VERSION = FEEDBACK_POLICY_VERSION;
