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
import { professionalPatientAuthorizations } from "./professional-schema";
import { users } from "./schema";

export const billingPlans = mysqlTable(
  "billingPlans",
  {
    id: int("id").autoincrement().primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    name: varchar("name", { length: 160 }).notNull(),
    description: text("description"),
    audience: mysqlEnum("audience", ["professional", "individual"])
      .default("professional")
      .notNull(),
    amountMinor: int("amountMinor").notNull(),
    currency: varchar("currency", { length: 3 }).notNull(),
    billingCycle: mysqlEnum("billingCycle", ["monthly", "yearly", "custom"])
      .default("monthly")
      .notNull(),
    patientCapacity: int("patientCapacity"),
    entitlementsJson: json("entitlementsJson").$type<string[]>().notNull(),
    sponsoredEntitlementsJson: json("sponsoredEntitlementsJson").$type<string[]>(),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerPlanId: varchar("providerPlanId", { length: 191 }),
    active: boolean("active").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUniqueIdx: uniqueIndex("billingPlans_code_unique_idx").on(table.code),
    providerPlanUniqueIdx: uniqueIndex(
      "billingPlans_provider_plan_unique_idx"
    ).on(table.provider, table.providerPlanId),
    audienceActiveIdx: index("billingPlans_audience_active_idx").on(
      table.audience,
      table.active
    ),
  })
);

export const billingSubscriptions = mysqlTable(
  "billingSubscriptions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    payerUserId: int("payerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: int("planId")
      .notNull()
      .references(() => billingPlans.id, { onDelete: "restrict" }),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerCustomerId: varchar("providerCustomerId", { length: 191 }),
    providerSubscriptionId: varchar("providerSubscriptionId", {
      length: 191,
    }),
    status: mysqlEnum("status", [
      "pending",
      "active",
      "past_due",
      "canceled",
      "expired",
    ])
      .default("pending")
      .notNull(),
    currentPeriodStart: timestamp("currentPeriodStart"),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
    canceledAt: timestamp("canceledAt"),
    endedAt: timestamp("endedAt"),
    providerStateUpdatedAt: timestamp("providerStateUpdatedAt"),
    activePayerPlanKey: varchar("activePayerPlanKey", { length: 191 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    payerStatusIdx: index("billingSubscriptions_payer_status_idx").on(
      table.payerUserId,
      table.status
    ),
    planStatusIdx: index("billingSubscriptions_plan_status_idx").on(
      table.planId,
      table.status
    ),
    providerSubscriptionUniqueIdx: uniqueIndex(
      "billingSubscriptions_provider_subscription_unique_idx"
    ).on(table.provider, table.providerSubscriptionId),
    activePayerPlanUniqueIdx: uniqueIndex(
      "billingSubscriptions_active_payer_plan_unique_idx"
    ).on(table.activePayerPlanKey),
  })
);

export const billingProviderEvents = mysqlTable(
  "billingProviderEvents",
  {
    id: int("id").autoincrement().primaryKey(),
    provider: varchar("provider", { length: 40 }).notNull(),
    providerEventId: varchar("providerEventId", { length: 191 }).notNull(),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    subscriptionId: varchar("subscriptionId", { length: 64 }).references(
      () => billingSubscriptions.id,
      { onDelete: "set null" }
    ),
    payloadHash: varchar("payloadHash", { length: 64 }).notNull(),
    sanitizedPayloadJson: json("sanitizedPayloadJson").$type<
      Record<string, unknown>
    >(),
    status: mysqlEnum("status", [
      "received",
      "processed",
      "failed",
      "ignored",
    ])
      .default("received")
      .notNull(),
    occurredAt: timestamp("occurredAt"),
    processedAt: timestamp("processedAt"),
    errorCode: varchar("errorCode", { length: 120 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    providerEventUniqueIdx: uniqueIndex(
      "billingProviderEvents_provider_event_unique_idx"
    ).on(table.provider, table.providerEventId),
    subscriptionCreatedIdx: index(
      "billingProviderEvents_subscription_created_idx"
    ).on(table.subscriptionId, table.createdAt),
    statusCreatedIdx: index("billingProviderEvents_status_created_idx").on(
      table.status,
      table.createdAt
    ),
  })
);

export const billingEntitlements = mysqlTable(
  "billingEntitlements",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    beneficiaryUserId: int("beneficiaryUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    audience: mysqlEnum("audience", ["professional", "individual"])
      .default("individual")
      .notNull(),
    source: mysqlEnum("source", [
      "subscription",
      "professional_coverage",
      "trial",
      "free_access",
    ]).notNull(),
    sourceSubscriptionId: varchar("sourceSubscriptionId", {
      length: 64,
    }).references(() => billingSubscriptions.id, { onDelete: "set null" }),
    sponsorUserId: int("sponsorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    professionalAuthorizationId: varchar("professionalAuthorizationId", {
      length: 64,
    }).references(() => professionalPatientAuthorizations.id, {
      onDelete: "set null",
    }),
    status: mysqlEnum("status", [
      "active",
      "ended",
      "revoked",
      "ineligible",
    ])
      .default("active")
      .notNull(),
    planCode: varchar("planCode", { length: 80 }),
    entitlementsJson: json("entitlementsJson").$type<string[]>().notNull(),
    validFrom: timestamp("validFrom").notNull(),
    validUntil: timestamp("validUntil"),
    endedReason: varchar("endedReason", { length: 160 }),
    activeBeneficiarySourceKey: varchar("activeBeneficiarySourceKey", {
      length: 191,
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    beneficiaryStatusIdx: index(
      "billingEntitlements_beneficiary_status_idx"
    ).on(table.beneficiaryUserId, table.status),
    sponsorStatusIdx: index("billingEntitlements_sponsor_status_idx").on(
      table.sponsorUserId,
      table.status
    ),
    subscriptionStatusIdx: index(
      "billingEntitlements_subscription_status_idx"
    ).on(table.sourceSubscriptionId, table.status),
    activeBeneficiarySourceUniqueIdx: uniqueIndex(
      "billingEntitlements_active_beneficiary_source_unique_idx"
    ).on(table.activeBeneficiarySourceKey),
  })
);

export const billingCapacityReservations = mysqlTable(
  "billingCapacityReservations",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 64 })
      .notNull()
      .references(() => billingSubscriptions.id, { onDelete: "cascade" }),
    professionalUserId: int("professionalUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    patientUserId: int("patientUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    professionalAuthorizationId: varchar("professionalAuthorizationId", {
      length: 64,
    }).references(() => professionalPatientAuthorizations.id, {
      onDelete: "set null",
    }),
    coverageKey: varchar("coverageKey", { length: 191 }).notNull(),
    slotNumber: int("slotNumber").notNull(),
    status: mysqlEnum("status", ["active", "released"])
      .default("active")
      .notNull(),
    activeCoverageKey: varchar("activeCoverageKey", { length: 191 }),
    activeSlotKey: varchar("activeSlotKey", { length: 191 }),
    reservedAt: timestamp("reservedAt").notNull(),
    releasedAt: timestamp("releasedAt"),
    releaseReason: varchar("releaseReason", { length: 160 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    subscriptionStatusIdx: index(
      "billingCapacityReservations_subscription_status_idx"
    ).on(table.subscriptionId, table.status),
    professionalStatusIdx: index(
      "billingCapacityReservations_professional_status_idx"
    ).on(table.professionalUserId, table.status),
    patientStatusIdx: index(
      "billingCapacityReservations_patient_status_idx"
    ).on(table.patientUserId, table.status),
    activeCoverageUniqueIdx: uniqueIndex(
      "billingCapacityReservations_active_coverage_unique_idx"
    ).on(table.activeCoverageKey),
    activeSlotUniqueIdx: uniqueIndex(
      "billingCapacityReservations_active_slot_unique_idx"
    ).on(table.activeSlotKey),
  })
);

export const billingAccessOverrides = mysqlTable(
  "billingAccessOverrides",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessWithoutSubscription: boolean("accessWithoutSubscription")
      .default(true)
      .notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("startsAt").notNull(),
    endsAt: timestamp("endsAt"),
    active: boolean("active").default(true).notNull(),
    activeUserKey: varchar("activeUserKey", { length: 64 }),
    grantedByUserId: int("grantedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedByUserId: int("revokedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    userActiveIdx: index("billingAccessOverrides_user_active_idx").on(
      table.userId,
      table.active
    ),
    activeUserUniqueIdx: uniqueIndex(
      "billingAccessOverrides_active_user_unique_idx"
    ).on(table.activeUserKey),
    endsAtIdx: index("billingAccessOverrides_ends_at_idx").on(table.endsAt),
  })
);

export const billingAuditEvents = mysqlTable(
  "billingAuditEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    subjectUserId: int("subjectUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    action: varchar("action", { length: 120 }).notNull(),
    entityType: varchar("entityType", { length: 80 }).notNull(),
    entityId: varchar("entityId", { length: 191 }).notNull(),
    metadataJson: json("metadataJson").$type<Record<string, unknown>>(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    subjectCreatedIdx: index("billingAuditEvents_subject_created_idx").on(
      table.subjectUserId,
      table.createdAt
    ),
    actorCreatedIdx: index("billingAuditEvents_actor_created_idx").on(
      table.actorUserId,
      table.createdAt
    ),
    entityCreatedIdx: index("billingAuditEvents_entity_created_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt
    ),
  })
);

export type BillingPlanRecord = typeof billingPlans.$inferSelect;
export type BillingSubscriptionRecord = typeof billingSubscriptions.$inferSelect;
export type BillingEntitlementRecord = typeof billingEntitlements.$inferSelect;
export type BillingCapacityReservationRecord =
  typeof billingCapacityReservations.$inferSelect;
export type BillingAccessOverrideRecord = typeof billingAccessOverrides.$inferSelect;
