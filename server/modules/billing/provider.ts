import type { BillingProviderEventMetadata } from "./providerEvents";

export type NormalizedBillingSubscriptionStatus =
  | "pending"
  | "active"
  | "past_due"
  | "canceled"
  | "expired";

export type BillingProviderNormalizedEvent = {
  providerEventId: string;
  eventType: string;
  externalSubscriptionId?: string | null;
  status?: NormalizedBillingSubscriptionStatus | null;
  occurredAt?: Date | null;
  metadata?: BillingProviderEventMetadata | null;
};

export type BillingProvider = {
  code: string;
  createHostedCheckout(input: {
    payerUserId: number;
    planCode: string;
    successUrl: string;
    cancelUrl: string;
  }): Promise<{ checkoutUrl: string; externalSessionId: string }>;
  synchronizeSubscription(externalSubscriptionId: string): Promise<{
    externalSubscriptionId: string;
    status: NormalizedBillingSubscriptionStatus;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd: boolean;
  }>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  authenticateAndNormalizeWebhook(input: {
    rawBody: Uint8Array;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<BillingProviderNormalizedEvent>;
};
