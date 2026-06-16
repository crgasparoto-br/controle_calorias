export const BILLING_PROVIDERS = ["manual", "external_checkout"] as const;
export type BillingProviderCode = (typeof BILLING_PROVIDERS)[number];

export const BILLING_CYCLES = ["monthly", "annual"] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const SUBSCRIPTION_STATUSES = [
  "pending",
  "active",
  "past_due",
  "canceled",
  "expired",
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_EVENT_TYPES = [
  "checkout.created",
  "payment.confirmed",
  "payment.pending",
  "payment.failed",
  "subscription.renewed",
  "subscription.canceled",
  "subscription.expired",
] as const;
export type BillingEventType = (typeof BILLING_EVENT_TYPES)[number];

export type SubscriptionPlan = {
  id: string;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: "BRL";
  billingCycle: BillingCycle;
  provider: BillingProviderCode;
  providerPlanId: string;
  active: boolean;
  benefits: string[];
};

export type UserSubscription = {
  id: string;
  userId: number;
  planCode: string;
  provider: BillingProviderCode;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: SubscriptionStatus;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodLabel: string | null;
  checkoutUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BillingEvent = {
  id: string;
  provider: BillingProviderCode;
  providerEventId: string;
  eventType: BillingEventType;
  userId: number | null;
  subscriptionId: string | null;
  payload: unknown;
  processedAt: string;
  createdAt: string;
};

export type CheckoutSession = {
  checkoutUrl: string;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
  paymentMethodLabel: string | null;
};

export function isActiveSubscriptionStatus(status: SubscriptionStatus) {
  return status === "active";
}

export function mapExternalBillingStatus(status: string): SubscriptionStatus {
  const normalized = status.trim().toLowerCase();
  if (["approved", "paid", "active", "authorized", "confirmed"].includes(normalized)) return "active";
  if (["pending", "in_process", "created", "waiting_payment"].includes(normalized)) return "pending";
  if (["rejected", "failed", "past_due", "overdue"].includes(normalized)) return "past_due";
  if (["cancelled", "canceled", "refunded"].includes(normalized)) return "canceled";
  if (["expired", "ended"].includes(normalized)) return "expired";
  return "pending";
}
