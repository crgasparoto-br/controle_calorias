import { createHash } from "node:crypto";

export type WhatsappInboundDuplicateKind =
  | "message_id_retry"
  | "short_window_text_duplicate"
  | "intentional_repeat";

export type WhatsappInboundIdempotencyInput = {
  userId: number;
  messageId?: string | null;
  text?: string | null;
  receivedAt?: Date;
  duplicateWindowMs?: number;
};

export type WhatsappInboundIdempotencyDecision = {
  shouldProcess: boolean;
  duplicateKind: WhatsappInboundDuplicateKind | null;
  idempotencyKey: string;
  textHash: string | null;
  firstSeenAt: string;
  reason: string;
  reply: string | null;
  eventType: string;
  detail: string;
};

type StoredInboundMessage = {
  idempotencyKey: string;
  textHash: string | null;
  userId: number;
  messageId: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

const DEFAULT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const MAX_STORED_MESSAGES = 1_000;
const messagesByIdempotencyKey = new Map<string, StoredInboundMessage>();
const recentMessagesByUserAndText = new Map<string, StoredInboundMessage>();

function compactText(value?: string | null) {
  const compacted = value?.replace(/\s+/g, " ").trim() ?? "";
  return compacted || null;
}

function normalizeForHash(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/(\d+(?:[,.]\d+)?)\s+(g|kg|mg|ml|l|un|unidade|unidades)\b/gu, "$1$2")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function buildTextHash(value?: string | null) {
  const text = compactText(value);
  if (!text) return null;
  return hashValue(normalizeForHash(text));
}

function hasIntentionalRepeatSignal(value?: string | null) {
  const text = normalizeForHash(value ?? "");
  return /\b(?:de novo|novamente|outra vez|mais uma vez|novo registro|registrar outra|registra outra|repetir|tambem comi|tambem registrei|tambem registrar)\b/.test(text);
}

function buildIdempotencyKey(input: WhatsappInboundIdempotencyInput, textHash: string | null) {
  const messageId = compactText(input.messageId);
  if (messageId) {
    return `wamid:${input.userId}:${messageId}`;
  }
  return `text:${input.userId}:${textHash ?? "empty"}`;
}

function pruneOldestEntries() {
  if (messagesByIdempotencyKey.size <= MAX_STORED_MESSAGES) return;
  const overflow = messagesByIdempotencyKey.size - MAX_STORED_MESSAGES;
  const oldestKeys = [...messagesByIdempotencyKey.entries()]
    .sort((a, b) => a[1].lastSeenAt.getTime() - b[1].lastSeenAt.getTime())
    .slice(0, overflow)
    .map(([key]) => key);

  for (const key of oldestKeys) {
    const entry = messagesByIdempotencyKey.get(key);
    messagesByIdempotencyKey.delete(key);
    if (entry?.textHash) {
      recentMessagesByUserAndText.delete(`${entry.userId}:${entry.textHash}`);
    }
  }
}

function duplicateDecision(
  duplicateKind: Exclude<WhatsappInboundDuplicateKind, "intentional_repeat">,
  entry: StoredInboundMessage,
  now: Date,
): WhatsappInboundIdempotencyDecision {
  entry.lastSeenAt = now;
  return {
    shouldProcess: false,
    duplicateKind,
    idempotencyKey: entry.idempotencyKey,
    textHash: entry.textHash,
    firstSeenAt: entry.firstSeenAt.toISOString(),
    reason: duplicateKind === "message_id_retry"
      ? "Mesmo identificador de mensagem/evento recebido novamente."
      : "Mensagem textualmente igual recebida dentro da janela curta de proteção.",
    reply: duplicateKind === "message_id_retry"
      ? "Essa mensagem já foi recebida e não vou processar de novo para evitar duplicidade."
      : "Recebi uma mensagem igual há pouco. Para evitar duplicidade, não vou registrar de novo. Se for uma nova refeição, envie dizendo que é outro registro.",
    eventType: duplicateKind === "message_id_retry"
      ? "whatsapp.idempotency.message_retry_ignored"
      : "whatsapp.idempotency.short_window_duplicate_ignored",
    detail: duplicateKind === "message_id_retry"
      ? "Retry técnico com mesmo message_id foi ignorado antes de ações persistentes."
      : "Mensagem com mesmo texto dentro da janela curta foi ignorada antes de ações persistentes.",
  };
}

export function evaluateWhatsappInboundIdempotency(input: WhatsappInboundIdempotencyInput): WhatsappInboundIdempotencyDecision {
  const now = input.receivedAt ?? new Date();
  const duplicateWindowMs = input.duplicateWindowMs ?? DEFAULT_DUPLICATE_WINDOW_MS;
  const textHash = buildTextHash(input.text);
  const idempotencyKey = buildIdempotencyKey(input, textHash);
  const existingById = messagesByIdempotencyKey.get(idempotencyKey);

  if (existingById && compactText(input.messageId)) {
    return duplicateDecision("message_id_retry", existingById, now);
  }

  const textKey = textHash ? `${input.userId}:${textHash}` : null;
  const existingByText = textKey ? recentMessagesByUserAndText.get(textKey) : null;
  const intentionalRepeat = hasIntentionalRepeatSignal(input.text);

  if (existingByText && !intentionalRepeat) {
    const elapsedMs = now.getTime() - existingByText.firstSeenAt.getTime();
    if (elapsedMs >= 0 && elapsedMs <= duplicateWindowMs) {
      return duplicateDecision("short_window_text_duplicate", existingByText, now);
    }
  }

  const entry: StoredInboundMessage = {
    idempotencyKey,
    textHash,
    userId: input.userId,
    messageId: compactText(input.messageId),
    firstSeenAt: now,
    lastSeenAt: now,
  };
  messagesByIdempotencyKey.set(idempotencyKey, entry);
  if (textKey) {
    recentMessagesByUserAndText.set(textKey, entry);
  }
  pruneOldestEntries();

  return {
    shouldProcess: true,
    duplicateKind: intentionalRepeat && existingByText ? "intentional_repeat" : null,
    idempotencyKey,
    textHash,
    firstSeenAt: now.toISOString(),
    reason: intentionalRepeat && existingByText
      ? "Mensagem repetida possui sinal explicito de novo registro."
      : "Mensagem liberada para processamento.",
    reply: null,
    eventType: intentionalRepeat && existingByText
      ? "whatsapp.idempotency.intentional_repeat_allowed"
      : "whatsapp.idempotency.message_accepted",
    detail: intentionalRepeat && existingByText
      ? "Mensagem textualmente repetida foi aceita por conter intenção explícita de novo registro."
      : "Mensagem registrada na guarda de idempotência antes do processamento.",
  };
}

export function buildWhatsappDuplicateInboundResult(decision: WhatsappInboundIdempotencyDecision) {
  return {
    handled: true,
    action: "duplicate_inbound_message_ignored",
    reply: decision.reply ?? "Essa mensagem já foi recebida. Não vou processar novamente para evitar duplicidade.",
    eventType: decision.eventType,
    detail: decision.detail,
    data: {
      duplicateKind: decision.duplicateKind,
      idempotencyKey: decision.idempotencyKey,
      firstSeenAt: decision.firstSeenAt,
    },
  };
}

export function __resetWhatsappInboundIdempotencyForTests() {
  messagesByIdempotencyKey.clear();
  recentMessagesByUserAndText.clear();
}
