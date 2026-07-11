import crypto from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull, lt, or } from "drizzle-orm";
import {
  whatsappConversationMessages,
  whatsappConversations,
  whatsappConversationSummaries,
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
export type WhatsAppConversationSummaryRecord = typeof whatsappConversationSummaries.$inferSelect;

export type InsertConversationSummaryInput = {
  userId: number;
  conversationId: number;
  summaryText: string;
  fromMessageId: number;
  toMessageId: number;
  promptVersion: string;
  algorithmVersion: string;
};

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

export type AppendMessageResult = {
  message: WhatsAppConversationMessageRecord;
  /** false quando a mensagem já existia (reentrega do mesmo externalMessageId) — issue #767. */
  wasNewInsert: boolean;
};

export type WhatsAppConversationRepository = {
  createOrGetActiveConversation(
    userId: number,
    whatsappConnectionId: number | null,
    phoneNumber: string,
    now?: Date,
  ): Promise<WhatsAppConversationRecord | null>;
  appendMessage(input: AppendMessageInput): Promise<AppendMessageResult | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<WhatsAppConversationMessageRecord | null>;
  linkResponse(inboundMessageId: number, outboundMessageId: number): Promise<void>;
  linkDomainRecord(messageId: number, link: DomainLinkInput): Promise<void>;
  findRecentMessages(conversationId: number, limit?: number): Promise<WhatsAppConversationMessageRecord[]>;
  findRecentMessagesByUser(userId: number, limit?: number): Promise<WhatsAppConversationMessageRecord[]>;
  /** Paginação por cursor para histórico volumoso (issue #767) — ordem cronológica decrescente. */
  findMessagesBefore(
    conversationId: number,
    beforeOccurredAt: Date,
    beforeId: number,
    limit?: number,
  ): Promise<WhatsAppConversationMessageRecord[]>;
  findDomainLinksForMessage(messageId: number): Promise<WhatsAppMessageDomainLinkRecord[]>;
  markProcessed(messageId: number, processedAt?: Date): Promise<void>;
  insertConversationSummary(input: InsertConversationSummaryInput): Promise<void>;
  findLatestConversationSummary(conversationId: number): Promise<WhatsAppConversationSummaryRecord | null>;
  /** Retenção (issue #767): zera texto/transcript bruto cujo retentionExpiresAt já passou. Retorna quantas linhas foram afetadas. */
  purgeExpiredRawText(now?: Date): Promise<number>;
  /** Retenção: zera texto/transcript sanitizado de mensagens mais antigas que `operationalDays`. */
  purgeExpiredSanitizedText(operationalDays: number, now?: Date): Promise<number>;
  /** Retenção: apaga a linha inteira quando bruto e sanitizado já estão nulos e `auditDays` já passaram (nunca toca refeições/água/peso). */
  purgeExpiredAuditRows(auditDays: number, now?: Date): Promise<number>;
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

function getMysqlAffectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const affectedRows = Number((candidate as { affectedRows?: number })?.affectedRows ?? 0);
  return Number.isFinite(affectedRows) ? affectedRows : 0;
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
          // CAS (issue #767): evita que duas requisições concorrentes do mesmo usuário
          // corrompam lastActivityAt/version com um UPDATE cego. Uma corrida perdida aqui
          // não é um erro — a outra requisição já tocou lastActivityAt, o que é suficiente.
          const result = await db
            .update(whatsappConversations)
            .set({ lastActivityAt: now, version: existing.version + 1 })
            .where(and(eq(whatsappConversations.id, existing.id), eq(whatsappConversations.version, existing.version)));
          if (getMysqlAffectedRows(result) === 0) {
            const [reread] = await db
              .select()
              .from(whatsappConversations)
              .where(eq(whatsappConversations.id, existing.id))
              .limit(1);
            return reread ?? { ...existing, lastActivityAt: now };
          }
          return { ...existing, lastActivityAt: now, version: existing.version + 1 };
        }

        if (existing && existing.status === "active") {
          await db
            .update(whatsappConversations)
            .set({ status: "expired", endedAt: now, version: existing.version + 1 })
            .where(and(eq(whatsappConversations.id, existing.id), eq(whatsappConversations.version, existing.version)));
        }

        const inserted = await db.insert(whatsappConversations).values({
          userId,
          whatsappConnectionId,
          phoneNumber,
          status: "active",
          startedAt: now,
          lastActivityAt: now,
          version: 0,
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

        return created ? { message: created, wasNewInsert: true } : null;
      } catch (error) {
        if (isDuplicateEntryError(error)) {
          const existing = await this.findByIdempotencyKey(idempotencyKey);
          if (existing) return { message: existing, wasNewInsert: false };
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

    async findMessagesBefore(conversationId, beforeOccurredAt, beforeId, limit = 20) {
      const db = await deps.getDb();
      if (!db) return [];

      try {
        const rows = await db
          .select()
          .from(whatsappConversationMessages)
          .where(and(
            eq(whatsappConversationMessages.conversationId, conversationId),
            or(
              lt(whatsappConversationMessages.occurredAt, beforeOccurredAt),
              and(eq(whatsappConversationMessages.occurredAt, beforeOccurredAt), lt(whatsappConversationMessages.id, beforeId)),
            ),
          ))
          .orderBy(desc(whatsappConversationMessages.occurredAt), desc(whatsappConversationMessages.id))
          .limit(limit);
        return [...rows].reverse();
      } catch (error) {
        deps.onWarning("WhatsApp conversation cursor page read skipped", error);
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

    async insertConversationSummary(input) {
      const db = await deps.getDb();
      if (!db) return;

      try {
        // Fast-path (issue #767): se outra chamada já resumiu uma faixa mais avançada desta
        // conversa, esta é redundante — evita trabalho, mas não é a garantia de correção
        // (essa vem da restrição de unicidade abaixo, não deste check-then-act).
        const [latest] = await db
          .select()
          .from(whatsappConversationSummaries)
          .where(eq(whatsappConversationSummaries.conversationId, input.conversationId))
          .orderBy(desc(whatsappConversationSummaries.id))
          .limit(1);
        if (latest && latest.toMessageId !== null && latest.toMessageId >= input.toMessageId) {
          return;
        }

        try {
          await db.insert(whatsappConversationSummaries).values({
            userId: input.userId,
            conversationId: input.conversationId,
            summaryText: input.summaryText,
            fromMessageId: input.fromMessageId,
            toMessageId: input.toMessageId,
            promptVersion: input.promptVersion,
            algorithmVersion: input.algorithmVersion,
          });
        } catch (insertError) {
          if (isDuplicateEntryError(insertError)) {
            // Corrida de regeneração concorrente (issue #767): outra chamada já inseriu um
            // resumo para exatamente esta faixa (conversationId+toMessageId) — restrição de
            // banco, não lock em memória. Perdedor não escreve, não é um erro.
            return;
          }
          throw insertError;
        }

        // Retenção (issue #767): mantém só o resumo mais recente por conversa — o anterior
        // é imediatamente superado, não expira por tempo.
        if (latest) {
          await db.delete(whatsappConversationSummaries).where(eq(whatsappConversationSummaries.id, latest.id));
        }
      } catch (error) {
        deps.onWarning("WhatsApp conversation summary insert skipped", error);
      }
    },

    async findLatestConversationSummary(conversationId) {
      const db = await deps.getDb();
      if (!db) return null;

      try {
        const [row] = await db
          .select()
          .from(whatsappConversationSummaries)
          .where(eq(whatsappConversationSummaries.conversationId, conversationId))
          .orderBy(desc(whatsappConversationSummaries.id))
          .limit(1);
        return row ?? null;
      } catch (error) {
        deps.onWarning("WhatsApp conversation summary read skipped", error);
        return null;
      }
    },

    async purgeExpiredRawText(now = new Date()) {
      const db = await deps.getDb();
      if (!db) return 0;

      try {
        const result = await db
          .update(whatsappConversationMessages)
          .set({ text: null, transcript: null })
          .where(and(
            lt(whatsappConversationMessages.retentionExpiresAt, now),
            or(isNotNull(whatsappConversationMessages.text), isNotNull(whatsappConversationMessages.transcript)),
          ));
        return getMysqlAffectedRows(result);
      } catch (error) {
        deps.onWarning("WhatsApp conversation raw text purge skipped", error);
        return 0;
      }
    },

    async purgeExpiredSanitizedText(operationalDays, now = new Date()) {
      const db = await deps.getDb();
      if (!db) return 0;

      const cutoff = new Date(now.getTime() - operationalDays * 24 * 60 * 60 * 1000);
      try {
        const result = await db
          .update(whatsappConversationMessages)
          .set({ sanitizedText: null, sanitizedTranscript: null })
          .where(and(
            lt(whatsappConversationMessages.occurredAt, cutoff),
            or(isNotNull(whatsappConversationMessages.sanitizedText), isNotNull(whatsappConversationMessages.sanitizedTranscript)),
          ));
        return getMysqlAffectedRows(result);
      } catch (error) {
        deps.onWarning("WhatsApp conversation sanitized text purge skipped", error);
        return 0;
      }
    },

    async purgeExpiredAuditRows(auditDays, now = new Date()) {
      const db = await deps.getDb();
      if (!db) return 0;

      const cutoff = new Date(now.getTime() - auditDays * 24 * 60 * 60 * 1000);
      try {
        const result = await db
          .delete(whatsappConversationMessages)
          .where(and(
            lt(whatsappConversationMessages.occurredAt, cutoff),
            isNull(whatsappConversationMessages.text),
            isNull(whatsappConversationMessages.transcript),
            isNull(whatsappConversationMessages.sanitizedText),
            isNull(whatsappConversationMessages.sanitizedTranscript),
          ));
        return getMysqlAffectedRows(result);
      } catch (error) {
        deps.onWarning("WhatsApp conversation audit row purge skipped", error);
        return 0;
      }
    },
  };
}
