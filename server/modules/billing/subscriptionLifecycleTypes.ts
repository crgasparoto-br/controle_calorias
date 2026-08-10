import type { BillingAudience, BillingCycle, BillingPaymentMethod } from "./catalogPolicy";

export const BILLING_LIFECYCLE_STATES = [
  "pending",
  "active",
  "past_due",
  "suspended",
  "expired",
] as const;

export type BillingLifecycleState = (typeof BILLING_LIFECYCLE_STATES)[number];
export type BillingTrialIdentityType = "user" | "cpf" | "cnpj" | "phone";
export type BillingTrialChoice = "request" | "waive";
export type BillingImmediateTerminationReason =
  | "fraud"
  | "chargeback"
  | "security_risk"
  | "legal_obligation"
  | "full_refund_approved"
  | "operational_error";
export type BillingContractIntentState = "pending" | "confirmed" | "failed" | "expired" | "canceled";
export type BillingFinancialFactKind =
  | "authorization_confirmed"
  | "payment_confirmed"
  | "payment_failed"
  | "payment_refused"
  | "attempt_expired"
  | "chargeback_confirmed";

export type BillingLifecycleFactType =
  | "trial_started"
  | "trial_ending"
  | "contract_pending"
  | "contract_confirmed"
  | "contract_refused"
  | "contract_expired"
  | "renewal_confirmed"
  | "past_due_entered"
  | "past_due_notice_day_0"
  | "past_due_notice_day_2"
  | "past_due_notice_day_5"
  | "past_due_notice_day_7"
  | "subscription_suspended"
  | "subscription_recovered"
  | "subscription_expired"
  | "cancellation_requested"
  | "cancellation_reactivated"
  | "cancellation_effective"
  | "coverage_pause_requested"
  | "coverage_restore_requested"
  | "late_payment_reconciliation_required"
  | "financial_reconciliation_required"
  | "administrative_termination";

export type BillingPlanForLifecycle = {
  id: string;
  productCode: string;
  versionCode: string;
  audience: BillingAudience;
  billingCycle: BillingCycle;
  currency: string;
  unitAmount: number;
  capacityLimit: number | null;
  entitlements: string[];
  commercialPaymentMethods: BillingPaymentMethod[];
};

export type TrialIdentityInput = {
  userId: number;
  cpf?: string | null;
  cnpj?: string | null;
  phone: string;
};

export type HashedTrialIdentity = {
  type: BillingTrialIdentityType;
  hash: string;
};

export type BillingContractIntent = {
  id: string;
  contractKey: string;
  subscriptionId: string;
  payerUserId: number;
  planId: string;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  trialWaivedAt: Date | null;
  couponContractKey: string | null;
  state: BillingContractIntentState;
};

export type BillingLifecycleSnapshot = {
  subscriptionId: string;
  payerUserId: number;
  planId: string;
  productCode: string;
  versionCode: string;
  audience: BillingAudience;
  billingCycle: BillingCycle;
  state: BillingLifecycleState;
  revision: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  firstChargeAt: Date | null;
  trialCapacityLimit: number | null;
  graceStartedAt: Date | null;
  graceEndsAt: Date | null;
  suspendedAt: Date | null;
  recoveryEndsAt: Date | null;
  lastAuthoritativeOccurredAt: Date | null;
  lastConfirmedCompetenceKey: string | null;
  reconciliationRequired: boolean;
  couponContractKey: string | null;
  emittedFactKeys: string[];
};

export type BillingProviderNeutralFinancialFact = {
  providerCode: string;
  providerEventId: string;
  subscriptionId: string;
  kind: BillingFinancialFactKind;
  occurredAt: Date;
  competenceKey?: string | null;
  chargePurpose?: "initial" | "early_conversion" | "renewal" | "recovery";
  currentPeriodStart?: Date | null;
  currentPeriodEnd?: Date | null;
  correlationId: string;
};

export type BillingLifecycleFact = {
  type: BillingLifecycleFactType;
  version: 1;
  idempotencyKey: string;
  subscriptionId: string;
  payerUserId: number;
  audience: BillingAudience;
  productCode: string;
  versionCode: string;
  billingCycle: BillingCycle;
  previousState: BillingLifecycleState;
  newState: BillingLifecycleState;
  occurredAt: Date;
  actionAllowed: string | null;
  correlationId: string;
  payload: Record<string, string | number | boolean | null>;
};

export type BillingLifecycleMutation = {
  expectedRevision: number;
  nextState: BillingLifecycleState;
  updates: Partial<Pick<
    BillingLifecycleSnapshot,
    | "currentPeriodStart"
    | "currentPeriodEnd"
    | "cancelAtPeriodEnd"
    | "trialStartedAt"
    | "trialEndsAt"
    | "firstChargeAt"
    | "trialCapacityLimit"
    | "graceStartedAt"
    | "graceEndsAt"
    | "suspendedAt"
    | "recoveryEndsAt"
    | "lastAuthoritativeOccurredAt"
    | "lastConfirmedCompetenceKey"
    | "reconciliationRequired"
  >>;
  facts: BillingLifecycleFact[];
  invalidateFactTypes: BillingLifecycleFactType[];
  endTrialEntitlement: boolean;
  suspendedReadOnlyUntil: Date | null | undefined;
  couponAction: "none" | "confirm" | "cancel";
  audit?: {
    actorUserId?: number | null;
    requireAdmin?: boolean;
    action: string;
    reason: string;
    metadata?: Record<string, unknown>;
  };
};

export type BillingPrepareContractInput = {
  contractKey: string;
  providerCode: string;
  payerUserId: number;
  plan: BillingPlanForLifecycle;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  trialStartedAt: Date | null;
  trialEndsAt: Date | null;
  firstChargeAt: Date | null;
  trialCapacityLimit: number | null;
  trialIdentities: HashedTrialIdentity[];
  couponContractKey: string | null;
  correlationId: string;
  preparedAt: Date;
};

export type BillingPrepareContractResult =
  | { ok: true; created: boolean; intent: BillingContractIntent; snapshot: BillingLifecycleSnapshot }
  | { ok: false; reason: "trial_already_used" | "trial_identity_conflict" };

export type BillingLifecycleRepository = {
  getPlan(versionCode: string, at: Date): Promise<BillingPlanForLifecycle | null>;
  prepareContract(input: BillingPrepareContractInput): Promise<BillingPrepareContractResult>;
  loadLifecycle(subscriptionId: string): Promise<BillingLifecycleSnapshot | null>;
  commitMutation(input: {
    snapshot: BillingLifecycleSnapshot;
    mutation: BillingLifecycleMutation;
    financialFact?: BillingProviderNeutralFinancialFact;
  }): Promise<"applied" | "duplicate" | "conflict">;
  listDueSubscriptionIds(now: Date, limit: number): Promise<string[]>;
  cancelCouponReservation(contractKey: string): Promise<void>;
  recordTrialEligibilityDecision(input: {
    payerUserId: number;
    audience: BillingAudience;
    versionCode: string;
    decision: "allowed" | "denied" | "review_required";
    reason: string;
    identityTypes: BillingTrialIdentityType[];
    correlationId: string;
  }): Promise<void>;
};

export type BillingCouponCoordinator = {
  reserve(input: {
    userId: number;
    couponCode: string;
    versionCode: string;
    contractKey: string;
  }): Promise<{ reserved: true } | { reserved: false; reason: string }>;
};
