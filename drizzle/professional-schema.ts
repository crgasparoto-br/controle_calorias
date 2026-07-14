import {
  boolean,
  index,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";

export const professionalProfiles = mysqlTable("professionalProfiles", {
  userId: int("userId").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  displayName: varchar("displayName", { length: 255 }).notNull(),
  registrationNumber: varchar("registrationNumber", { length: 120 }),
  active: boolean("active").default(false).notNull(),
  sourceUpdatedAt: timestamp("sourceUpdatedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  activeIdx: index("professionalProfiles_active_idx").on(table.active),
}));

export const professionalPatientAuthorizations = mysqlTable("professionalPatientAuthorizations", {
  id: varchar("id", { length: 64 }).primaryKey(),
  professionalUserId: int("professionalUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  patientUserId: int("patientUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["pending", "approved", "rejected", "revoked"]).notNull(),
  activePairKey: varchar("activePairKey", { length: 64 }),
  reason: text("reason").notNull(),
  requestedAt: timestamp("requestedAt").notNull(),
  approvedAt: timestamp("approvedAt"),
  rejectedAt: timestamp("rejectedAt"),
  revokedAt: timestamp("revokedAt"),
  respondedAt: timestamp("respondedAt"),
  responseOrigin: mysqlEnum("responseOrigin", ["web", "whatsapp"]),
  responseDecision: mysqlEnum("responseDecision", ["approved", "rejected", "revoked"]),
  authorizationMessageStatus: mysqlEnum("authorizationMessageStatus", ["sent", "failed", "skipped"]),
  authorizationMessageSentAt: timestamp("authorizationMessageSentAt"),
  authorizationMessageError: varchar("authorizationMessageError", { length: 500 }),
  sourceUpdatedAt: timestamp("sourceUpdatedAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  professionalStatusIdx: index("professionalAuthorizations_professional_status_idx").on(table.professionalUserId, table.status),
  patientStatusIdx: index("professionalAuthorizations_patient_status_idx").on(table.patientUserId, table.status),
  pairIdx: index("professionalAuthorizations_pair_idx").on(table.professionalUserId, table.patientUserId),
  activePairUniqueIdx: uniqueIndex("professionalAuthorizations_active_pair_unique_idx").on(table.activePairKey),
}));

export const professionalPatientTrackings = mysqlTable("professionalPatientTrackings", {
  id: varchar("id", { length: 64 }).primaryKey(),
  authorizationId: varchar("authorizationId", { length: 64 }).notNull().references(
    () => professionalPatientAuthorizations.id,
    { onDelete: "cascade" },
  ),
  professionalUserId: int("professionalUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  patientUserId: int("patientUserId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["active", "paused", "ended"]).default("active").notNull(),
  startedAt: timestamp("startedAt").notNull(),
  pausedAt: timestamp("pausedAt"),
  endedAt: timestamp("endedAt"),
  lastTransitionAt: timestamp("lastTransitionAt").notNull(),
  lastTransitionByUserId: int("lastTransitionByUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  lastTransitionReason: text("lastTransitionReason"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, table => ({
  authorizationUniqueIdx: uniqueIndex("professionalTrackings_authorization_unique_idx").on(table.authorizationId),
  professionalStatusIdx: index("professionalTrackings_professional_status_idx").on(table.professionalUserId, table.status),
  patientStatusIdx: index("professionalTrackings_patient_status_idx").on(table.patientUserId, table.status),
}));

export const professionalPatientTrackingEvents = mysqlTable("professionalPatientTrackingEvents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  trackingId: varchar("trackingId", { length: 64 }).notNull().references(
    () => professionalPatientTrackings.id,
    { onDelete: "cascade" },
  ),
  authorizationId: varchar("authorizationId", { length: 64 }).notNull().references(
    () => professionalPatientAuthorizations.id,
    { onDelete: "cascade" },
  ),
  actorUserId: int("actorUserId").notNull().references(() => users.id, { onDelete: "restrict" }),
  fromStatus: mysqlEnum("fromStatus", ["active", "paused", "ended"]),
  toStatus: mysqlEnum("toStatus", ["active", "paused", "ended"]).notNull(),
  reason: text("reason"),
  occurredAt: timestamp("occurredAt").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  trackingOccurredIdx: index("professionalTrackingEvents_tracking_occurred_idx").on(table.trackingId, table.occurredAt),
  authorizationOccurredIdx: index("professionalTrackingEvents_authorization_occurred_idx").on(table.authorizationId, table.occurredAt),
  actorOccurredIdx: index("professionalTrackingEvents_actor_occurred_idx").on(table.actorUserId, table.occurredAt),
}));

export type ProfessionalProfileRecord = typeof professionalProfiles.$inferSelect;
export type InsertProfessionalProfileRecord = typeof professionalProfiles.$inferInsert;
export type ProfessionalPatientAuthorizationRecord = typeof professionalPatientAuthorizations.$inferSelect;
export type InsertProfessionalPatientAuthorizationRecord = typeof professionalPatientAuthorizations.$inferInsert;
export type ProfessionalPatientTrackingRecord = typeof professionalPatientTrackings.$inferSelect;
export type InsertProfessionalPatientTrackingRecord = typeof professionalPatientTrackings.$inferInsert;
export type ProfessionalPatientTrackingEventRecord = typeof professionalPatientTrackingEvents.$inferSelect;
export type InsertProfessionalPatientTrackingEventRecord = typeof professionalPatientTrackingEvents.$inferInsert;
