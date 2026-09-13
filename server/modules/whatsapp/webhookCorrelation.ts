import { createHash } from "node:crypto";
import { extractWhatsAppWebhookMessages } from "./webhookUtils";

const MESSAGE_FINGERPRINT_HEX_LENGTH = 20;

export function fingerprintWhatsAppMessageId(messageId?: string | null) {
  const normalized = messageId?.trim();
  if (!normalized) return null;
  return createHash("sha256")
    .update(normalized, "utf8")
    .digest("hex")
    .slice(0, MESSAGE_FINGERPRINT_HEX_LENGTH);
}

export function resolveWhatsAppWebhookCorrelation(payload: unknown) {
  const messages = extractWhatsAppWebhookMessages(payload);
  const messageFingerprints = [
    ...new Set(
      messages
        .map(message => fingerprintWhatsAppMessageId(message.id))
        .filter((value): value is string => Boolean(value))
    ),
  ];

  return {
    messageCount: messages.length,
    messageFingerprints,
  };
}
