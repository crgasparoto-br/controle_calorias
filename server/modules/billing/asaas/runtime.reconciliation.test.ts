import { describe, expect, it, vi } from "vitest";
import type { AsaasOperation } from "./operationStore";
import {
  reconcileAsaasContractWithRuntime,
  selectHostedCheckoutInitialPayment,
  type Runtime,
} from "./runtime";

function checkoutOperation(): AsaasOperation {
  return {
    id: "op-1",
    kind: "checkout",
    operationKey: "contract-1:checkout",
    state: "created",
    subscriptionId: "sub-local-1",
    externalId: "checkout-1",
    externalReference: "contract-1",
    customerReference: null,
    authorizationReference: null,
    publicReference: "https://asaas.example/checkout-1",
    payerUserId: 7,
    planCode: "individual-yearly-v1",
    paymentMethod: "credit_card",
    trialChoice: "waive",
    couponCode: null,
    billingCycle: "yearly",
    correlationId: "attempt-1",
    amountMinor: 35900,
    unitAmountMinor: 35900,
    discountDurationCharges: null,
    transitionAccessUntil: null,
    dueDate: "2026-08-14",
    updatedAt: new Date("2026-08-13T18:08:19.000Z"),
  };
}

function matchingPayment(id = "pay-1") {
  return {
    id,
    dateCreated: "2026-08-13",
    status: "PENDING",
    customer: "cus-1",
    subscription: "sub-remote-1",
    billingType: "CREDIT_CARD",
    dueDate: "2026-08-14",
    value: 359,
    externalReference: null,
  };
}

describe("Asaas contract reconciliation", () => {
  it("selects the exact initial payment and fails closed for ambiguous matches", () => {
    expect(
      selectHostedCheckoutInitialPayment({
        checkout: checkoutOperation(),
        externalSubscriptionId: "sub-remote-1",
        customerReference: "cus-1",
        payments: [matchingPayment()],
      })
    ).toMatchObject({ id: "pay-1", status: "PENDING" });
    expect(() =>
      selectHostedCheckoutInitialPayment({
        checkout: checkoutOperation(),
        externalSubscriptionId: "sub-remote-1",
        customerReference: "cus-1",
        payments: [matchingPayment("pay-1"), matchingPayment("pay-2")],
      })
    ).toThrow("asaas_checkout_payment_reconciliation_ambiguous");
  });

  it("correlates the existing subscription while preserving a pending payment", async () => {
    const checkout = checkoutOperation();
    const reconcileSubscriptionCreated = vi.fn().mockResolvedValue({
      subscriptionId: "sub-local-1",
    });
    const reconcileFinancialPayment = vi.fn().mockResolvedValue({
      processed: false,
      status: "PENDING",
    });
    const runtime = {
      store: {
        get: vi.fn().mockResolvedValue(checkout),
      },
      adapter: {
        findHostedCheckoutSubscription: vi.fn().mockResolvedValue({
          subscription: {
            id: "sub-remote-1",
            customer: "cus-1",
          },
          matchedBy: "checkout_fingerprint",
        }),
        listSubscriptionPayments: vi
          .fn()
          .mockResolvedValue([matchingPayment()]),
      },
      webhook: {
        reconcileSubscriptionCreated,
        reconcileFinancialPayment,
        processDueEvents: vi.fn().mockResolvedValue(0),
      },
    } as unknown as Runtime;

    await expect(
      reconcileAsaasContractWithRuntime("contract-1", runtime)
    ).resolves.toMatchObject({
      found: true,
      matchedBy: "checkout_fingerprint",
      subscriptionId: "sub-local-1",
      externalSubscriptionId: "sub-remote-1",
      paymentId: "pay-1",
      financial: { processed: false, status: "PENDING" },
    });
    expect(reconcileSubscriptionCreated).toHaveBeenCalledWith({
      contractKey: "contract-1",
      externalSubscriptionId: "sub-remote-1",
      customerReference: "cus-1",
    });
    expect(reconcileFinancialPayment).toHaveBeenCalledWith({
      subscriptionId: "sub-local-1",
      externalSubscriptionId: "sub-remote-1",
      payment: matchingPayment(),
    });
  });

  it("does not correlate anything when no subscription fingerprint matches", async () => {
    const reconcileSubscriptionCreated = vi.fn();
    const runtime = {
      store: { get: vi.fn().mockResolvedValue(checkoutOperation()) },
      adapter: {
        findHostedCheckoutSubscription: vi.fn().mockResolvedValue(null),
      },
      webhook: { reconcileSubscriptionCreated },
    } as unknown as Runtime;
    await expect(
      reconcileAsaasContractWithRuntime("contract-1", runtime)
    ).resolves.toEqual({ found: false, reason: "subscription_not_found" });
    expect(reconcileSubscriptionCreated).not.toHaveBeenCalled();
  });
});
