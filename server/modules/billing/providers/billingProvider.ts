import type { BillingPlan, BillingProviderCode } from "../billingTypes";

export type BillingCheckoutRequest = {
  userId: number;
  userEmail: string | null;
  userName: string | null;
  plan: BillingPlan;
};

export type BillingCheckoutResponse = {
  checkoutUrl: string;
  providerCheckoutId: string;
  providerSubscriptionId: string | null;
};

export type BillingProvider = {
  code: BillingProviderCode;
  createCheckout(request: BillingCheckoutRequest): Promise<BillingCheckoutResponse>;
  cancelSubscription(providerSubscriptionId: string): Promise<void>;
};
