import type { CheckoutSession, SubscriptionPlan, UserSubscription } from "../billingTypes";

export type CreateCheckoutInput = {
  userId: number;
  userEmail: string | null;
  userName: string | null;
  plan: SubscriptionPlan;
  successUrl: string | null;
  cancelUrl: string | null;
};

export type BillingProvider = {
  createCheckout(input: CreateCheckoutInput): Promise<CheckoutSession>;
  cancelSubscription(subscription: UserSubscription): Promise<{ cancelAtPeriodEnd: boolean }>;
};
