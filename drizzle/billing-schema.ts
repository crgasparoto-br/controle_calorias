import {
  type AnyMySqlColumn,
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

export const billingProducts = mysqlTable(
  "billingProducts",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 120 }).notNull(),
    audience: mysqlEnum("audience", ["individual", "professional"]).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    state: mysqlEnum("state", ["active", "inactive"]).default("active").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    codeUniqueIdx: uniqueIndex("billingProducts_code_uq").on(table.code),
    audienceStateIdx: index("billingProducts_audience_state_idx").on(
      table.audience,
      table.state
    ),
  })
);

export const billingPlans = mysqlTable(
  "billingPlans",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    productId: varchar("productId", { length: 64 })
      .notNull()
      .references(() => billingProducts.id, { onDelete: "restrict" }),
    code: varchar("code", { length: 120 }).notNull(),
    versionCode: varchar("versionCode", { length: 191 }).notNull(),
    version: int("version").notNull(),
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
    coveredBeneficiaryEntitlementsJson: json(
      "coveredBeneficiaryEntitlementsJson"
    ).notNull(),
    commercialPaymentMethodsJson: json("commercialPaymentMethodsJson").notNull(),
    status: mysqlEnum("status", ["draft", "active", "inactive"])
      .default("draft")
      .notNull(),
    active: boolean("active").default(false).notNull(),
    effectiveFrom: timestamp("effectiveFrom").notNull(),
    effectiveUntil: timestamp("effectiveUntil"),
    sortOrder: int("sortOrder").default(0).notNull(),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    versionCodeUniqueIdx: uniqueIndex("billingPlans_version_code_uq").on(
      table.versionCode
    ),
    productCycleVersionUniqueIdx: uniqueIndex(
      "billingPlans_product_cycle_version_uq"
    ).on(table.productId, table.billingCycle, table.version),
    audienceActiveIdx: index("billingPlans_audience_active_idx").on(
      table.audience,
      table.active
    ),
    productStatusEffectiveIdx: index(
      "billingPlans_product_status_effective_idx"
    ).on(table.productId, table.status, table.effectiveFrom),
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
      "transition",
      "read_only",
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


export const billingCoupons = mysqlTable(
  "billingCoupons",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    code: varchar("code", { length: 80 }).notNull(),
    revision: int("revision").notNull(),
    activeCodeKey: varchar("activeCodeKey", { length: 80 }),
    discountType: mysqlEnum("discountType", ["percentage", "fixed_amount"]).notNull(),
    discountValue: int("discountValue").notNull(),
    currency: varchar("currency", { length: 3 }),
    eligibleProductCodesJson: json("eligibleProductCodesJson").notNull(),
    eligibleVersionCodesJson: json("eligibleVersionCodesJson").notNull(),
    eligibleCyclesJson: json("eligibleCyclesJson").notNull(),
    validFrom: timestamp("validFrom").notNull(),
    validUntil: timestamp("validUntil"),
    maxTotalUses: int("maxTotalUses"),
    maxUsesPerUser: int("maxUsesPerUser"),
    firstContractOnly: boolean("firstContractOnly").default(false).notNull(),
    durationCharges: int("durationCharges").notNull(),
    state: mysqlEnum("state", ["active", "inactive"]).default("active").notNull(),
    supersedesCouponId: varchar("supersedesCouponId", { length: 64 }).references(
      (): AnyMySqlColumn => billingCoupons.id,
      { onDelete: "set null" }
    ),
    createdByUserId: int("createdByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    deactivatedByUserId: int("deactivatedByUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    deactivatedAt: timestamp("deactivatedAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    activeCodeUniqueIdx: uniqueIndex("billingCoupons_active_code_uq").on(
      table.activeCodeKey
    ),
    codeRevisionUniqueIdx: uniqueIndex("billingCoupons_code_revision_uq").on(
      table.code,
      table.revision
    ),
    codeStateIdx: index("billingCoupons_code_state_idx").on(table.code, table.state),
  })
);

export const billingCouponRedemptions = mysqlTable(
  "billingCouponRedemptions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    couponId: varchar("couponId", { length: 64 })
      .notNull()
      .references(() => billingCoupons.id, { onDelete: "restrict" }),
    planId: varchar("planId", { length: 64 })
      .notNull()
      .references(() => billingPlans.id, { onDelete: "restrict" }),
    userId: int("userId")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    contractKey: varchar("contractKey", { length: 191 }).notNull(),
    state: mysqlEnum("state", ["reserved", "confirmed", "canceled"])
      .default("reserved")
      .notNull(),
    discountAmount: int("discountAmount").notNull(),
    finalAmount: int("finalAmount").notNull(),
    reservedAt: timestamp("reservedAt").defaultNow().notNull(),
    confirmedAt: timestamp("confirmedAt"),
    canceledAt: timestamp("canceledAt"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  },
  table => ({
    contractKeyUniqueIdx: uniqueIndex(
      "billingCouponRedemptions_contract_key_uq"
    ).on(table.contractKey),
    couponStateIdx: index("billingCouponRedemptions_coupon_state_idx").on(
      table.couponId,
      table.state
    ),
    userCouponStateIdx: index(
      "billingCouponRedemptions_user_coupon_state_idx"
    ).on(table.userId, table.couponId, table.state),
  })
);

export const billingCommercialAuditEvents = mysqlTable(
  "billingCommercialAuditEvents",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    actorUserId: int("actorUserId").references(() => users.id, {
      onDelete: "set null",
    }),
    entityType: mysqlEnum("entityType", ["product", "version", "coupon"]).notNull(),
    entityId: varchar("entityId", { length: 64 }).notNull(),
    action: varchar("action", { length: 120 }).notNull(),
    reason: text("reason").notNull(),
    metadataJson: json("metadataJson"),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  table => ({
    entityCreatedIdx: index("billingCommercialAuditEvents_entity_created_idx").on(
      table.entityType,
      table.entityId,
      table.createdAt
    ),
    actorCreatedIdx: index("billingCommercialAuditEvents_actor_created_idx").on(
      table.actorUserId,
      table.createdAt
    ),
  })
);

export type BillingProductRecord = typeof billingProducts.$inferSelect;
export type BillingPlanRecord = typeof billingPlans.$inferSelect;
export type BillingSubscriptionRecord = typeof billingSubscriptions.$inferSelect;
export type BillingProviderEventRecord = typeof billingProviderEvents.$inferSelect;
export type BillingEntitlementRecord = typeof billingEntitlements.$inferSelect;
export type BillingCapacityAllocationRecord = typeof billingCapacityAllocations.$inferSelect;
export type BillingAdminOverrideRecord = typeof billingAdminOverrides.$inferSelect;
export type BillingAccessAuditEventRecord = typeof billingAccessAuditEvents.$inferSelect;
export type BillingCouponRecord = typeof billingCoupons.$inferSelect;
export type BillingCouponRedemptionRecord = typeof billingCouponRedemptions.$inferSelect;
export type BillingCommercialAuditEventRecord = typeof billingCommercialAuditEvents.$inferSelect;
