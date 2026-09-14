import { and, asc, eq, gte, isNotNull, isNull, sql } from "drizzle-orm";
import {
  whatsappConversationMessages,
  whatsappConversations,
} from "../../drizzle/schema";
import { whatsappMessageProcessingClaims } from "../../drizzle/whatsapp-processing-schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type RecoverableWhatsappQuestion = {
  messageId: number;
  conversationId: number;
  userId: number;
  phoneNumber: string;
  externalMessageId: string;
  text: string;
  occurredAt: Date;
  processingHeartbeatAt: Date | null;
};

export type WhatsAppQuestionRecoveryRepository = {
  findRecoverableQuestions(input: {
    now?: Date;
    horizonMs: number;
    limit: number;
  }): Promise<RecoverableWhatsappQuestion[]>;
};

export function createDrizzleWhatsAppQuestionRecoveryRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppQuestionRecoveryRepository {
  return {
    async findRecoverableQuestions({ now = new Date(), horizonMs, limit }) {
      const db = await deps.getDb();
      if (!db) return [];

      const safeLimit = Math.max(1, Math.min(Math.trunc(limit || 1), 50));
      const safeHorizonMs = Math.max(60_000, horizonMs);
      const notBefore = new Date(now.getTime() - safeHorizonMs);

      try {
        const rows = await db
          .select({
            messageId: whatsappConversationMessages.id,
            conversationId: whatsappConversationMessages.conversationId,
            userId: whatsappConversationMessages.userId,
            phoneNumber: whatsappConversations.phoneNumber,
            externalMessageId: whatsappConversationMessages.externalMessageId,
            text: whatsappConversationMessages.sanitizedText,
            occurredAt: whatsappConversationMessages.occurredAt,
            processingHeartbeatAt: whatsappMessageProcessingClaims.heartbeatAt,
          })
          .from(whatsappConversationMessages)
          .innerJoin(
            whatsappConversations,
            eq(
              whatsappConversations.id,
              whatsappConversationMessages.conversationId,
            ),
          )
          .leftJoin(
            whatsappMessageProcessingClaims,
            eq(
              whatsappMessageProcessingClaims.messageId,
              whatsappConversationMessages.id,
            ),
          )
          .where(and(
            eq(whatsappConversationMessages.direction, "inbound"),
            eq(whatsappConversationMessages.contentType, "text"),
            isNull(whatsappConversationMessages.processedAt),
            isNotNull(whatsappConversationMessages.externalMessageId),
            isNotNull(whatsappConversationMessages.sanitizedText),
            // O timestamp do evento Meta pode ser anterior ao recebimento real.
            // A janela de recovery mede quando o inbound foi persistido neste
            // runtime, que é o sinal correto para decidir se o trabalho órfão
            // ainda pertence à conversa ativa atual.
            gte(whatsappConversationMessages.createdAt, notBefore),
            sql`TRIM(${whatsappConversationMessages.sanitizedText}) LIKE '/%'`,
          ))
          .orderBy(
            asc(whatsappConversationMessages.createdAt),
            asc(whatsappConversationMessages.id),
          )
          .limit(safeLimit);

        return rows.flatMap((row: typeof rows[number]) => {
          const externalMessageId = row.externalMessageId?.trim();
          const text = row.text?.trim();
          const phoneNumber = row.phoneNumber?.trim();
          if (!externalMessageId || !text?.startsWith("/") || !phoneNumber) return [];
          return [{
            messageId: row.messageId,
            conversationId: row.conversationId,
            userId: row.userId,
            phoneNumber,
            externalMessageId,
            text,
            occurredAt: row.occurredAt,
            processingHeartbeatAt: row.processingHeartbeatAt ?? null,
          }];
        });
      } catch (error) {
        deps.onWarning("WhatsApp question recovery candidate lookup skipped", error);
        return [];
      }
    },
  };
}
