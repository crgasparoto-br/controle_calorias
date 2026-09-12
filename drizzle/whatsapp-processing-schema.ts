import { index, int, mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";
import { whatsappConversationMessages } from "./schema";

/**
 * Ownership persistente e efêmero do processamento de inbound do WhatsApp.
 *
 * A mensagem continua sendo a fonte de verdade para conclusão (`processedAt` e
 * resposta/domain link). Esta tabela só responde quem pode executar enquanto a
 * mensagem ainda está aberta. `ownerToken` impede que um runtime antigo renove
 * ou libere um claim que já foi retomado por outro runtime.
 */
export const whatsappMessageProcessingClaims = mysqlTable("whatsappMessageProcessingClaims", {
  messageId: int("messageId")
    .primaryKey()
    .references(() => whatsappConversationMessages.id, { onDelete: "cascade" }),
  ownerToken: varchar("ownerToken", { length: 64 }).notNull(),
  claimedAt: timestamp("claimedAt").defaultNow().notNull(),
  heartbeatAt: timestamp("heartbeatAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  heartbeatIdx: index("whatsappMessageProcessingClaims_heartbeatAt_idx").on(table.heartbeatAt),
}));

export type WhatsAppMessageProcessingClaim = typeof whatsappMessageProcessingClaims.$inferSelect;
