import { nanoid } from "nanoid";
import type { BillingProvider, CreateCheckoutInput } from "./billingProvider";

function appendCheckoutParams(baseUrl: string, input: CreateCheckoutInput) {
  const url = new URL(baseUrl);
  url.searchParams.set("plan", input.plan.code);
  url.searchParams.set("user", String(input.userId));
  if (input.successUrl) url.searchParams.set("success_url", input.successUrl);
  if (input.cancelUrl) url.searchParams.set("cancel_url", input.cancelUrl);
  return url.toString();
}

export function createExternalCheckoutProvider(): BillingProvider {
  return {
    async createCheckout(input) {
      const baseUrl = process.env.BILLING_CHECKOUT_BASE_URL?.trim();
      if (!baseUrl) {
        throw new Error("BILLING_PROVIDER_NOT_CONFIGURED");
      }

      return {
        checkoutUrl: appendCheckoutParams(baseUrl, input),
        providerCustomerId: input.userEmail ? `external-customer:${input.userEmail}` : null,
        providerSubscriptionId: `external-subscription:${nanoid(16)}`,
        paymentMethodLabel: "Checkout externo",
      };
    },
    async cancelSubscription() {
      return { cancelAtPeriodEnd: true };
    },
  };
}
