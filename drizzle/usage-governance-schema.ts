import {
  bigint,
  boolean,
  date,
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

const count = (name: string) => bigint(name, { mode: "number" });

export const billingUsageEvents = mysqlTable("billingUsageEvents", {
  id: varchar("id", { length: 64 }).primaryKey(),
  idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  payloadFingerprint: varchar("payloadFingerprint", { length: 64 }).notNull(),
  beneficiaryUserId: int("beneficiaryUserId").notNull(),
  patientUserId: int("patientUserId"),
  sponsorUserId: int("sponsorUserId"),
  payerUserId: int("payerUserId").notNull(),
  subscriptionId: varchar("subscriptionId", { length: 64 }),
  productCode: varchar("productCode", { length: 120 }),
  versionCode: varchar("versionCode", { length: 191 }),
  billingCycle: varchar("billingCycle", { length: 32 }),
  accessSource: varchar("accessSource", { length: 64 }).notNull(),
  operation: varchar("operation", { length: 120 }).notNull(),
  channel: varchar("channel", { length: 64 }).notNull(),
  provider: varchar("provider", { length: 64 }),
  model: varchar("model", { length: 191 }),
  unitType: varchar("unitType", { length: 64 }).notNull(),
  unitCount: count("unitCount").default(1).notNull(),
  estimatedCostMicros: count("estimatedCostMicros"),
  effectiveCostMicros: count("effectiveCostMicros"),
  currency: varchar("currency", { length: 3 }),
  eventState: varchar("eventState", { length: 32 }).notNull(),
  providerDispatchStartedAt: timestamp("providerDispatchStartedAt"),
  attemptRole: varchar("attemptRole", { length: 32 }).default("primary").notNull(),
  retryRootKey: varchar("retryRootKey", { length: 191 }),
  correlationId: varchar("correlationId", { length: 191 }).notNull(),
  environment: varchar("environment", { length: 32 }).notNull(),
  ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
  metadataJson: json("metadataJson"),
  occurredAt: timestamp("occurredAt").notNull(),
  competenceDate: date("competenceDate").notNull(),
  legalHold: boolean("legalHold").default(false).notNull(),
  invalidatedAt: timestamp("invalidatedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  idempotencyUq: uniqueIndex("billingUsageEvents_idempotency_uq").on(table.idempotencyKey),
  beneficiaryOccurredIdx: index("billingUsageEvents_beneficiary_occurred_idx").on(table.beneficiaryUserId, table.occurredAt),
  sponsorOccurredIdx: index("billingUsageEvents_sponsor_occurred_idx").on(table.sponsorUserId, table.occurredAt),
  subscriptionOccurredIdx: index("billingUsageEvents_subscription_occurred_idx").on(table.subscriptionId, table.occurredAt),
  operationOccurredIdx: index("billingUsageEvents_operation_occurred_idx").on(table.operation, table.occurredAt),
  competenceIdx: index("billingUsageEvents_competence_idx").on(table.competenceDate),
  dispatchStateIdx: index("billingUsageEvents_provider_dispatch_state_idx").on(table.eventState, table.providerDispatchStartedAt),
}));

export const billingUsageDailyAggregates = mysqlTable("billingUsageDailyAggregates", {
  aggregateKey: varchar("aggregateKey", { length: 191 }).primaryKey(),
  usageDate: date("usageDate").notNull(),
  beneficiaryUserId: int("beneficiaryUserId").notNull(),
  patientUserId: int("patientUserId"),
  sponsorUserId: int("sponsorUserId"), payerUserId: int("payerUserId").notNull(),
  subscriptionId: varchar("subscriptionId", { length: 64 }), productCode: varchar("productCode", { length: 120 }),
  versionCode: varchar("versionCode", { length: 191 }), billingCycle: varchar("billingCycle", { length: 32 }),
  accessSource: varchar("accessSource", { length: 64 }).notNull(), operation: varchar("operation", { length: 120 }).notNull(),
  channel: varchar("channel", { length: 64 }).notNull(), provider: varchar("provider", { length: 64 }), model: varchar("model", { length: 191 }),
  currency: varchar("currency", { length: 3 }), eventCount: count("eventCount").default(0).notNull(), unitCount: count("unitCount").default(0).notNull(),
  successCount: count("successCount").default(0).notNull(), failureCount: count("failureCount").default(0).notNull(), retryCount: count("retryCount").default(0).notNull(),
  estimatedCostMicros: count("estimatedCostMicros").default(0).notNull(), effectiveCostMicros: count("effectiveCostMicros").default(0).notNull(),
  recognizedCostMicros: count("recognizedCostMicros").default(0).notNull(),
  unpricedCount: count("unpricedCount").default(0).notNull(), ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(), updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  dateIdx: index("billingUsageDailyAggregates_date_idx").on(table.usageDate),
  payerDateIdx: index("billingUsageDailyAggregates_payer_date_idx").on(table.payerUserId, table.usageDate),
  versionDateIdx: index("billingUsageDailyAggregates_version_date_idx").on(table.versionCode, table.usageDate),
}));

export const billingEconomicFacts = mysqlTable("billingEconomicFacts", {
  id: varchar("id", { length: 64 }).primaryKey(), idempotencyKey: varchar("idempotencyKey", { length: 191 }).notNull(),
  supersedesFactId: varchar("supersedesFactId", { length: 64 }), supersededByFactId: varchar("supersededByFactId", { length: 64 }), supersededAt: timestamp("supersededAt"), payloadFingerprint: varchar("payloadFingerprint", { length: 64 }).notNull(),
  subscriptionId: varchar("subscriptionId", { length: 64 }), payerUserId: int("payerUserId").notNull(), productCode: varchar("productCode", { length: 120 }),
  versionCode: varchar("versionCode", { length: 191 }), billingCycle: varchar("billingCycle", { length: 32 }), factType: varchar("factType", { length: 64 }).notNull(),
  amountMinor: count("amountMinor").notNull(), currency: varchar("currency", { length: 3 }).notNull(), valueKind: varchar("valueKind", { length: 16 }).notNull(),
  competenceStart: date("competenceStart").notNull(), competenceEnd: date("competenceEnd").notNull(), effectiveAt: timestamp("effectiveAt").notNull(),
  ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(), reason: varchar("reason", { length: 255 }), actorUserId: int("actorUserId"),
  correlationId: varchar("correlationId", { length: 191 }).notNull(), metadataJson: json("metadataJson"), invalidatedAt: timestamp("invalidatedAt"),
  legalHold: boolean("legalHold").default(false).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  idempotencyUq: uniqueIndex("billingEconomicFacts_idempotency_uq").on(table.idempotencyKey),
  supersedesUq: uniqueIndex("billingEconomicFacts_supersedes_uq").on(table.supersedesFactId),
  activeCompetenceIdx: index("billingEconomicFacts_active_competence_idx").on(table.supersededAt, table.competenceStart, table.competenceEnd),
  subscriptionCompetenceIdx: index("billingEconomicFacts_subscription_competence_idx").on(table.subscriptionId, table.competenceStart),
  payerCompetenceIdx: index("billingEconomicFacts_payer_competence_idx").on(table.payerUserId, table.competenceStart),
  typeCompetenceIdx: index("billingEconomicFacts_type_competence_idx").on(table.factType, table.competenceStart),
}));

export const billingEconomicMonthlyAggregates = mysqlTable("billingEconomicMonthlyAggregates", {
  aggregateKey: varchar("aggregateKey", { length: 191 }).primaryKey(), competenceMonth: date("competenceMonth").notNull(), payerUserId: int("payerUserId").notNull(),
  subscriptionId: varchar("subscriptionId", { length: 64 }), productCode: varchar("productCode", { length: 120 }), versionCode: varchar("versionCode", { length: 191 }),
  billingCycle: varchar("billingCycle", { length: 32 }), currency: varchar("currency", { length: 3 }).notNull(),
  recognizedContractRevenueMinor: count("recognizedContractRevenueMinor").default(0).notNull(), discountMinor: count("discountMinor").default(0).notNull(),
  couponMinor: count("couponMinor").default(0).notNull(), creditMinor: count("creditMinor").default(0).notNull(), refundMinor: count("refundMinor").default(0).notNull(),
  chargebackMinor: count("chargebackMinor").default(0).notNull(), taxMinor: count("taxMinor").default(0).notNull(), receiptFeeMinor: count("receiptFeeMinor").default(0).notNull(),
  financialCostMinor: count("financialCostMinor").default(0).notNull(), netEconomicRevenueMinor: count("netEconomicRevenueMinor").default(0).notNull(),
  variableCostMicros: count("variableCostMicros").default(0).notNull(), variableCostRatioBps: int("variableCostRatioBps"),
  estimatedFactCount: count("estimatedFactCount").default(0).notNull(), effectiveFactCount: count("effectiveFactCount").default(0).notNull(),
  measurementCoverageBps: int("measurementCoverageBps").default(0).notNull(), ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(), updatedAt: timestamp("updatedAt").defaultNow().notNull(),
}, table => ({
  monthIdx: index("billingEconomicMonthlyAggregates_month_idx").on(table.competenceMonth),
  versionMonthIdx: index("billingEconomicMonthlyAggregates_version_month_idx").on(table.versionCode, table.competenceMonth),
}));

export const billingUsagePolicies = mysqlTable("billingUsagePolicies", {
  id: varchar("id", { length: 64 }).primaryKey(), scopeType: varchar("scopeType", { length: 32 }).notNull(), scopeId: varchar("scopeId", { length: 191 }).notNull(),
  currency: varchar("currency", { length: 3 }).notNull(), expectedBudgetMicros: count("expectedBudgetMicros").notNull(), alertThresholdsJson: json("alertThresholdsJson").notNull(),
  observationStartsAt: timestamp("observationStartsAt").notNull(), observationEndsAt: timestamp("observationEndsAt").notNull(), activeScopeKey: varchar("activeScopeKey", { length: 191 }),
  ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(), createdByUserId: int("createdByUserId").notNull(), reason: varchar("reason", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(), revokedAt: timestamp("revokedAt"), revokedByUserId: int("revokedByUserId"),
}, table => ({ activeScopeUq: uniqueIndex("billingUsagePolicies_active_scope_uq").on(table.activeScopeKey), scopeIdx: index("billingUsagePolicies_scope_idx").on(table.scopeType, table.scopeId) }));

export const billingUsageAllowanceGrants = mysqlTable("billingUsageAllowanceGrants", {
  id: varchar("id", { length: 64 }).primaryKey(), subjectType: varchar("subjectType", { length: 32 }).notNull(), subjectId: varchar("subjectId", { length: 191 }).notNull(),
  grantType: varchar("grantType", { length: 32 }).notNull(), additionalUnits: count("additionalUnits"), reason: varchar("reason", { length: 255 }).notNull(),
  startsAt: timestamp("startsAt").notNull(), endsAt: timestamp("endsAt").notNull(), state: varchar("state", { length: 24 }).default("active").notNull(),
  createdByUserId: int("createdByUserId").notNull(), revokedByUserId: int("revokedByUserId"), revokedAt: timestamp("revokedAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ subjectStateIdx: index("billingUsageAllowanceGrants_subject_state_idx").on(table.subjectType, table.subjectId, table.state, table.endsAt) }));

export const billingUsageAbuseCases = mysqlTable("billingUsageAbuseCases", {
  id: varchar("id", { length: 64 }).primaryKey(), subjectUserId: int("subjectUserId").notNull(), sponsorUserId: int("sponsorUserId"), state: varchar("state", { length: 32 }).default("open").notNull(),
  signalsJson: json("signalsJson").notNull(), sanitizedEvidenceJson: json("sanitizedEvidenceJson").notNull(), systemFailuresExcluded: boolean("systemFailuresExcluded").default(false).notNull(),
  legitimateGrowthReviewed: boolean("legitimateGrowthReviewed").default(false).notNull(), impactJson: json("impactJson"), openedByUserId: int("openedByUserId").notNull(),
  reviewedByUserId: int("reviewedByUserId"), reviewOutcome: varchar("reviewOutcome", { length: 64 }), reviewReason: varchar("reviewReason", { length: 255 }),
  appealStatus: varchar("appealStatus", { length: 32 }), appealResolution: varchar("appealResolution", { length: 255 }), createdAt: timestamp("createdAt").defaultNow().notNull(),
  reviewedAt: timestamp("reviewedAt"), closedAt: timestamp("closedAt"),
}, table => ({ subjectStateIdx: index("billingUsageAbuseCases_subject_state_idx").on(table.subjectUserId, table.state, table.createdAt) }));

export const billingUsageLimitations = mysqlTable("billingUsageLimitations", {
  id: varchar("id", { length: 64 }).primaryKey(), abuseCaseId: varchar("abuseCaseId", { length: 64 }).notNull(), subjectUserId: int("subjectUserId").notNull(),
  operationsJson: json("operationsJson").notNull(), reason: varchar("reason", { length: 255 }).notNull(), startsAt: timestamp("startsAt").notNull(), endsAt: timestamp("endsAt").notNull(),
  emergencySecurity: boolean("emergencySecurity").default(false).notNull(), lifecycleKind: varchar("lifecycleKind", { length: 24 }).notNull(), approvedByUserId: int("approvedByUserId").notNull(), secondApprovedByUserId: int("secondApprovedByUserId"),
  communicatedAt: timestamp("communicatedAt"), appealOfferedAt: timestamp("appealOfferedAt"), state: varchar("state", { length: 24 }).default("active").notNull(),
  revokedAt: timestamp("revokedAt"), revokedByUserId: int("revokedByUserId"), revokeReason: varchar("revokeReason", { length: 255 }), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ subjectStateIdx: index("billingUsageLimitations_subject_state_idx").on(table.subjectUserId, table.state, table.endsAt), caseIdx: index("billingUsageLimitations_case_idx").on(table.abuseCaseId), caseLifecycleUq: uniqueIndex("billingUsageLimitations_case_lifecycle_uq").on(table.abuseCaseId, table.lifecycleKind) }));

export const billingUsageLimitationAppeals = mysqlTable("billingUsageLimitationAppeals", {
  id: varchar("id", { length: 64 }).primaryKey(), limitationId: varchar("limitationId", { length: 64 }).notNull(), abuseCaseId: varchar("abuseCaseId", { length: 64 }).notNull(),
  subjectUserId: int("subjectUserId").notNull(), submittedByUserId: int("submittedByUserId").notNull(), rationale: varchar("rationale", { length: 1000 }).notNull(),
  state: varchar("state", { length: 24 }).default("pending").notNull(), submittedAt: timestamp("submittedAt").notNull(), reviewedByUserId: int("reviewedByUserId"),
  reviewRationale: varchar("reviewRationale", { length: 1000 }), result: varchar("result", { length: 24 }), reviewedAt: timestamp("reviewedAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ limitationUq: uniqueIndex("billingUsageLimitationAppeals_limitation_uq").on(table.limitationId), caseStateIdx: index("billingUsageLimitationAppeals_case_state_idx").on(table.abuseCaseId, table.state, table.submittedAt) }));

export const billingConsumptionChargeAuthorizations = mysqlTable("billingConsumptionChargeAuthorizations", {
  id: varchar("id", { length: 64 }).primaryKey(), state: varchar("state", { length: 24 }).default("approved").notNull(), policyVersion: varchar("policyVersion", { length: 64 }).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(), pricingJson: json("pricingJson").notNull(), affectedPlansJson: json("affectedPlansJson").notNull(), effectiveFrom: timestamp("effectiveFrom").notNull(),
  communicationAt: timestamp("communicationAt").notNull(), noRetroactive: boolean("noRetroactive").default(true).notNull(), rollbackJson: json("rollbackJson").notNull(),
  authorizedByUserId: int("authorizedByUserId").notNull(), revokedByUserId: int("revokedByUserId"), revokedAt: timestamp("revokedAt"), revokeReason: varchar("revokeReason", { length: 255 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ stateEffectiveIdx: index("billingConsumptionChargeAuthorizations_state_effective_idx").on(table.state, table.effectiveFrom) }));

export const billingUsageLegalHolds = mysqlTable("billingUsageLegalHolds", {
  id: varchar("id", { length: 64 }).primaryKey(), scopeType: varchar("scopeType", { length: 32 }).notNull(), scopeId: varchar("scopeId", { length: 191 }).notNull(),
  reason: varchar("reason", { length: 255 }).notNull(), startsAt: timestamp("startsAt").notNull(), endsAt: timestamp("endsAt"), activeScopeKey: varchar("activeScopeKey", { length: 191 }),
  createdByUserId: int("createdByUserId").notNull(), revokedByUserId: int("revokedByUserId"), revokedAt: timestamp("revokedAt"), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ activeScopeUq: uniqueIndex("billingUsageLegalHolds_active_scope_uq").on(table.activeScopeKey), scopeIdx: index("billingUsageLegalHolds_scope_idx").on(table.scopeType, table.scopeId) }));

export const billingUsageRetentionAudit = mysqlTable("billingUsageRetentionAudit", {
  id: varchar("id", { length: 64 }).primaryKey(), runAt: timestamp("runAt").notNull(), detailedCutoff: timestamp("detailedCutoff").notNull(),
  dailyCutoff: date("dailyCutoff").notNull(), monthlyCutoff: date("monthlyCutoff").notNull(), ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
  status: varchar("status", { length: 24 }).notNull(), detail: varchar("detail", { length: 255 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({ runIdx: index("billingUsageRetentionAudit_run_idx").on(table.runAt) }));

export const billingUsageCostReconciliations = mysqlTable("billingUsageCostReconciliations", {
  id: varchar("id", { length: 64 }).primaryKey(), reconciliationKey: varchar("reconciliationKey", { length: 191 }).notNull(), usageEventId: varchar("usageEventId", { length: 64 }).notNull(),
  usageIdempotencyKey: varchar("usageIdempotencyKey", { length: 191 }).notNull(), previousEstimatedCostMicros: count("previousEstimatedCostMicros"), previousEffectiveCostMicros: count("previousEffectiveCostMicros"),
  newEffectiveCostMicros: count("newEffectiveCostMicros").notNull(), currency: varchar("currency", { length: 3 }).notNull(), effectiveAt: timestamp("effectiveAt").notNull(),
  reason: varchar("reason", { length: 255 }).notNull(), actorUserId: int("actorUserId"), ruleVersion: varchar("ruleVersion", { length: 64 }).notNull(),
  correlationId: varchar("correlationId", { length: 191 }).notNull(), createdAt: timestamp("createdAt").defaultNow().notNull(),
}, table => ({
  reconciliationKeyUq: uniqueIndex("billingUsageCostReconciliations_key_uq").on(table.reconciliationKey),
  eventIdx: index("billingUsageCostReconciliations_event_idx").on(table.usageEventId, table.createdAt),
  usageKeyIdx: index("billingUsageCostReconciliations_usage_key_idx").on(table.usageIdempotencyKey, table.createdAt),
}));
