import type { BillingCycle, BillingPaymentMethod } from "./catalogPolicy";
import type { BillingProviderEventMetadata } from "./providerEvents";
import type { BillingTrialChoice } from "./subscriptionLifecycleTypes";

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

export type BillingProviderCapabilities = {
  paymentMethods: readonly BillingPaymentMethod[];
  hostedCheckout: boolean;
  recurringBilling: boolean;
  automaticPix: boolean;
  updatePaymentMethod: boolean;
  synchronization: boolean;
};

export type BillingProviderCustomerInput = {
  payerUserId: number;
  name: string;
  email?: string | null;
  mobilePhone?: string | null;
  cpfCnpj?: string | null;
};

export type BillingProviderValidatedDiscount = {
  amountMinor: number;
  durationCharges: number;
};

export type BillingProviderPaymentFlowInput = {
  contractKey: string;
  subscriptionId?: string | null;
  payerUserId: number;
  versionCode: string;
  productName: string;
  billingCycle: BillingCycle;
  currency: "BRL";
  unitAmount: number;
  paymentMethod: BillingPaymentMethod;
  trialChoice: BillingTrialChoice;
  trialDays: number;
  customer: BillingProviderCustomerInput;
  couponCode?: string | null;
  discount?: BillingProviderValidatedDiscount | null;
  correlationId: string;
  transitionAccessUntil?: Date | null;
  successUrl: string;
  cancelUrl: string;
  expiredUrl: string;
};

export type BillingProviderPaymentFlow =
  | {
      kind: "hosted_checkout";
      provider: string;
      externalId: string;
      url: string;
      state: "pending";
    }
  | {
      kind: "pix_automatic";
      provider: string;
      externalId: string;
      qrCodePayload: string;
      expiresAt: string | null;
      state: "pending";
    };

export type BillingProvider = {
  code: string;
  capabilities(): BillingProviderCapabilities;
  createPaymentFlow(
    input: BillingProviderPaymentFlowInput
  ): Promise<BillingProviderPaymentFlow>;
  synchronizeSubscription(externalSubscriptionId: string): Promise<{
    externalSubscriptionId: string;
    status: NormalizedBillingSubscriptionStatus;
    currentPeriodStart?: Date | null;
    currentPeriodEnd?: Date | null;
    cancelAtPeriodEnd: boolean;
  }>;
  cancelSubscription(externalSubscriptionId: string): Promise<void>;
  reactivateSubscription?(input: {
    externalSubscriptionId: string;
    nextRenewalAt: Date;
  }): Promise<void>;
  updatePaymentMethod?(input: {
    externalSubscriptionId: string;
    providerPaymentMethodReference: string;
    remoteIp: string;
  }): Promise<void>;
  authenticateAndNormalizeWebhook(input: {
    rawBody: Uint8Array;
    headers: Record<string, string | string[] | undefined>;
  }): Promise<BillingProviderNormalizedEvent>;
};
