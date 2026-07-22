export const BILLING_ACCESS_REASONS = [
  "active_subscription",
  "sponsored_by_professional",
  "active_trial",
  "admin_override",
  "free_access",
  "no_access",
] as const;

export type BillingAccessReason = (typeof BILLING_ACCESS_REASONS)[number];

export type BillingAccessMode = "open_access" | "enforced";

export type UserEntitlementsResult = {
  allowed: boolean;
  reason: BillingAccessReason;
  validUntil?: Date;
  sponsorUserId?: number;
  planCode?: string;
  entitlements: string[];
  sourceAvailable: boolean;
  evaluatedAt: Date;
};

export type BillingEntitlementCandidate = {
  reason: Exclude<BillingAccessReason, "no_access">;
  sourceId: string;
  validFrom?: Date | null;
  validUntil?: Date | null;
  sponsorUserId?: number | null;
  planCode?: string | null;
  entitlements: string[];
};

export type BillingSubscriptionSummary = {
  id: string;
  provider: string;
  planCode: string;
  planName: string;
  status: "pending" | "active" | "past_due" | "canceled" | "expired";
  billingCycle: "monthly" | "yearly" | "custom";
  currency: string;
  unitAmount: number;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

export type ProfessionalBillingSubscription = BillingSubscriptionSummary & {
  planId: string;
  capacityLimit: number | null;
  capacityUsed: number;
  entitlements: string[];
};

export type ReserveBillingCapacityInput = {
  professionalUserId: number;
  patientUserId: number;
  coverageKey: string;
};

export type ReserveBillingCapacityResult =
  | { reserved: true; reservationId: string }
  | { reserved: false; reason: "capacity_exceeded" | "unavailable" };

export type ReleaseBillingCapacityInput = ReserveBillingCapacityInput & {
  reservationId?: string;
  reason?: string;
};

export type BillingAdminOverride = {
  id: string;
  userId: number;
  reason: string;
  startsAt: Date;
  endsAt: Date | null;
  state: "active" | "revoked" | "expired";
  grantedByUserId: number | null;
  revokedByUserId: number | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingAdminUserRow = {
  id: number;
  name: string | null;
  email: string | null;
  phoneNumber: string | null;
};

export type BillingAdminUserAccess = BillingAdminUserRow & {
  access: UserEntitlementsResult;
  activeOverride: BillingAdminOverride | null;
};

export type BillingPlanAnalytics = {
  planCode: string;
  planName: string;
  audience: "individual" | "professional";
  billingCycle: "monthly" | "yearly" | "custom";
  currency: string;
  unitAmount: number;
  active: boolean;
  subscriptionsByStatus: Record<string, number>;
  coveredBeneficiaries: number;
  capacityUsed: number;
};

export type BillingAdminAnalytics = {
  plans: BillingPlanAnalytics[];
  subscriptionStatusTotals: Record<string, number>;
  activeOverrides: number;
  usersWithoutCommercialAccess: number;
  estimatedMonthlyRecurringRevenue: Array<{
    currency: string;
    amountMinor: number;
    estimated: true;
  }>;
  generatedAt: Date;
};

export type GrantBillingOverrideInput = {
  userId: number;
  reason: string;
  startsAt?: Date;
  endsAt?: Date | null;
  grantedByUserId: number;
};

export type RevokeBillingOverrideInput = {
  overrideId: string;
  revokedByUserId: number;
  reason: string;
};

export type RecordBillingProviderEventInput = {
  provider: string;
  providerEventId: string;
  eventType: string;
  subscriptionId?: string | null;
  occurredAt?: Date | null;
  metadata?: Record<string, unknown> | null;
};

export type RecordBillingProviderEventResult = {
  id: string;
  created: boolean;
};

export type BillingRepository = {
  recordProviderEvent(
    input: RecordBillingProviderEventInput
  ): Promise<RecordBillingProviderEventResult>;
  listAccessCandidates(
    userId: number,
    now: Date
  ): Promise<BillingEntitlementCandidate[]>;
  getOwnSubscription(
    userId: number,
    now: Date
  ): Promise<BillingSubscriptionSummary | null>;
  getActiveProfessionalSubscription(
    professionalUserId: number,
    now: Date
  ): Promise<ProfessionalBillingSubscription | null>;
  reserveProfessionalCapacity(
    input: ReserveBillingCapacityInput
  ): Promise<ReserveBillingCapacityResult>;
  releaseProfessionalCapacity(input: ReleaseBillingCapacityInput): Promise<void>;
  grantAdminOverride(
    input: GrantBillingOverrideInput
  ): Promise<BillingAdminOverride>;
  revokeAdminOverride(
    input: RevokeBillingOverrideInput
  ): Promise<BillingAdminOverride>;
  getActiveAdminOverride(
    userId: number,
    now: Date
  ): Promise<BillingAdminOverride | null>;
  listAdminOverrides(userId: number, limit: number): Promise<BillingAdminOverride[]>;
  searchUsers(
    query: string,
    limit: number,
    offset?: number
  ): Promise<BillingAdminUserRow[]>;
  getAdminAnalytics(now: Date): Promise<BillingAdminAnalytics>;
};
