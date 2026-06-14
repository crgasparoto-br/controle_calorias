import { createHash } from "node:crypto";

export type WhatsappIdempotencyDecision = {
  duplicate: boolean;
  kind: "new" | "technical_retry" | "short_window_text_duplicate";
  key: string;
  firstSeenAt: string;
  reason: string;
};

type CheckWhatsappIdempotencyInput = {
  userId: number;
  text?: string | null;
  messageId?: string | null;
  eventId?: string | null;
  receivedAt?: Date;
  allowIntentionalDuplicate?: boolean;
};

type SeenMessageEntry = {
  key: string;
  userId: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  textHash: string | null;
};

const TECHNICAL_ENTRY_TTL_MS = 24 * 60 * 60 * 1000;
const TEXT_DUPLICATE_WINDOW_MS = 2 * 60 * 1000;
const seenTechnicalMessages = new Map<string, SeenMessageEntry>();
const seenTextMessages = new Map<string, SeenMessageEntry>();

function normalizeText(value?: string | null) {
  return value
    ?.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim() || null;
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pruneEntries(now: Date) {
  for (const [key, entry] of seenTechnicalMessages) {
    if (now.getTime() - entry.lastSeenAt.getTime() > TECHNICAL_ENTRY_TTL_MS) {
      seenTechnicalMessages.delete(key);
    }
  }
  for (const [key, entry] of seenTextMessages) {
    if (now.getTime() - entry.lastSeenAt.getTime() > TEXT_DUPLICATE_WINDOW_MS) {
      seenTextMessages.delete(key);
    }
  }
}

function buildNewDecision(key: string, now: Date): WhatsappIdempotencyDecision {
  return {
    duplicate: false,
    kind: "new",
    key,
    firstSeenAt: now.toISOString(),
    reason: "Mensagem nova liberada para processamento.",
  };
}

export function checkWhatsappInboundIdempotency(input: CheckWhatsappIdempotencyInput): WhatsappIdempotencyDecision {
  const now = input.receivedAt ?? new Date();
  pruneEntries(now);

  const technicalId = input.messageId?.trim() || input.eventId?.trim() || null;
  if (technicalId) {
    const key = `technical:${input.userId}:${technicalId}`;
    const existing = seenTechnicalMessages.get(key);
    if (existing) {
      existing.lastSeenAt = now;
      return {
        duplicate: true,
        kind: "technical_retry",
        key,
        firstSeenAt: existing.firstSeenAt.toISOString(),
        reason: "Mesmo identificador de mensagem/evento ja foi processado.",
      };
    }

    seenTechnicalMessages.set(key, {
      key,
      userId: input.userId,
      firstSeenAt: now,
      lastSeenAt: now,
      textHash: null,
    });
    return buildNewDecision(key, now);
  }

  const normalizedText = normalizeText(input.text);
  if (!normalizedText) {
    return buildNewDecision(`empty:${input.userId}:${now.getTime()}`, now);
  }

  const textHash = hashValue(normalizedText);
  const key = `text:${input.userId}:${textHash}`;
  const existing = seenTextMessages.get(key);
  if (existing && !input.allowIntentionalDuplicate) {
    existing.lastSeenAt = now;
    return {
      duplicate: true,
      kind: "short_window_text_duplicate",
      key,
      firstSeenAt: existing.firstSeenAt.toISOString(),
      reason: "Texto identico recebido novamente dentro da janela curta de protecao.",
    };
  }

  seenTextMessages.set(key, {
    key,
    userId: input.userId,
    firstSeenAt: now,
    lastSeenAt: now,
    textHash,
  });
  return buildNewDecision(key, now);
}

export function buildWhatsappDuplicateInboundResponse(decision: WhatsappIdempotencyDecision) {
  return {
    handled: true,
    action: "duplicate_message_ignored",
    reply: decision.kind === "technical_retry"
      ? "Essa mensagem ja foi recebida e nao vou processar de novo para evitar duplicidade."
      : "Recebi uma mensagem igual agora ha pouco. Para registrar de novo, confirme que deseja repetir esse lancamento.",
    eventType: "whatsapp.idempotency.duplicate_ignored",
    detail: decision.reason,
    data: {
      duplicateKind: decision.kind,
      firstSeenAt: decision.firstSeenAt,
      key: decision.key,
    },
  };
}

export function __resetWhatsappIdempotencyForTests() {
  seenTechnicalMessages.clear();
  seenTextMessages.clear();
}
