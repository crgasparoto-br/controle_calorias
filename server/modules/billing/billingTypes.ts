export type BillingProviderCode = "sandbox" | "mercadopago" | "asaas";

export type BillingCycle = "monthly" | "yearly";

export type BillingSubscriptionStatus = "pending" | "active" | "past_due" | "canceled" | "expired";

export type BillingAccessStatus = BillingSubscriptionStatus | "none";

export type BillingPlan = {
  id: number;
  code: string;
  name: string;
  description: string;
  priceCents: number;
  currency: "BRL";
  billingCycle: BillingCycle;
  provider: BillingProviderCode;
  providerPlanId: string | null;
  active: boolean;
  benefits: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type BillingSubscription = {
  id: number;
  userId: number;
  planId: number;
  provider: BillingProviderCode;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  status: BillingSubscriptionStatus;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  paymentMethodLabel: string | null;
  checkoutUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type BillingEvent = {
  id: number;
  provider: BillingProviderCode;
  providerEventId: string;
  eventType: string;
  userId: number | null;
  subscriptionId: number | null;
  payloadJson: Record<string, unknown>;
  processingError: string | null;
  processedAt: Date | null;
  createdAt: Date;
};

export type BillingStatusSnapshot = {
  status: BillingAccessStatus;
  hasActiveSubscription: boolean;
  subscription: BillingSubscription | null;
  plan: BillingPlan | null;
};
