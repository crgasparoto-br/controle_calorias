import type { BillingProvider, BillingCheckoutRequest } from "./billingProvider";
import type { BillingProviderCode } from "../billingTypes";

function getConfiguredProviderCode(): BillingProviderCode {
  const provider = process.env.BILLING_PROVIDER;
  if (provider === "mercadopago" || provider === "asaas" || provider === "sandbox") {
    return provider;
  }
  return "sandbox";
}

function getCheckoutBaseUrl() {
  return process.env.BILLING_CHECKOUT_BASE_URL || "https://checkout.example.invalid/controle-calorias";
}

export function createHostedCheckoutProvider(): BillingProvider {
  return {
    code: getConfiguredProviderCode(),
    async createCheckout(request: BillingCheckoutRequest) {
      const checkoutId = `checkout_${request.userId}_${request.plan.code}_${Date.now()}`;
      const url = new URL(getCheckoutBaseUrl());
      url.searchParams.set("checkout_id", checkoutId);
      url.searchParams.set("plan", request.plan.code);
      url.searchParams.set("user_id", String(request.userId));
      if (request.userEmail) url.searchParams.set("email", request.userEmail);

      return {
        checkoutUrl: url.toString(),
        providerCheckoutId: checkoutId,
        providerSubscriptionId: checkoutId,
      };
    },
    async cancelSubscription() {
      // Hosted checkout cancellation is provider-specific. The local status is updated by the service.
    },
  };
}
