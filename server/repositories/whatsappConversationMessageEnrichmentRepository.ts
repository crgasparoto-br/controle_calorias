import { eq } from "drizzle-orm";
import { whatsappConversationMessages } from "../../drizzle/schema";
import { sanitizeSampleForLearning } from "../modules/aiLearningPrivacy";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type EnrichWhatsAppConversationMessageInput = {
  transcript?: string;
  mediaStorageKey?: string;
  mediaMimeType?: string;
  allowRawContentStorage?: boolean;
};

export type WhatsAppConversationMessageEnrichmentRepository = {
  enrichInboundMessageByExternalId(
    externalMessageId: string,
    input: EnrichWhatsAppConversationMessageInput,
  ): Promise<boolean>;
};

function laterDate(currentValue: unknown, nextValue: string | null) {
  const current = currentValue instanceof Date
    ? currentValue
    : currentValue
      ? new Date(String(currentValue))
      : null;
  const next = nextValue ? new Date(nextValue) : null;

  if (!current || Number.isNaN(current.getTime())) return next;
  if (!next || Number.isNaN(next.getTime())) return current;
  return current.getTime() >= next.getTime() ? current : next;
}

export function createDrizzleWhatsAppConversationMessageEnrichmentRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppConversationMessageEnrichmentRepository {
  return {
    async enrichInboundMessageByExternalId(externalMessageId, input) {
      let db: any | null = null;
      try {
        db = await deps.getDb();
      } catch (error) {
        deps.onWarning("WhatsApp conversation message enrichment database lookup skipped", error);
        return false;
      }
      if (!db) return false;

      try {
        const idempotencyKey = `whatsapp:inbound:${externalMessageId}`;
        const [existing] = await db
          .select()
          .from(whatsappConversationMessages)
          .where(eq(whatsappConversationMessages.idempotencyKey, idempotencyKey))
          .limit(1);
        if (!existing) return false;

        const update: Record<string, unknown> = {};

        if (input.transcript?.trim()) {
          const occurredAt = existing.occurredAt instanceof Date
            ? existing.occurredAt
            : new Date(existing.occurredAt);
          const createdAt = Number.isNaN(occurredAt.getTime())
            ? new Date().toISOString()
            : occurredAt.toISOString();
          const sample = sanitizeSampleForLearning({
            kind: "transcript",
            purpose: "operation",
            text: input.transcript,
            origin: "whatsapp-conversation-message-enrichment",
            createdAt,
          });
          const rawStored = Boolean(
            input.allowRawContentStorage
            && sample.metadata.rawTextAllowed
            && !sample.metadata.anonymizationRequired,
          );

          update.rawTextStored = Boolean(existing.rawTextStored || rawStored);
          update.transcript = rawStored ? input.transcript : null;
          update.sanitizedTranscript = sample.text;
          update.privacyPolicyVersion = sample.metadata.policyVersion ?? existing.privacyPolicyVersion ?? null;
          update.retentionExpiresAt = laterDate(existing.retentionExpiresAt, sample.metadata.expiresAt);
        }

        if (input.mediaStorageKey) {
          update.mediaStorageKey = input.mediaStorageKey;
        }
        if (input.mediaMimeType) {
          update.mediaMimeType = input.mediaMimeType;
        }

        if (!Object.keys(update).length) return true;

        await db
          .update(whatsappConversationMessages)
          .set(update)
          .where(eq(whatsappConversationMessages.id, existing.id));
        return true;
      } catch (error) {
        deps.onWarning("WhatsApp conversation message enrichment skipped", error);
        return false;
      }
    },
  };
}
