import {
  boolean,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { users } from "./schema";

export const professionalProfiles = mysqlTable(
  "professionalProfiles",
  {
    userId: int("userId")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: varchar("displayName", { length: 255 }).notNull(),
    registrationNumber: varchar("registrationNumber", { length: 120 }),
    active: boolean("active").default(false).notNull(),
    sourceUpdatedAt: timestamp("sourceUpdatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    activeIdx: index("professionalProfiles_active_idx").on(table.active),
  })
);

export const professionalPatientAuthorizations = mysqlTable(
  "professionalPatientAuthorizations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", [
      "pending",
      "approved",
      "rejected",
      "revoked",
    ]).notNull(),
    activePairKey: varchar("activePairKey", { length: 64 }),
    reason: text("reason").notNull(),
    requestedAt: timestamp("requestedAt").notNull(),
    approvedAt: timestamp("approvedAt"),
    rejectedAt: timestamp("rejectedAt"),
    revokedAt: timestamp("revokedAt"),
    respondedAt: timestamp("respondedAt"),
    responseOrigin: mysqlEnum("responseOrigin", ["web", "whatsapp"]),
    responseDecision: mysqlEnum("responseDecision", [
      "approved",
      "rejected",
      "revoked",
    ]),
    authorizationMessageStatus: mysqlEnum("authorizationMessageStatus", [
      "sent",
      "failed",
      "skipped",
    ]),
    authorizationMessageSentAt: timestamp("authorizationMessageSentAt"),
    authorizationMessageError: varchar("authorizationMessageError", {
      length: 500,
    }),
    sourceUpdatedAt: timestamp("sourceUpdatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    professionalStatusIdx: index(
      "professionalAuthorizations_professional_status_idx"
    ).on(table.professionalUserId, table.status),
    patientStatusIdx: index("professionalAuthorizations_patient_status_idx").on(
      table.patientUserId,
      table.status
    ),
    pairIdx: index("professionalAuthorizations_pair_idx").on(
      table.professionalUserId,
      table.patientUserId
    ),
    activePairUniqueIdx: uniqueIndex(
      "professionalAuthorizations_active_pair_unique_idx"
    ).on(table.activePairKey),
  })
);

export const professionalPatientTrackings = mysqlTable(
  "professionalPatientTrackings",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    authorizationId: varchar("authorizationId", { length: 64 })
      .notNull()
      .references(() => professionalPatientAuthorizations.id, {
        onDelete: "cascade",
      }),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: mysqlEnum("status", ["active", "paused", "ended"])
      .default("active")
      .notNull(),
    startedAt: timestamp("startedAt").notNull(),
    pausedAt: timestamp("pausedAt"),
    endedAt: timestamp("endedAt"),
    lastTransitionAt: timestamp("lastTransitionAt").notNull(),
    lastTransitionByUserId: int("lastTransitionByUserId").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    lastTransitionReason: text("lastTransitionReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    authorizationUniqueIdx: uniqueIndex(
      "professionalTrackings_authorization_unique_idx"
    ).on(table.authorizationId),
    professionalStatusIdx: index(
      "professionalTrackings_professional_status_idx"
    ).on(table.professionalUserId, table.status),
    patientStatusIdx: index("professionalTrackings_patient_status_idx").on(
      table.patientUserId,
      table.status
    ),
  })
);

export const professionalPatientTrackingEvents = mysqlTable(
  "professionalPatientTrackingEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    trackingId: varchar("trackingId", { length: 64 })
      .notNull()
      .references(() => professionalPatientTrackings.id, {
        onDelete: "cascade",
      }),
    authorizationId: varchar("authorizationId", { length: 64 })
      .notNull()
      .references(() => professionalPatientAuthorizations.id, {
        onDelete: "cascade",
      }),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    fromStatus: mysqlEnum("fromStatus", ["active", "paused", "ended"]),
    toStatus: mysqlEnum("toStatus", ["active", "paused", "ended"]).notNull(),
    reason: text("reason"),
    occurredAt: timestamp("occurredAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    trackingOccurredIdx: index(
      "professionalTrackingEvents_tracking_occurred_idx"
    ).on(table.trackingId, table.occurredAt),
    authorizationOccurredIdx: index(
      "professionalTrackingEvents_authorization_occurred_idx"
    ).on(table.authorizationId, table.occurredAt),
    actorOccurredIdx: index("professionalTrackingEvents_actor_occurred_idx").on(
      table.actorUserId,
      table.occurredAt
    ),
  })
);

export const professionalComments = mysqlTable(
  "professionalComments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    comment: text("comment").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    professionalPatientCreatedIdx: index(
      "professionalComments_pair_created_idx"
    ).on(
      table.professionalUserId,
      table.patientUserId,
      table.createdAt,
      table.id
    ),
    patientCreatedIdx: index("professionalComments_patient_created_idx").on(
      table.patientUserId,
      table.createdAt,
      table.id
    ),
  })
);

export const professionalGoalSuggestions = mysqlTable(
  "professionalGoalSuggestions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    rationale: text("rationale").notNull(),
    status: mysqlEnum("status", [
      "draft",
      "sent",
      "accepted",
      "refused",
      "cancelled",
    ]).notNull(),
    goal: json("goal").notNull(),
    version: int("version").default(1).notNull(),
    decisionLockId: varchar("decisionLockId", { length: 64 }),
    decisionLockedAt: timestamp("decisionLockedAt"),
    createdAt: timestamp("createdAt").notNull(),
    sentAt: timestamp("sentAt"),
    respondedAt: timestamp("respondedAt"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    professionalPatientCreatedIdx: index(
      "professionalGoalSuggestions_pair_created_idx"
    ).on(
      table.professionalUserId,
      table.patientUserId,
      table.createdAt,
      table.id
    ),
    patientStatusCreatedIdx: index(
      "professionalGoalSuggestions_patient_status_created_idx"
    ).on(table.patientUserId, table.status, table.createdAt, table.id),
  })
);

export const professionalMealSuggestions = mysqlTable(
  "professionalMealSuggestions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mealLabel: varchar("mealLabel", { length: 80 }).notNull(),
    title: varchar("title", { length: 120 }).notNull(),
    description: text("description").notNull(),
    rationale: text("rationale").notNull(),
    notes: text("notes"),
    status: mysqlEnum("status", [
      "draft",
      "sent",
      "accepted",
      "refused",
      "cancelled",
    ]).notNull(),
    version: int("version").default(1).notNull(),
    createdAt: timestamp("createdAt").notNull(),
    sentAt: timestamp("sentAt"),
    respondedAt: timestamp("respondedAt"),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    professionalPatientCreatedIdx: index(
      "professionalMealSuggestions_pair_created_idx"
    ).on(
      table.professionalUserId,
      table.patientUserId,
      table.createdAt,
      table.id
    ),
    patientStatusCreatedIdx: index(
      "professionalMealSuggestions_patient_status_created_idx"
    ).on(table.patientUserId, table.status, table.createdAt, table.id),
  })
);

export const professionalHistoryEvents = mysqlTable(
  "professionalHistoryEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId").references(() => users.id, {
      onDelete: "cascade",
    }),
    eventType: varchar("eventType", { length: 80 }).notNull(),
    entityType: varchar("entityType", { length: 80 }),
    entityId: varchar("entityId", { length: 64 }),
    occurredAt: timestamp("occurredAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    professionalOccurredIdx: index(
      "professionalHistory_professional_occurred_idx"
    ).on(table.professionalUserId, table.occurredAt, table.id),
    patientOccurredIdx: index("professionalHistory_patient_occurred_idx").on(
      table.patientUserId,
      table.occurredAt,
      table.id
    ),
    entityIdx: index("professionalHistory_entity_idx").on(
      table.entityType,
      table.entityId
    ),
  })
);

export type ProfessionalProfileRecord =
  typeof professionalProfiles.$inferSelect;
export type InsertProfessionalProfileRecord =
  typeof professionalProfiles.$inferInsert;
export type ProfessionalPatientAuthorizationRecord =
  typeof professionalPatientAuthorizations.$inferSelect;
export type InsertProfessionalPatientAuthorizationRecord =
  typeof professionalPatientAuthorizations.$inferInsert;
export type ProfessionalPatientTrackingRecord =
  typeof professionalPatientTrackings.$inferSelect;
export type InsertProfessionalPatientTrackingRecord =
  typeof professionalPatientTrackings.$inferInsert;
export type ProfessionalPatientTrackingEventRecord =
  typeof professionalPatientTrackingEvents.$inferSelect;
export type InsertProfessionalPatientTrackingEventRecord =
  typeof professionalPatientTrackingEvents.$inferInsert;

export type ProfessionalCommentRecord =
  typeof professionalComments.$inferSelect;
export type InsertProfessionalCommentRecord =
  typeof professionalComments.$inferInsert;
export type ProfessionalGoalSuggestionRecord =
  typeof professionalGoalSuggestions.$inferSelect;
export type InsertProfessionalGoalSuggestionRecord =
  typeof professionalGoalSuggestions.$inferInsert;
export type ProfessionalMealSuggestionRecord =
  typeof professionalMealSuggestions.$inferSelect;
export type InsertProfessionalMealSuggestionRecord =
  typeof professionalMealSuggestions.$inferInsert;
export type ProfessionalHistoryEventRecord =
  typeof professionalHistoryEvents.$inferSelect;
export type InsertProfessionalHistoryEventRecord =
  typeof professionalHistoryEvents.$inferInsert;
