import {
  boolean,
  foreignKey,
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

export const professionalOfficialGoals = mysqlTable(
  "professionalOfficialGoals",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    authorizationId: varchar("authorizationId", { length: 64 }).notNull(),
    trackingId: varchar("trackingId", { length: 64 }).notNull(),
    professionalUserId: int("professionalUserId").notNull(),
    patientUserId: int("patientUserId").notNull(),
    activePatientKey: varchar("activePatientKey", { length: 64 }),
    version: int("version").notNull(),
    status: mysqlEnum("status", ["active", "superseded", "ended"])
      .default("active")
      .notNull(),
    calories: int("calories").notNull(),
    proteinGrams: int("proteinGrams").notNull(),
    carbsGrams: int("carbsGrams").notNull(),
    fatGrams: int("fatGrams").notNull(),
    exceptionsJson: json("exceptionsJson").notNull(),
    includeExerciseCalories: boolean("includeExerciseCalories")
      .default(true)
      .notNull(),
    effectiveFrom: timestamp("effectiveFrom").notNull(),
    effectiveUntil: timestamp("effectiveUntil"),
    justification: text("justification").notNull(),
    supersedesGoalId: varchar("supersedesGoalId", { length: 64 }),
    endedAt: timestamp("endedAt"),
    endReason: varchar("endReason", { length: 160 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    authorizationFk: foreignKey({
      columns: [table.authorizationId],
      foreignColumns: [professionalPatientAuthorizations.id],
      name: "professionalOfficialGoals_authorization_fk",
    }).onDelete("cascade"),
    trackingFk: foreignKey({
      columns: [table.trackingId],
      foreignColumns: [professionalPatientTrackings.id],
      name: "professionalOfficialGoals_tracking_fk",
    }).onDelete("cascade"),
    professionalFk: foreignKey({
      columns: [table.professionalUserId],
      foreignColumns: [users.id],
      name: "professionalOfficialGoals_professional_fk",
    }).onDelete("cascade"),
    patientFk: foreignKey({
      columns: [table.patientUserId],
      foreignColumns: [users.id],
      name: "professionalOfficialGoals_patient_fk",
    }).onDelete("cascade"),
    supersedesFk: foreignKey({
      columns: [table.supersedesGoalId],
      foreignColumns: [table.id],
      name: "professionalOfficialGoals_supersedes_fk",
    }).onDelete("set null"),
    activePatientUniqueIdx: uniqueIndex(
      "professionalOfficialGoals_active_patient_uq"
    ).on(table.activePatientKey),
    patientEffectiveIdx: index(
      "professionalOfficialGoals_patient_effective_idx"
    ).on(table.patientUserId, table.effectiveFrom, table.effectiveUntil),
    authorizationVersionUniqueIdx: uniqueIndex(
      "professionalOfficialGoals_authorization_version_uq"
    ).on(table.authorizationId, table.version),
  })
);

export const professionalGoalReviewRequests = mysqlTable(
  "professionalGoalReviewRequests",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    goalId: varchar("goalId", { length: 64 }).notNull(),
    professionalUserId: int("professionalUserId").notNull(),
    patientUserId: int("patientUserId").notNull(),
    openRequestKey: varchar("openRequestKey", { length: 128 }),
    reason: text("reason"),
    status: mysqlEnum("status", ["open", "resolved", "cancelled"])
      .default("open")
      .notNull(),
    resolvedByUserId: int("resolvedByUserId"),
    resolvedAt: timestamp("resolvedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    goalFk: foreignKey({
      columns: [table.goalId],
      foreignColumns: [professionalOfficialGoals.id],
      name: "professionalGoalReviewRequests_goal_fk",
    }).onDelete("cascade"),
    professionalFk: foreignKey({
      columns: [table.professionalUserId],
      foreignColumns: [users.id],
      name: "professionalGoalReviewRequests_professional_fk",
    }).onDelete("cascade"),
    patientFk: foreignKey({
      columns: [table.patientUserId],
      foreignColumns: [users.id],
      name: "professionalGoalReviewRequests_patient_fk",
    }).onDelete("cascade"),
    resolverFk: foreignKey({
      columns: [table.resolvedByUserId],
      foreignColumns: [users.id],
      name: "professionalGoalReviewRequests_resolver_fk",
    }).onDelete("set null"),
    openRequestUniqueIdx: uniqueIndex(
      "professionalGoalReviewRequests_open_uq"
    ).on(table.openRequestKey),
    professionalStatusIdx: index(
      "professionalGoalReviewRequests_professional_status_idx"
    ).on(table.professionalUserId, table.status, table.createdAt),
    patientStatusIdx: index(
      "professionalGoalReviewRequests_patient_status_idx"
    ).on(table.patientUserId, table.status, table.createdAt),
  })
);

export const professionalGoalNotifications = mysqlTable(
  "professionalGoalNotifications",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    goalId: varchar("goalId", { length: 64 }).notNull(),
    patientUserId: int("patientUserId").notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull(),
    channel: mysqlEnum("channel", ["whatsapp"]).default("whatsapp").notNull(),
    status: mysqlEnum("status", [
      "pending",
      "sending",
      "sent",
      "failed",
      "skipped",
    ])
      .default("pending")
      .notNull(),
    attempts: int("attempts").default(0).notNull(),
    claimToken: varchar("claimToken", { length: 64 }),
    claimedAt: timestamp("claimedAt"),
    sentAt: timestamp("sentAt"),
    lastError: varchar("lastError", { length: 500 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    goalFk: foreignKey({
      columns: [table.goalId],
      foreignColumns: [professionalOfficialGoals.id],
      name: "professionalGoalNotifications_goal_fk",
    }).onDelete("cascade"),
    patientFk: foreignKey({
      columns: [table.patientUserId],
      foreignColumns: [users.id],
      name: "professionalGoalNotifications_patient_fk",
    }).onDelete("cascade"),
    idempotencyUniqueIdx: uniqueIndex(
      "professionalGoalNotifications_idempotency_uq"
    ).on(table.idempotencyKey),
    statusCreatedIdx: index(
      "professionalGoalNotifications_status_created_idx"
    ).on(table.status, table.createdAt),
  })
);

export const professionalConversations = mysqlTable(
  "professionalConversations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    authorizationId: varchar("authorizationId", { length: 64 }).notNull(),
    professionalUserId: int("professionalUserId").notNull(),
    patientUserId: int("patientUserId").notNull(),
    lastMessageAt: timestamp("lastMessageAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    authorizationFk: foreignKey({
      columns: [table.authorizationId],
      foreignColumns: [professionalPatientAuthorizations.id],
      name: "professionalConversations_authorization_fk",
    }).onDelete("restrict"),
    professionalFk: foreignKey({
      columns: [table.professionalUserId],
      foreignColumns: [users.id],
      name: "professionalConversations_professional_fk",
    }).onDelete("restrict"),
    patientFk: foreignKey({
      columns: [table.patientUserId],
      foreignColumns: [users.id],
      name: "professionalConversations_patient_fk",
    }).onDelete("restrict"),
    authorizationUniqueIdx: uniqueIndex(
      "professionalConversations_authorization_uq"
    ).on(table.authorizationId),
    professionalUpdatedIdx: index(
      "professionalConversations_professional_updated_idx"
    ).on(table.professionalUserId, table.lastMessageAt),
    patientUpdatedIdx: index(
      "professionalConversations_patient_updated_idx"
    ).on(table.patientUserId, table.lastMessageAt),
  })
);

export const professionalMessages = mysqlTable(
  "professionalMessages",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    conversationId: varchar("conversationId", { length: 64 }).notNull(),
    authorizationId: varchar("authorizationId", { length: 64 }).notNull(),
    professionalUserId: int("professionalUserId").notNull(),
    patientUserId: int("patientUserId").notNull(),
    authorUserId: int("authorUserId"),
    direction: mysqlEnum("direction", [
      "professional_to_patient",
      "patient_to_professional",
    ]).notNull(),
    origin: mysqlEnum("origin", [
      "automatic",
      "ai_suggested",
      "professional",
      "patient",
    ]).notNull(),
    messageType: mysqlEnum("messageType", [
      "guidance",
      "reminder",
      "weigh_in_request",
      "record_request",
      "administrative",
      "follow_up_summary",
      "response",
    ]).notNull(),
    content: text("content").notNull(),
    state: mysqlEnum("state", [
      "draft",
      "pending",
      "sent",
      "failed",
      "received",
    ]).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    responseCode: varchar("responseCode", { length: 32 }),
    inReplyToMessageId: varchar("inReplyToMessageId", { length: 64 }),
    relatedGuidanceId: varchar("relatedGuidanceId", { length: 64 }),
    supersedesMessageId: varchar("supersedesMessageId", { length: 64 }),
    providerMessageId: varchar("providerMessageId", { length: 191 }),
    deliveryClaimToken: varchar("deliveryClaimToken", { length: 64 }),
    deliveryClaimedAt: timestamp("deliveryClaimedAt"),
    lastError: varchar("lastError", { length: 500 }),
    sentAt: timestamp("sentAt"),
    receivedAt: timestamp("receivedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    conversationFk: foreignKey({
      columns: [table.conversationId],
      foreignColumns: [professionalConversations.id],
      name: "professionalMessages_conversation_fk",
    }).onDelete("restrict"),
    authorizationFk: foreignKey({
      columns: [table.authorizationId],
      foreignColumns: [professionalPatientAuthorizations.id],
      name: "professionalMessages_authorization_fk",
    }).onDelete("restrict"),
    authorFk: foreignKey({
      columns: [table.authorUserId],
      foreignColumns: [users.id],
      name: "professionalMessages_author_fk",
    }).onDelete("set null"),
    replyFk: foreignKey({
      columns: [table.inReplyToMessageId],
      foreignColumns: [table.id],
      name: "professionalMessages_reply_fk",
    }).onDelete("set null"),
    supersedesFk: foreignKey({
      columns: [table.supersedesMessageId],
      foreignColumns: [table.id],
      name: "professionalMessages_supersedes_fk",
    }).onDelete("set null"),
    idempotencyUniqueIdx: uniqueIndex("professionalMessages_idempotency_uq").on(
      table.idempotencyKey
    ),
    responseCodeUniqueIdx: uniqueIndex(
      "professionalMessages_response_code_uq"
    ).on(table.responseCode),
    conversationCreatedIdx: index(
      "professionalMessages_conversation_created_idx"
    ).on(table.conversationId, table.createdAt, table.id),
    patientStateIdx: index("professionalMessages_patient_state_idx").on(
      table.patientUserId,
      table.state,
      table.createdAt
    ),
  })
);

export const professionalMessageDeliveryAttempts = mysqlTable(
  "professionalMessageDeliveryAttempts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    messageId: varchar("messageId", { length: 64 }).notNull(),
    channel: mysqlEnum("channel", ["web", "whatsapp"]).notNull(),
    attemptNumber: int("attemptNumber").notNull(),
    state: mysqlEnum("state", [
      "pending",
      "sending",
      "sent",
      "failed",
      "skipped",
    ]).notNull(),
    claimToken: varchar("claimToken", { length: 64 }),
    claimedAt: timestamp("claimedAt"),
    providerMessageId: varchar("providerMessageId", { length: 191 }),
    errorCode: varchar("errorCode", { length: 80 }),
    errorDetail: varchar("errorDetail", { length: 500 }),
    attemptedAt: timestamp("attemptedAt").defaultNow().notNull(),
    completedAt: timestamp("completedAt"),
  },
  table => ({
    messageFk: foreignKey({
      columns: [table.messageId],
      foreignColumns: [professionalMessages.id],
      name: "professionalMessageAttempts_message_fk",
    }).onDelete("cascade"),
    messageAttemptUniqueIdx: uniqueIndex(
      "professionalMessageAttempts_message_attempt_uq"
    ).on(table.messageId, table.attemptNumber),
    stateAttemptedIdx: index(
      "professionalMessageAttempts_state_attempted_idx"
    ).on(table.state, table.attemptedAt),
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
export type ProfessionalOfficialGoalRecord =
  typeof professionalOfficialGoals.$inferSelect;
export type ProfessionalGoalReviewRequestRecord =
  typeof professionalGoalReviewRequests.$inferSelect;
export type ProfessionalGoalNotificationRecord =
  typeof professionalGoalNotifications.$inferSelect;
export type ProfessionalConversationRecord =
  typeof professionalConversations.$inferSelect;
export type ProfessionalMessageRecord =
  typeof professionalMessages.$inferSelect;
export type ProfessionalMessageDeliveryAttemptRecord =
  typeof professionalMessageDeliveryAttempts.$inferSelect;
