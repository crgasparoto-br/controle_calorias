import { beforeEach, describe, expect, it, vi } from "vitest";
import { listBillingEventsForTests } from "./billingRepository";
import {
  BillingError,
  billingStatusMappingForTests,
  cancelBillingSubscription,
  createBillingCheckout,
  getUserSubscriptionStatus,
  processBillingWebhook,
  requireActiveSubscription,
  resetBillingStateForTests,
  setBillingProviderForTests,
  userHasActiveSubscription,
} from "./billingService";
import { createBillingWebhookSignature } from "./webhookSecurity";
import type { BillingProvider } from "./providers/billingProvider";

describe("billing service", () => {
  const user = { id: 42, email: "ana@example.com", name: "Ana" };
  const provider: BillingProvider = {
    code: "sandbox",
    createCheckout: vi.fn(async request => ({
      checkoutUrl: `https://checkout.local/${request.plan.code}`,
      providerCheckoutId: "checkout-1",
      providerSubscriptionId: "sub-1",
    })),
    cancelSubscription: vi.fn(async () => undefined),
  };

  beforeEach(() => {
    delete process.env.BILLING_WEBHOOK_SECRET;
    resetBillingStateForTests();
    vi.clearAllMocks();
    setBillingProviderForTests(provider);
  });

  it("lista planos e cria checkout mantendo assinatura pendente", async () => {
    const checkout = await createBillingCheckout(user, { planCode: "pro_mensal" });

    expect(checkout.checkoutUrl).toBe("https://checkout.local/pro_mensal");
    expect(checkout.subscription.status).toBe("pending");
    expect(userHasActiveSubscription(user.id)).toBe(false);
    expect(provider.createCheckout).toHaveBeenCalledTimes(1);
  });

  it("ativa assinatura somente quando webhook confirmado chega ao backend", async () => {
    await createBillingCheckout(user, { planCode: "pro_mensal" });

    const result = await processBillingWebhook({
      provider: "sandbox",
      providerEventId: "evt-1",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      occurredAt: "2026-07-01T12:00:00.000Z",
      payload: { id: "evt-1" },
    });

    expect(result.processed).toBe(true);
    const snapshot = getUserSubscriptionStatus(user.id);
    expect(snapshot.status).toBe("active");
    expect(snapshot.hasActiveSubscription).toBe(true);
    expect(snapshot.subscription?.currentPeriodEnd?.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });

  it("não reprocessa webhook duplicado", async () => {
    await createBillingCheckout(user, { planCode: "pro_mensal" });
    const webhook = {
      provider: "sandbox" as const,
      providerEventId: "evt-dup",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      occurredAt: "2026-07-01T12:00:00.000Z",
      payload: { id: "evt-dup" },
    };

    await processBillingWebhook(webhook);
    const duplicate = await processBillingWebhook({ ...webhook, status: "canceled" });

    expect(duplicate.duplicate).toBe(true);
    expect(getUserSubscriptionStatus(user.id).status).toBe("active");
  });

  it("rejeita webhook inválido e registra evento para auditoria sem bloquear o evento válido", async () => {
    process.env.BILLING_WEBHOOK_SECRET = "secret-for-tests";

    await expect(processBillingWebhook({
      provider: "sandbox",
      providerEventId: "evt-invalid",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      signature: "invalid",
      verificationPayload: JSON.stringify({ providerEventId: "evt-invalid" }),
      payload: { providerEventId: "evt-invalid" },
    })).rejects.toMatchObject({ code: "INVALID_WEBHOOK_SIGNATURE" });

    expect(listBillingEventsForTests()).toEqual([
      expect.objectContaining({ providerEventId: "invalid:evt-invalid", processingError: "invalid_signature" }),
    ]);
  });

  it("aceita webhook assinado quando segredo está configurado", async () => {
    process.env.BILLING_WEBHOOK_SECRET = "secret-for-tests";
    await createBillingCheckout(user, { planCode: "pro_mensal" });
    const verificationPayload = JSON.stringify({ providerEventId: "evt-signed" });

    await processBillingWebhook({
      provider: "sandbox",
      providerEventId: "evt-signed",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      signature: createBillingWebhookSignature(verificationPayload, process.env.BILLING_WEBHOOK_SECRET),
      verificationPayload,
      payload: { providerEventId: "evt-signed" },
    });

    expect(getUserSubscriptionStatus(user.id).status).toBe("active");
  });

  it("cancela assinatura respeitando fim do período quando ativo", async () => {
    await createBillingCheckout(user, { planCode: "pro_mensal" });
    await processBillingWebhook({
      provider: "sandbox",
      providerEventId: "evt-cancel",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      payload: { id: "evt-cancel" },
    });

    const result = await cancelBillingSubscription(user.id, { cancelAtPeriodEnd: true });

    expect(result.subscription?.status).toBe("active");
    expect(result.subscription?.cancelAtPeriodEnd).toBe(true);
    expect(provider.cancelSubscription).toHaveBeenCalledWith("sub-1");
  });

  it("bloqueia e libera helpers premium conforme assinatura ativa", async () => {
    expect(userHasActiveSubscription(user.id)).toBe(false);
    expect(() => requireActiveSubscription(user.id)).toThrow(BillingError);

    await createBillingCheckout(user, { planCode: "pro_mensal" });
    await processBillingWebhook({
      provider: "sandbox",
      providerEventId: "evt-premium",
      eventType: "payment.approved",
      providerSubscriptionId: "sub-1",
      status: "approved",
      payload: { id: "evt-premium" },
    });

    expect(userHasActiveSubscription(user.id)).toBe(true);
    expect(requireActiveSubscription(user.id).hasActiveSubscription).toBe(true);
  });

  it("mapeia status externos para status internos", () => {
    expect(billingStatusMappingForTests.mapExternalStatus("approved")).toBe("active");
    expect(billingStatusMappingForTests.mapExternalStatus("OVERDUE")).toBe("past_due");
    expect(billingStatusMappingForTests.mapExternalStatus("cancelled")).toBe("canceled");
    expect(billingStatusMappingForTests.mapExternalStatus("expired")).toBe("expired");
    expect(billingStatusMappingForTests.mapExternalStatus("waiting_payment")).toBe("pending");
  });
});
