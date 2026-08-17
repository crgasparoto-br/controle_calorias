import {
  listWhatsappContextMemories,
  recordWhatsappContextMemory,
  type WhatsappContextMemoryEntry,
} from "./contextMemory";
import { listWhatsappMessageHistory } from "./messageHistory";
import type { WhatsappIntentName, WhatsappInterpretedIntent } from "./intentSchema";

const CONFIRMED_ALIAS_WINDOW_MS = 10 * 60 * 1000;
const SHORT_ALIAS_INTENTS = new Set<WhatsappIntentName>(["daily_summary", "list_meal_records", "open_records_link", "help"]);

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUnsafeLearningText(value: string) {
  const normalized = normalizeText(value);
  return /\b(?:ignore|prompt|sistema|developer|regra global|todos usuarios|todos os usuarios|base global|sem revisao|aprovar global)\b/.test(normalized);
}

function isConfirmedDailySummaryText(value: string) {
  return normalizeText(value) === "quero um resumo";
}

function isPendingAliasCandidate(input: {
  createdAt: string;
  intent: WhatsappIntentName | "unknown";
  status: string;
  replyKind: string;
  sanitizedContent: string | null;
  normalizedInput: string | null;
}, confirmedAt: Date) {
  const createdAt = new Date(input.createdAt).getTime();
  if (!Number.isFinite(createdAt) || confirmedAt.getTime() - createdAt > CONFIRMED_ALIAS_WINDOW_MS) {
    return false;
  }

  const text = input.normalizedInput ?? input.sanitizedContent ?? "";
  return normalizeText(text) === "resuma"
    && (input.intent === "unknown" || input.intent === "ambiguous")
    && (input.status === "ambiguous" || input.status === "low_confidence" || input.status === "pending")
    && input.replyKind === "clarification";
}

function findExistingMemory(input: {
  userId: number;
  scope: "individual" | "candidate_global";
  kind: "individual_alias" | "global_alias";
  key: string;
  value: string;
  status?: "active" | "needs_review";
}) {
  return listWhatsappContextMemories({
    userId: input.scope === "individual" ? input.userId : undefined,
    scope: input.scope,
    kind: input.kind,
    status: input.status,
  }).find(memory => normalizeText(memory.key) === input.key && memory.value === input.value) ?? null;
}

function ensureAliasMemory(input: {
  userId: number;
  key: string;
  value: WhatsappIntentName;
  sourceHistoryId: number;
  createdAt: Date;
}) {
  const existingIndividual = findExistingMemory({
    userId: input.userId,
    scope: "individual",
    kind: "individual_alias",
    key: input.key,
    value: input.value,
    status: "active",
  });

  const individual = existingIndividual ?? recordWhatsappContextMemory({
    userId: input.userId,
    scope: "individual",
    kind: "individual_alias",
    key: input.key,
    value: input.value,
    confidence: 0.86,
    priority: 110,
    appliesToIntents: [input.value],
    source: { sourceType: "manual", historyId: input.sourceHistoryId, ruleVersion: "whatsapp-intent-alias-learning/v1" },
    createdAt: input.createdAt,
  });

  const existingCandidate = findExistingMemory({
    userId: input.userId,
    scope: "candidate_global",
    kind: "global_alias",
    key: input.key,
    value: input.value,
    status: "needs_review",
  });

  const candidateGlobal = existingCandidate ?? recordWhatsappContextMemory({
    scope: "candidate_global",
    kind: "global_alias",
    key: input.key,
    value: input.value,
    confidence: 0.74,
    appliesToIntents: [input.value],
    source: { sourceType: "manual", historyId: input.sourceHistoryId, ruleVersion: "whatsapp-intent-alias-learning/v1" },
    status: "needs_review",
    createdAt: input.createdAt,
  });

  return { individual, candidateGlobal };
}

export function learnWhatsappIntentAliasFromConfirmation(input: {
  userId: number;
  text: string;
  intent: WhatsappInterpretedIntent;
  receivedAt: Date;
}): { learned: false; reason: string } | { learned: true; individual: WhatsappContextMemoryEntry; candidateGlobal: WhatsappContextMemoryEntry } {
  if (!SHORT_ALIAS_INTENTS.has(input.intent.intent) || input.intent.intent !== "daily_summary") {
    return { learned: false, reason: "intent_not_supported" };
  }
  if (!isConfirmedDailySummaryText(input.text)) {
    return { learned: false, reason: "not_confirmation_phrase" };
  }
  if (isUnsafeLearningText(input.text)) {
    return { learned: false, reason: "unsafe_learning_text" };
  }

  const recentPendingAlias = listWhatsappMessageHistory({ userId: input.userId })
    .filter(history => isPendingAliasCandidate({
      createdAt: history.createdAt,
      intent: history.intent,
      status: history.status,
      replyKind: history.reply.kind,
      sanitizedContent: history.sanitizedContent,
      normalizedInput: history.normalizedInput,
    }, input.receivedAt))
    .at(-1);

  if (!recentPendingAlias) {
    return { learned: false, reason: "no_recent_pending_alias" };
  }

  const aliasText = normalizeText(recentPendingAlias.normalizedInput ?? recentPendingAlias.sanitizedContent ?? "");
  if (isUnsafeLearningText(aliasText)) {
    return { learned: false, reason: "unsafe_alias_text" };
  }

  return {
    learned: true,
    ...ensureAliasMemory({
      userId: input.userId,
      key: aliasText,
      value: input.intent.intent,
      sourceHistoryId: recentPendingAlias.id,
      createdAt: input.receivedAt,
    }),
  };
}
