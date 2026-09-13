import { and, eq, isNull, lt } from "drizzle-orm";
import { whatsappConversationMessages } from "../../drizzle/schema";
import { whatsappMessageProcessingClaims } from "../../drizzle/whatsapp-processing-schema";

type DbProvider = () => Promise<any | null>;
type PersistenceWarningHandler = (scope: string, error: unknown) => void;

export type WhatsAppProcessingClaimState =
  | "claimed"
  | "recovered"
  | "inflight"
  | "processed"
  | "unavailable";

export type WhatsAppProcessingClaimDecision = {
  state: WhatsAppProcessingClaimState;
  ownerToken?: string;
  heartbeatAt?: Date | null;
};

export type WhatsAppProcessingClaimRepository = {
  /** Compatibilidade com o lease anterior. O lifecycle novo prefere claimUnprocessedMessage. */
  claimStaleUnprocessedMessage(messageId: number, staleBefore: Date, claimedAt?: Date): Promise<boolean>;
  releaseUnprocessedMessage?(messageId: number, releasedAt: Date): Promise<boolean>;
  claimUnprocessedMessage?(
    messageId: number,
    ownerToken: string,
    staleBefore: Date,
    claimedAt?: Date,
  ): Promise<WhatsAppProcessingClaimDecision>;
  heartbeatOwnedUnprocessedMessage?(
    messageId: number,
    ownerToken: string,
    heartbeatAt?: Date,
  ): Promise<boolean>;
  releaseOwnedUnprocessedMessage?(messageId: number, ownerToken: string): Promise<boolean>;
  completeOwnedMessageClaim?(messageId: number, ownerToken: string): Promise<boolean>;
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

function isDuplicateKeyError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; errno?: unknown; cause?: unknown };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062 || candidate.code === 1062) return true;
    current = candidate.cause;
  }
  return false;
}

async function readMessageProcessingState(db: any, messageId: number) {
  const rows = await db
    .select({ processedAt: whatsappConversationMessages.processedAt })
    .from(whatsappConversationMessages)
    .where(eq(whatsappConversationMessages.id, messageId))
    .limit(1);
  if (!rows[0]) return "missing" as const;
  return rows[0].processedAt ? "processed" as const : "unprocessed" as const;
}

async function readClaim(db: any, messageId: number) {
  const rows = await db
    .select({
      ownerToken: whatsappMessageProcessingClaims.ownerToken,
      heartbeatAt: whatsappMessageProcessingClaims.heartbeatAt,
    })
    .from(whatsappMessageProcessingClaims)
    .where(eq(whatsappMessageProcessingClaims.messageId, messageId))
    .limit(1);
  return rows[0] ?? null;
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

    async releaseUnprocessedMessage(messageId, releasedAt) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .update(whatsappConversationMessages)
          .set({ updatedAt: releasedAt })
          .where(and(
            eq(whatsappConversationMessages.id, messageId),
            isNull(whatsappConversationMessages.processedAt),
          ));
        return getAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation processing claim release skipped", error);
        return false;
      }
    },

    async claimUnprocessedMessage(messageId, ownerToken, staleBefore, claimedAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return { state: "unavailable" };

      try {
        const messageState = await readMessageProcessingState(db, messageId);
        if (messageState === "processed") return { state: "processed" };
        if (messageState === "missing") return { state: "unavailable" };

        try {
          await db.insert(whatsappMessageProcessingClaims).values({
            messageId,
            ownerToken,
            claimedAt,
            heartbeatAt: claimedAt,
          });
          const stateAfterInsert = await readMessageProcessingState(db, messageId);
          if (stateAfterInsert === "processed") {
            await db.delete(whatsappMessageProcessingClaims).where(and(
              eq(whatsappMessageProcessingClaims.messageId, messageId),
              eq(whatsappMessageProcessingClaims.ownerToken, ownerToken),
            ));
            return { state: "processed" };
          }
          return { state: "claimed", ownerToken, heartbeatAt: claimedAt };
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }

        const takeover = await db
          .update(whatsappMessageProcessingClaims)
          .set({ ownerToken, claimedAt, heartbeatAt: claimedAt })
          .where(and(
            eq(whatsappMessageProcessingClaims.messageId, messageId),
            lt(whatsappMessageProcessingClaims.heartbeatAt, staleBefore),
          ));

        if (getAffectedRows(takeover) > 0) {
          const stateAfterTakeover = await readMessageProcessingState(db, messageId);
          if (stateAfterTakeover === "processed") {
            await db.delete(whatsappMessageProcessingClaims).where(and(
              eq(whatsappMessageProcessingClaims.messageId, messageId),
              eq(whatsappMessageProcessingClaims.ownerToken, ownerToken),
            ));
            return { state: "processed" };
          }
          return { state: "recovered", ownerToken, heartbeatAt: claimedAt };
        }

        const stateAfterConflict = await readMessageProcessingState(db, messageId);
        if (stateAfterConflict === "processed") return { state: "processed" };
        if (stateAfterConflict === "missing") return { state: "unavailable" };
        const activeClaim = await readClaim(db, messageId);
        return {
          state: "inflight",
          heartbeatAt: activeClaim?.heartbeatAt ?? null,
        };
      } catch (error) {
        deps.onWarning("WhatsApp conversation processing owner claim skipped", error);
        return { state: "unavailable" };
      }
    },

    async heartbeatOwnedUnprocessedMessage(messageId, ownerToken, heartbeatAt = new Date()) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .update(whatsappMessageProcessingClaims)
          .set({ heartbeatAt })
          .where(and(
            eq(whatsappMessageProcessingClaims.messageId, messageId),
            eq(whatsappMessageProcessingClaims.ownerToken, ownerToken),
          ));
        return getAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation processing owner heartbeat skipped", error);
        return false;
      }
    },

    async releaseOwnedUnprocessedMessage(messageId, ownerToken) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .delete(whatsappMessageProcessingClaims)
          .where(and(
            eq(whatsappMessageProcessingClaims.messageId, messageId),
            eq(whatsappMessageProcessingClaims.ownerToken, ownerToken),
          ));
        return getAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation processing owner release skipped", error);
        return false;
      }
    },

    async completeOwnedMessageClaim(messageId, ownerToken) {
      const db = await deps.getDb();
      if (!db) return false;

      try {
        const result = await db
          .delete(whatsappMessageProcessingClaims)
          .where(and(
            eq(whatsappMessageProcessingClaims.messageId, messageId),
            eq(whatsappMessageProcessingClaims.ownerToken, ownerToken),
          ));
        return getAffectedRows(result) > 0;
      } catch (error) {
        deps.onWarning("WhatsApp conversation processing owner completion skipped", error);
        return false;
      }
    },
  };
}
