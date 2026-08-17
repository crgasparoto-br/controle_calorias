import { and, eq, isNull, lt } from "drizzle-orm";
import { whatsappConversationMessages } from "../../drizzle/schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WhatsAppProcessingClaimRepository = {
  claimStaleUnprocessedMessage(messageId: number, staleBefore: Date, claimedAt?: Date): Promise<boolean>;
};

function getAffectedRows(result: unknown) {
  if (Array.isArray(result)) {
    for (const entry of result) {
      if (entry && typeof entry === "object" && "affectedRows" in entry) {
        return Number((entry as { affectedRows?: unknown }).affectedRows ?? 0);
      }
    }
  }
  if (result && typeof result === "object" && "affectedRows" in result) {
    return Number((result as { affectedRows?: unknown }).affectedRows ?? 0);
  }
  return 0;
}

export function createDrizzleWhatsAppProcessingClaimRepository(deps: {
  getDb: DbProvider;
  onWarning: PersistenceWarningHandler;
}): WhatsAppProcessingClaimRepository {
  return {
    async claimStaleUnprocessedMessage(messageId, staleBefore, claimedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .update(whatsappConversationMessages)
          .set({ updatedAt: claimedAt })
          .where(and(
            eq(whatsappConversationMessages.id, messageId),
            isNull(whatsappConversationMessages.processedAt),
            lt(whatsappConversationMessages.updatedAt, staleBefore),
          ));
        return getAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation stale message claim skipped", error);
        return false;
      }
    },
  };
}
