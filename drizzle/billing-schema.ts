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
    id: varchar("id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    currency: varchar("currency", { length: 3 }).notNull(),
    unitAmount: int("unitAmount").notNull(),
    billingCycle: mysqlEnum("billingCycle", [
      "monthly",
      "yearly",
      "custom",
    ]).notNull(),
    capacityLimit: int("capacityLimit"),
    entitlementsJson: json("entitlementsJson").notNull(),
    active: boolean("active").default(false).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUniqueIdx: uniqueIndex("billingPlans_code_uq").on(table.code),
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
    provider: varchar("provider", { length: 64 }).notNull(),
    payerUserId: int("payerUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: varchar("planId", { length: 64 })
      .notNull()
      .references(() => billingPlans.id, { onDelete: "restrict" }),
    externalCustomerId: varchar("externalCustomerId", { length: 191 }),
    externalSubscriptionId: varchar("externalSubscriptionId", { length: 191 }),
    status: mysqlEnum("status", [
      "pending",
      "active",
      "past_due",
      "canceled",
      "expired",
    ])
      .default("pending")
      .notNull(),
    activeHolderPlanKey: varchar("activeHolderPlanKey", { length: 191 }),
    currentPeriodStart: timestamp("currentPeriodStart"),
    currentPeriodEnd: timestamp("currentPeriodEnd"),
    cancelAtPeriodEnd: boolean("cancelAtPeriodEnd").default(false).notNull(),
    canceledAt: timestamp("canceledAt"),
    endedAt: timestamp("endedAt"),
    lastProviderEventAt: timestamp("lastProviderEventAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    providerExternalUniqueIdx: uniqueIndex(
      "billingSubscriptions_provider_external_uq"
    ).on(table.provider, table.externalSubscriptionId),
    activeHolderPlanUniqueIdx: uniqueIndex(
      "billingSubscriptions_active_holder_plan_uq"
    ).on(table.activeHolderPlanKey),
    payerStatusIdx: index("billingSubscriptions_payer_status_idx").on(
      table.payerUserId,
      table.status
    ),
    planStatusIdx: index("billingSubscriptions_plan_status_idx").on(
      table.planId,
      table.status
    ),
  })
);

export const billingProviderEvents = mysqlTable(
  "billingProviderEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerEventId: varchar("providerEventId", { length: 191 }).notNull(),
    eventType: varchar("eventType", { length: 120 }).notNull(),
    status: mysqlEnum("status", ["received", "processed", "ignored", "failed"])
      .default("received")
      .notNull(),
    subscriptionId: varchar("subscriptionId", { length: 64 }).references(
      () => billingSubscriptions.id,
      { onDelete: "set null" }
    ),
    occurredAt: timestamp("occurredAt"),
    processedAt: timestamp("processedAt"),
    payloadJson: json("payloadJson"),
    errorCode: varchar("errorCode", { length: 120 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    providerEventUniqueIdx: uniqueIndex(
      "billingProviderEvents_provider_event_uq"
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
    sourceType: mysqlEnum("sourceType", [
      "subscription",
      "professional_coverage",
      "trial",
      "free_access",
      "admin_override",
    ]).notNull(),
    sourceId: varchar("sourceId", { length: 191 }).notNull(),
    sponsorUserId: int("sponsorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    planId: varchar("planId", { length: 64 }).references(
      () => billingPlans.id,
      { onDelete: "set null" }
    ),
    professionalAuthorizationId: varchar("professionalAuthorizationId", {
      length: 64,
    }).references(() => professionalPatientAuthorizations.id, {
      onDelete: "set null",
    }),
    state: mysqlEnum("state", ["active", "ended", "revoked", "ineligible"])
      .default("active")
      .notNull(),
    activeGrantKey: varchar("activeGrantKey", { length: 191 }),
    entitlementsJson: json("entitlementsJson").notNull(),
    validFrom: timestamp("validFrom").defaultNow().notNull(),
    validUntil: timestamp("validUntil"),
    endedAt: timestamp("endedAt"),
    revokedAt: timestamp("revokedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    activeGrantUniqueIdx: uniqueIndex("billingEntitlements_active_grant_uq").on(
      table.activeGrantKey
    ),
    beneficiaryStateIdx: index("billingEntitlements_beneficiary_state_idx").on(
      table.beneficiaryUserId,
      table.state
    ),
    sponsorStateIdx: index("billingEntitlements_sponsor_state_idx").on(
      table.sponsorUserId,
      table.state
    ),
    sourceIdx: index("billingEntitlements_source_idx").on(
      table.sourceType,
      table.sourceId
    ),
  })
);

export const billingCapacityAllocations = mysqlTable(
  "billingCapacityAllocations",
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
    authorizationId: varchar("authorizationId", { length: 64 }).references(
      () => professionalPatientAuthorizations.id,
      { onDelete: "set null" }
    ),
    coverageKey: varchar("coverageKey", { length: 191 }).notNull(),
    state: mysqlEnum("state", ["reserved", "active", "released"])
      .default("active")
      .notNull(),
    reservedAt: timestamp("reservedAt").defaultNow().notNull(),
    activatedAt: timestamp("activatedAt"),
    releasedAt: timestamp("releasedAt"),
    releaseReason: text("releaseReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    coverageKeyUniqueIdx: uniqueIndex(
      "billingCapacityAllocations_coverage_key_uq"
    ).on(table.coverageKey),
    subscriptionStateIdx: index(
      "billingCapacityAllocations_subscription_state_idx"
    ).on(table.subscriptionId, table.state),
    professionalStateIdx: index(
      "billingCapacityAllocations_professional_state_idx"
    ).on(table.professionalUserId, table.state),
    patientStateIdx: index("billingCapacityAllocations_patient_state_idx").on(
      table.patientUserId,
      table.state
    ),
  })
);

export const billingAdminOverrides = mysqlTable(
  "billingAdminOverrides",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessWithoutSubscription: boolean("accessWithoutSubscription")
      .default(true)
      .notNull(),
    reason: text("reason").notNull(),
    startsAt: timestamp("startsAt").defaultNow().notNull(),
    endsAt: timestamp("endsAt"),
    state: mysqlEnum("state", ["active", "revoked", "expired"])
      .default("active")
      .notNull(),
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
    activeUserUniqueIdx: uniqueIndex("billingAdminOverrides_active_user_uq").on(
      table.activeUserKey
    ),
    userStateIdx: index("billingAdminOverrides_user_state_idx").on(
      table.userId,
      table.state
    ),
    grantorCreatedIdx: index("billingAdminOverrides_grantor_created_idx").on(
      table.grantedByUserId,
      table.createdAt
    ),
  })
);

export const billingAccessAuditEvents = mysqlTable(
  "billingAccessAuditEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subjectUserId: int("subjectUserId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    action: mysqlEnum("action", [
      "subscription_status_changed",
      "entitlement_granted",
      "entitlement_ended",
      "entitlement_revoked",
      "capacity_reserved",
      "capacity_released",
      "override_granted",
      "override_revoked",
    ]).notNull(),
    sourceType: varchar("sourceType", { length: 64 }).notNull(),
    sourceId: varchar("sourceId", { length: 191 }).notNull(),
    reason: text("reason"),
    metadataJson: json("metadataJson"),
    occurredAt: timestamp("occurredAt").defaultNow().notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    subjectOccurredIdx: index(
      "billingAccessAuditEvents_subject_occurred_idx"
    ).on(table.subjectUserId, table.occurredAt),
    actorOccurredIdx: index("billingAccessAuditEvents_actor_occurred_idx").on(
      table.actorUserId,
      table.occurredAt
    ),
    sourceOccurredIdx: index("billingAccessAuditEvents_source_occurred_idx").on(
      table.sourceType,
      table.sourceId,
      table.occurredAt
    ),
  })
);

export type BillingPlanRecord = typeof billingPlans.$inferSelect;
export type BillingSubscriptionRecord =
  typeof billingSubscriptions.$inferSelect;
export type BillingProviderEventRecord =
  typeof billingProviderEvents.$inferSelect;
export type BillingEntitlementRecord = typeof billingEntitlements.$inferSelect;
export type BillingCapacityAllocationRecord =
  typeof billingCapacityAllocations.$inferSelect;
export type BillingAdminOverrideRecord =
  typeof billingAdminOverrides.$inferSelect;
export type BillingAccessAuditEventRecord =
  typeof billingAccessAuditEvents.$inferSelect;
