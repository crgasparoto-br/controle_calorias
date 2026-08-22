import {
  foreignKey,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { billingSubscriptionFacts } from "./billing-subscription-lifecycle-schema";
import { users } from "./schema";

export const billingNotificationReceipts = mysqlTable(
  "billingNotificationReceipts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId").notNull(),
    sourceFactId: varchar("sourceFactId", { length: 64 }).notNull(),
    readAt: timestamp("readAt"),
    lastDeliveryChannel: mysqlEnum("lastDeliveryChannel", ["email", "whatsapp"]),
    lastDeliveryState: mysqlEnum("lastDeliveryState", [
      "not_attempted",
      "pending",
      "delivered",
      "failed",
    ])
      .default("not_attempted")
      .notNull(),
    lastDeliveryAt: timestamp("lastDeliveryAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userFk: foreignKey({
      columns: [table.userId],
      foreignColumns: [users.id],
      name: "billingNotificationReceipts_userId_fk",
    }).onDelete("cascade"),
    sourceFactFk: foreignKey({
      columns: [table.sourceFactId],
      foreignColumns: [billingSubscriptionFacts.id],
      name: "billingNotificationReceipts_sourceFactId_fk",
    }).onDelete("cascade"),
    userFactUniqueIdx: uniqueIndex("billingNotificationReceipts_user_fact_uq").on(
      table.userId,
      table.sourceFactId
    ),
    userReadIdx: index("billingNotificationReceipts_user_read_idx").on(
      table.userId,
      table.readAt,
      table.updatedAt
    ),
  })
);
