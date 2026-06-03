import { Request, Response } from "express";
import { handleWhatsAppWebhookWithTextIntent } from "./whatsappIntentWebhook";

type WhatsAppMessage = {
  id?: string;
  image?: { id?: string };
};

type IndexedMessage = {
  key: string;
  message: WhatsAppMessage;
};

const reservedImageMessageIds = new Map<string, number>();
const IMAGE_MESSAGE_TTL_MS = 24 * 60 * 60 * 1000;

function extractMessages(payload: any): IndexedMessage[] {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  return entries.flatMap((entry: any, entryIndex: number) =>
    Array.isArray(entry?.changes)
      ? entry.changes.flatMap((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          return messages.map((message: WhatsAppMessage, messageIndex: number) => ({
            key: `${entryIndex}:${changeIndex}:${messageIndex}`,
            message,
          }));
        })
      : [],
  );
}

function pruneReservations(now = Date.now()) {
  for (const [messageId, expiresAt] of reservedImageMessageIds) {
    if (expiresAt <= now) {
      reservedImageMessageIds.delete(messageId);
    }
  }
}

function reserveImageMessages(messages: IndexedMessage[]) {
  const duplicateKeys = new Set<string>();
  const now = Date.now();
  pruneReservations(now);

  for (const item of messages) {
    const messageId = item.message.id;
    if (!messageId || !item.message.image?.id) {
      continue;
    }

    if (reservedImageMessageIds.has(messageId)) {
      duplicateKeys.add(item.key);
      continue;
    }

    reservedImageMessageIds.set(messageId, now + IMAGE_MESSAGE_TTL_MS);
  }

  return duplicateKeys;
}

function clonePayloadWithoutKeys(payload: any, duplicateKeys: Set<string>) {
  const cloned = structuredClone(payload);
  const entries = Array.isArray(cloned?.entry) ? cloned.entry : [];

  cloned.entry = entries
    .map((entry: any, entryIndex: number) => {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      const filteredChanges = changes
        .map((change: any, changeIndex: number) => {
          const messages = Array.isArray(change?.value?.messages) ? change.value.messages : [];
          const filteredMessages = messages.filter(
            (_message: WhatsAppMessage, messageIndex: number) => !duplicateKeys.has(`${entryIndex}:${changeIndex}:${messageIndex}`),
          );

          return {
            ...change,
            value: {
              ...change.value,
              messages: filteredMessages,
            },
          };
        })
        .filter((change: any) => Array.isArray(change?.value?.messages) && change.value.messages.length > 0);

      return {
        ...entry,
        changes: filteredChanges,
      };
    })
    .filter((entry: any) => Array.isArray(entry?.changes) && entry.changes.length > 0);

  return cloned;
}

export function __resetWhatsAppImageIdempotencyForTests() {
  reservedImageMessageIds.clear();
}

export async function handleWhatsAppWebhookWithImageIdempotency(req: Request, res: Response) {
  const messages = extractMessages(req.body);
  const duplicateKeys = reserveImageMessages(messages);

  if (duplicateKeys.size > 0) {
    const remainingPayload = clonePayloadWithoutKeys(req.body, duplicateKeys);
    if (!Array.isArray(remainingPayload?.entry) || remainingPayload.entry.length === 0) {
      return res.status(200).json({ ok: true, processed: 0, deduplicated: true });
    }

    req.body = remainingPayload;
  }

  return handleWhatsAppWebhookWithTextIntent(req, res);
}
