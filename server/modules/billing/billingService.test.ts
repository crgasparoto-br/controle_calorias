import { afterEach, describe, expect, it } from "vitest";
import {
  createBillingCheckout,
  getUserSubscription,
  getUserSubscriptionStatus,
  listBillingPlans,
  processBillingWebhook,
  resetBillingStateForTests,
  userHasActiveSubscription,
} from "./billingService";
import { mapExternalBillingStatus } from "./billingTypes";

const user = {
  id: 42,
  openId: "local:test-user",
  name: "Usuário Teste",
  email: "teste@example.com",
  loginMethod: "password",
  role: "user" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

afterEach(() => {
  resetBillingStateForTests();
  delete process.env.BILLING_CHECKOUT_BASE_URL;
  delete process.env.BILLING_PLANS_JSON;
});

describe("billingService", () => {
  it("lista planos ativos configuraveis", async () => {
    const plans = await listBillingPlans();

    expect(plans).toHaveLength(1);
    expect(plans[0].code).toBe("core_monthly");
    expect(plans[0].active).toBe(true);
  });

  it("cria checkout externo e registra assinatura pendente", async () => {
    process.env.BILLING_CHECKOUT_BASE_URL = "https://checkout.example.com/pay";

    const subscription = await createBillingCheckout({
      user,
      planCode: "core_monthly",
      successUrl: "https://app.example.com/assinatura/sucesso",
      cancelUrl: "https://app.example.com/assinatura/cancelada",
    });

    expect(subscription.status).toBe("pending");
    expect(subscription.checkoutUrl).toContain("https://checkout.example.com/pay");
    expect(subscription.checkoutUrl).toContain("plan=core_monthly");
    await expect(getUserSubscription(user.id)).resolves.toEqual(subscription);
    await expect(getUserSubscriptionStatus(user.id)).resolves.toBe("pending");
  });

  it("nao ativa assinatura apenas pela criacao de checkout", async () => {
    process.env.BILLING_CHECKOUT_BASE_URL = "https://checkout.example.com/pay";

    await createBillingCheckout({ user, planCode: "core_monthly" });

    await expect(userHasActiveSubscription(user.id)).resolves.toBe(false);
  });

  it("ativa assinatura somente apos webhook confirmado", async () => {
    process.env.BILLING_CHECKOUT_BASE_URL = "https://checkout.example.com/pay";
    const subscription = await createBillingCheckout({ user, planCode: "core_monthly" });

    const result = await processBillingWebhook({
      providerEventId: "evt_approved_1",
      eventType: "payment.updated",
      subscriptionId: subscription.providerSubscriptionId ?? subscription.id,
      externalStatus: "approved",
      payload: { id: "evt_approved_1" },
    });

    expect(result.duplicate).toBe(false);
    await expect(getUserSubscriptionStatus(user.id)).resolves.toBe("active");
    await expect(userHasActiveSubscription(user.id)).resolves.toBe(true);
  });

  it("trata webhook duplicado sem reprocessar", async () => {
    const first = await processBillingWebhook({
      providerEventId: "evt_duplicate",
      eventType: "payment.updated",
      externalStatus: "pending",
    });
    const second = await processBillingWebhook({
      providerEventId: "evt_duplicate",
      eventType: "payment.updated",
      externalStatus: "approved",
    });

    expect(first.duplicate).toBe(false);
    expect(second.duplicate).toBe(true);
    expect(second.event).toEqual(first.event);
  });
});

describe("mapExternalBillingStatus", () => {
  it.each([
    ["approved", "active"],
    ["pending", "pending"],
    ["failed", "past_due"],
    ["cancelled", "canceled"],
    ["expired", "expired"],
  ] as const)("mapeia %s para %s", (externalStatus, internalStatus) => {
    expect(mapExternalBillingStatus(externalStatus)).toBe(internalStatus);
  });
});
