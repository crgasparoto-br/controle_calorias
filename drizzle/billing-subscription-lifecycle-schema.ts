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
import { billingPlans, billingSubscriptions } from "./billing-schema";
import { users } from "./schema";

export const billingContractIntents = mysqlTable(
  "billingContractIntents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    contractKey: varchar("contractKey", { length: 191 }).notNull(),
    subscriptionId: varchar("subscriptionId", { length: 64 }).notNull(),
    payerUserId: int("payerUserId").notNull(),
    planId: varchar("planId", { length: 64 }).notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    paymentMethod: mysqlEnum("paymentMethod", ["credit_card", "pix_automatic"]).notNull(),
    trialChoice: mysqlEnum("trialChoice", ["request", "waive"]).notNull(),
    trialWaivedAt: timestamp("trialWaivedAt"),
    couponContractKey: varchar("couponContractKey", { length: 191 }),
    state: mysqlEnum("state", ["pending", "confirmed", "failed", "expired", "canceled"])
      .default("pending")
      .notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    subscriptionFk: foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [billingSubscriptions.id],
      name: "billingContractIntents_subscriptionId_fk",
    }).onDelete("cascade"),
    payerFk: foreignKey({
      columns: [table.payerUserId],
      foreignColumns: [users.id],
      name: "billingContractIntents_payerUserId_fk",
    }).onDelete("cascade"),
    planFk: foreignKey({
      columns: [table.planId],
      foreignColumns: [billingPlans.id],
      name: "billingContractIntents_planId_fk",
    }).onDelete("restrict"),
    contractKeyUniqueIdx: uniqueIndex("billingContractIntents_contract_key_uq").on(
      table.contractKey
    ),
    subscriptionUniqueIdx: uniqueIndex("billingContractIntents_subscription_uq").on(
      table.subscriptionId
    ),
    payerStateIdx: index("billingContractIntents_payer_state_idx").on(
      table.payerUserId,
      table.state
    ),
  })
);

export const billingSubscriptionLifecycle = mysqlTable(
  "billingSubscriptionLifecycle",
  {
    subscriptionId: varchar("subscriptionId", { length: 64 }).primaryKey(),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    state: mysqlEnum("state", ["pending", "active", "past_due", "suspended", "expired"])
      .default("pending")
      .notNull(),
    revision: int("revision").default(0).notNull(),
    trialStartedAt: timestamp("trialStartedAt"),
    trialEndsAt: timestamp("trialEndsAt"),
    firstChargeAt: timestamp("firstChargeAt"),
    trialCapacityLimit: int("trialCapacityLimit"),
    graceStartedAt: timestamp("graceStartedAt"),
    graceEndsAt: timestamp("graceEndsAt"),
    suspendedAt: timestamp("suspendedAt"),
    recoveryEndsAt: timestamp("recoveryEndsAt"),
    lastAuthoritativeOccurredAt: timestamp("lastAuthoritativeOccurredAt"),
    lastConfirmedCompetenceKey: varchar("lastConfirmedCompetenceKey", { length: 191 }),
    reconciliationRequired: boolean("reconciliationRequired").default(false).notNull(),
    reconciliationReason: text("reconciliationReason"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    subscriptionFk: foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [billingSubscriptions.id],
      name: "billingSubscriptionLifecycle_subscriptionId_fk",
    }).onDelete("cascade"),
    stateGraceIdx: index("billingSubscriptionLifecycle_state_grace_idx").on(
      table.state,
      table.graceEndsAt
    ),
    stateRecoveryIdx: index("billingSubscriptionLifecycle_state_recovery_idx").on(
      table.state,
      table.recoveryEndsAt
    ),
    stateTrialIdx: index("billingSubscriptionLifecycle_state_trial_idx").on(
      table.state,
      table.trialEndsAt
    ),
  })
);

export const billingTrialIdentityClaims = mysqlTable(
  "billingTrialIdentityClaims",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 64 }),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    identityType: mysqlEnum("identityType", ["user", "cpf", "cnpj", "phone"]).notNull(),
    identityHash: varchar("identityHash", { length: 64 }).notNull(),
    claimedAt: timestamp("claimedAt").defaultNow().notNull(),
  },
  table => ({
    subscriptionFk: foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [billingSubscriptions.id],
      name: "billingTrialIdentityClaims_subscriptionId_fk",
    }).onDelete("set null"),
    identityUniqueIdx: uniqueIndex("billingTrialIdentityClaims_identity_uq").on(
      table.audience,
      table.identityType,
      table.identityHash
    ),
    subscriptionIdx: index("billingTrialIdentityClaims_subscription_idx").on(
      table.subscriptionId
    ),
  })
);

export const billingTrialEligibilityAuditEvents = mysqlTable(
  "billingTrialEligibilityAuditEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    payerUserId: int("payerUserId"),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    versionCode: varchar("versionCode", { length: 191 }).notNull(),
    decision: mysqlEnum("decision", ["allowed", "denied", "review_required"]).notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    identityTypesJson: json("identityTypesJson").notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    payerFk: foreignKey({
      columns: [table.payerUserId],
      foreignColumns: [users.id],
      name: "billingTrialEligibilityAuditEvents_payerUserId_fk",
    }).onDelete("set null"),
    payerCreatedIdx: index("billingTrialEligibilityAuditEvents_payer_created_idx").on(
      table.payerUserId,
      table.createdAt
    ),
    versionCreatedIdx: index("billingTrialEligibilityAuditEvents_version_created_idx").on(
      table.versionCode,
      table.createdAt
    ),
  })
);

export const billingSubscriptionFacts = mysqlTable(
  "billingSubscriptionFacts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 64 }).notNull(),
    payerUserId: int("payerUserId").notNull(),
    factType: varchar("factType", { length: 120 }).notNull(),
    factVersion: int("factVersion").default(1).notNull(),
    idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
    correlationId: varchar("correlationId", { length: 191 }).notNull(),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    productCode: varchar("productCode", { length: 120 }).notNull(),
    versionCode: varchar("versionCode", { length: 191 }).notNull(),
    billingCycle: mysqlEnum("billingCycle", ["monthly", "yearly", "custom"]).notNull(),
    previousState: mysqlEnum("previousState", ["pending", "active", "past_due", "suspended", "expired"]).notNull(),
    newState: mysqlEnum("newState", ["pending", "active", "past_due", "suspended", "expired"]).notNull(),
    actionAllowed: varchar("actionAllowed", { length: 120 }),
    effectiveAt: timestamp("effectiveAt").notNull(),
    payloadJson: json("payloadJson"),
    invalidatedAt: timestamp("invalidatedAt"),
    invalidatedByFactId: varchar("invalidatedByFactId", { length: 64 }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    subscriptionFk: foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [billingSubscriptions.id],
      name: "billingSubscriptionFacts_subscriptionId_fk",
    }).onDelete("cascade"),
    payerFk: foreignKey({
      columns: [table.payerUserId],
      foreignColumns: [users.id],
      name: "billingSubscriptionFacts_payerUserId_fk",
    }).onDelete("cascade"),
    idempotencyUniqueIdx: uniqueIndex("billingSubscriptionFacts_idempotency_uq").on(
      table.idempotencyKey
    ),
    subscriptionCreatedIdx: index("billingSubscriptionFacts_subscription_created_idx").on(
      table.subscriptionId,
      table.createdAt
    ),
    subscriptionTypeIdx: index("billingSubscriptionFacts_subscription_type_idx").on(
      table.subscriptionId,
      table.factType
    ),
  })
);

export const billingSubscriptionLifecycleAuditEvents = mysqlTable(
  "billingSubscriptionLifecycleAuditEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    subscriptionId: varchar("subscriptionId", { length: 64 }).notNull(),
    actorUserId: int("actorUserId"),
    action: varchar("action", { length: 120 }).notNull(),
    reason: text("reason").notNull(),
    metadataJson: json("metadataJson"),
    occurredAt: timestamp("occurredAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    subscriptionFk: foreignKey({
      columns: [table.subscriptionId],
      foreignColumns: [billingSubscriptions.id],
      name: "billingSubscriptionLifecycleAuditEvents_subscriptionId_fk",
    }).onDelete("cascade"),
    actorFk: foreignKey({
      columns: [table.actorUserId],
      foreignColumns: [users.id],
      name: "billingSubscriptionLifecycleAuditEvents_actorUserId_fk",
    }).onDelete("set null"),
    subscriptionOccurredIdx: index("billingSubscriptionLifecycleAuditEvents_sub_occurred_idx").on(
      table.subscriptionId,
      table.occurredAt
    ),
    actorOccurredIdx: index("billingSubscriptionLifecycleAuditEvents_actor_occurred_idx").on(
      table.actorUserId,
      table.occurredAt
    ),
  })
);
