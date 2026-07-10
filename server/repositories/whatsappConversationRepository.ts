import crypto from "node:crypto";
import { asc, desc, eq } from "drizzle-orm";
import {
  whatsappConversationMessages,
  whatsappConversations,
  whatsappMessageDomainLinks,
} from "../../drizzle/schema";
import { sanitizeSampleForLearning } from "../modules/aiLearningPrivacy";
import { isConversationActive } from "../modules/whatsapp/conversationPolicy";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

const DUPLICATE_ENTRY_ERROR_CODE = "ER_DUP_ENTRY";

export type WhatsAppConversationRecord = typeof whatsappConversations.$inferSelect;
export type WhatsAppConversationMessageRecord = typeof whatsappConversationMessages.$inferSelect;
export type WhatsAppMessageDomainLinkRecord = typeof whatsappMessageDomainLinks.$inferSelect;

export type AppendMessageInput = {
  conversationId: number;
  userId: number;
  direction: "inbound" | "outbound";
  externalMessageId?: string | null;
  contentType: "text" | "image" | "audio" | "multimodal" | "system";
  text?: string | null;
  transcript?: string | null;
  captionText?: string | null;
  mediaStorageKey?: string | null;
  mediaMimeType?: string | null;
  respondsToMessageId?: number | null;
  occurredAt: Date;
  processedAt?: Date | null;
  /** Corresponde ao allowRawContentStorage de messageHistory.ts: permite manter texto bruto quando a política de privacidade autoriza. */
  allowRawContentStorage?: boolean;
};

export type DomainLinkInput = {
  mealId?: number;
  mealItemId?: number;
  waterLogId?: number;
  weightEntryId?: number;
  exerciseId?: number;
};

export type WhatsAppConversationRepository = {
  createOrGetActiveConversation(
    userId: number,
    whatsappConnectionId: number | null,
    phoneNumber: string,
    now?: Date,
  ): Promise<WhatsAppConversationRecord | null>;
  appendMessage(input: AppendMessageInput): Promise<WhatsAppConversationMessageRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WhatsAppConversationMessageRecord | null>;
  linkResponse(inboundMessageId: number, outboundMessageId: number): Promise<void>;
  linkDomainRecord(messageId: number, link: DomainLinkInput): Promise<void>;
  findRecentMessages(conversationId: number, limit?: number): Promise<WhatsAppConversationMessageRecord[]>;
  findRecentMessagesByUser(userId: number, limit?: number): Promise<WhatsAppConversationMessageRecord[]>;
  findDomainLinksForMessage(messageId: number): Promise<WhatsAppMessageDomainLinkRecord[]>;
  markProcessed(messageId: number, processedAt?: Date): Promise<void>;
};

function buildIdempotencyKey(input: AppendMessageInput): string {
  const channel = "whatsapp";
  if (input.externalMessageId) {
    return `${channel}:${input.direction}:${input.externalMessageId}`;
  }
  return `${channel}:${input.direction}:${input.conversationId}:${input.respondsToMessageId ?? "root"}:${crypto.randomUUID()}`;
}

function isDuplicateEntryError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { code?: string }).code === DUPLICATE_ENTRY_ERROR_CODE);
}

function buildTextFields(input: AppendMessageInput, occurredAtIso: string) {
  const rawText = input.text ?? null;
  const rawTranscript = input.transcript ?? null;

  const sanitizeField = (value: string | null, kind: "raw_message" | "transcript") => {
    if (!value) return { rawStored: false, raw: null as string | null, sanitized: null as string | null, privacyPolicyVersion: null as string | null, retentionExpiresAt: null as string | null };

    const sample = sanitizeSampleForLearning({
      kind,
      purpose: "operation",
      text: value,
      origin: "whatsapp-conversation-repository",
      createdAt: occurredAtIso,
    });
    const rawStored = Boolean(input.allowRawContentStorage && sample.metadata.rawTextAllowed && !sample.metadata.anonymizationRequired);

    return {
      rawStored,
      raw: rawStored ? value : null,
      sanitized: sample.text,
      privacyPolicyVersion: sample.metadata.policyVersion,
      retentionExpiresAt: sample.metadata.expiresAt,
    };
  };

  const textResult = sanitizeField(rawText, "raw_message");
  const transcriptResult = sanitizeField(rawTranscript, "transcript");

  return {
    rawTextStored: textResult.rawStored || transcriptResult.rawStored,
    text: textResult.raw,
    sanitizedText: textResult.sanitized,
    transcript: transcriptResult.raw,
    sanitizedTranscript: transcriptResult.sanitized,
    privacyPolicyVersion: textResult.privacyPolicyVersion ?? transcriptResult.privacyPolicyVersion,
    retentionExpiresAt: textResult.retentionExpiresAt ?? transcriptResult.retentionExpiresAt,
  };
}

export function createDrizzleWhatsAppConversationRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppConversationRepository {
  return {
    async createOrGetActiveConversation(userId, whatsappConnectionId, phoneNumber, now = new Date()) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const [existing] = await db
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.userId, userId))
          .orderBy(desc(whatsappConversations.id))
          .limit(1);

        if (existing && isConversationActive(existing, now)) {
          await db
            .update(whatsappConversations)
            .set({ lastActivityAt: now })
            .where(eq(whatsappConversations.id, existing.id));
          return { ...existing, lastActivityAt: now };
        }

        if (existing && existing.status === "active") {
          await db
            .update(whatsappConversations)
            .set({ status: "expired", endedAt: now })
            .where(eq(whatsappConversations.id, existing.id));
        }

        const inserted = await db.insert(whatsappConversations).values({
          userId,
          whatsappConnectionId,
          phoneNumber,
          status: "active",
          startedAt: now,
          lastActivityAt: now,
        });
        const insertedId = Number((inserted as { insertId?: number }).insertId ?? 0);

        const [created] = await db
          .select()
          .from(whatsappConversations)
          .where(eq(whatsappConversations.id, insertedId))
          .limit(1);

        return created ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp conversation create/get skipped", error);
        return null;
      }
    },

    async appendMessage(input) {
      const db = await deps.getDb();
      if (!db) return null;

      const occurredAtIso = input.occurredAt.toISOString();
      const idempotencyKey = buildIdempotencyKey(input);
      const textFields = buildTextFields(input, occurredAtIso);

      try {
        const inserted = await db.insert(whatsappConversationMessages).values({
          conversationId: input.conversationId,
          userId: input.userId,
          direction: input.direction,
          channel: "whatsapp",
          externalMessageId: input.externalMessageId ?? null,
          idempotencyKey,
          contentType: input.contentType,
          rawTextStored: textFields.rawTextStored,
          text: textFields.text,
          sanitizedText: textFields.sanitizedText,
          transcript: textFields.transcript,
          sanitizedTranscript: textFields.sanitizedTranscript,
          mediaStorageKey: input.mediaStorageKey ?? null,
          mediaMimeType: input.mediaMimeType ?? null,
          captionText: input.captionText ?? null,
          privacyPolicyVersion: textFields.privacyPolicyVersion,
          retentionExpiresAt: textFields.retentionExpiresAt ? new Date(textFields.retentionExpiresAt) : null,
          respondsToMessageId: input.respondsToMessageId ?? null,
          occurredAt: input.occurredAt,
          processedAt: input.processedAt ?? null,
        });
        const insertedId = Number((inserted as { insertId?: number }).insertId ?? 0);

        const [created] = await db
          .select()
          .from(whatsappConversationMessages)
          .where(eq(whatsappConversationMessages.id, insertedId))
          .limit(1);

        return created ?? null;
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          const existing = await this.findByIdempotencyKey(idempotencyKey);
          if (existing) return existing;
        }
        deps.onWarning("WhatsApp conversation message append skipped", error);
        return null;
      }
    },

    async findByIdempotencyKey(idempotencyKey) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const [row] = await db
          .select()
          .from(whatsappConversationMessages)
          .where(eq(whatsappConversationMessages.idempotencyKey, idempotencyKey))
          .limit(1);
        return row ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp conversation message lookup by idempotency key skipped", error);
        return null;
      }
    },

    async linkResponse(inboundMessageId, outboundMessageId) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(whatsappConversationMessages)
          .set({ respondsToMessageId: inboundMessageId })
          .where(eq(whatsappConversationMessages.id, outboundMessageId));
      } catch (error) {
        deps.onWarning("WhatsApp conversation message response link skipped", error);
      }
    },

    async linkDomainRecord(messageId, link) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db.insert(whatsappMessageDomainLinks).values({
          messageId,
          mealId: link.mealId ?? null,
          mealItemId: link.mealItemId ?? null,
          waterLogId: link.waterLogId ?? null,
          weightEntryId: link.weightEntryId ?? null,
          exerciseId: link.exerciseId ?? null,
        });
      } catch (error) {
        deps.onWarning("WhatsApp conversation domain link skipped", error);
      }
    },

    async findRecentMessages(conversationId, limit = 20) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        const rows = await db
          .select()
          .from(whatsappConversationMessages)
          .where(eq(whatsappConversationMessages.conversationId, conversationId))
          .orderBy(desc(whatsappConversationMessages.occurredAt), desc(whatsappConversationMessages.id))
          .limit(limit);
        return [...rows].reverse();
      } catch (error) {
        deps.onWarning("WhatsApp conversation recent messages read skipped", error);
        return [];
      }
    },

    async findRecentMessagesByUser(userId, limit = 20) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        const rows = await db
          .select()
          .from(whatsappConversationMessages)
          .where(eq(whatsappConversationMessages.userId, userId))
          .orderBy(desc(whatsappConversationMessages.occurredAt), desc(whatsappConversationMessages.id))
          .limit(limit);
        return [...rows].reverse();
      } catch (error) {
        deps.onWarning("WhatsApp conversation recent messages by user read skipped", error);
        return [];
      }
    },

    async findDomainLinksForMessage(messageId) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        return await db
          .select()
          .from(whatsappMessageDomainLinks)
          .where(eq(whatsappMessageDomainLinks.messageId, messageId))
          .orderBy(asc(whatsappMessageDomainLinks.id));
      } catch (error) {
        deps.onWarning("WhatsApp conversation domain link read skipped", error);
        return [];
      }
    },

    async markProcessed(messageId, processedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        await db
          .update(whatsappConversationMessages)
          .set({ processedAt })
          .where(eq(whatsappConversationMessages.id, messageId));
      } catch (error) {
        deps.onWarning("WhatsApp conversation message mark-processed skipped", error);
      }
    },
  };
}
