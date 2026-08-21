import { beforeEach, describe, expect, it, vi } from "vitest";

const getUserSubscriptionStatus = vi.fn();
const getUserEntitlements = vi.fn();
const listCatalog = vi.fn();
const prepareAsaasBillingFlow = vi.fn();
const requestAsaasCancellation = vi.fn();
const requestCancellation = vi.fn();

vi.mock("./service", () => ({
  billingService: {
    getUserSubscriptionStatus,
    getUserEntitlements,
  },
}));
vi.mock("./catalogRuntime", () => ({
  billingCatalogService: { listCatalog },
}));
vi.mock("./asaas/runtime", () => ({
  prepareAsaasBillingFlow,
  requestAsaasCancellation,
}));
vi.mock("./subscriptionLifecycleRuntime", () => ({
  billingSubscriptionLifecycleService: { requestCancellation },
}));

import {
  cancelBillingWebSubscription,
  getBillingWebOverview,
  startBillingWebCheckout,
} from "./webPublic";

const catalog = [
  {
    productCode: "individual",
    versionCode: "individual_monthly_v1",
    version: 1,
    audience: "individual" as const,
    name: "Individual",
    description: null,
    billingCycle: "monthly" as const,
    currency: "BRL" as const,
    unitAmount: 1990,
    capacityLimit: null,
    entitlements: ["system_access"],
    coveredBeneficiaryEntitlements: [],
    commercialPaymentMethods: ["credit_card" as const, "pix_automatic" as const],
    effectivePaymentMethods: ["credit_card" as const, "pix_automatic" as const],
    effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
    effectiveUntil: null,
    sortOrder: 1,
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listCatalog.mockResolvedValue(catalog);
  getUserEntitlements.mockResolvedValue({
    allowed: false,
    reason: "no_access",
    entitlements: [],
    sourceAvailable: true,
    evaluatedAt: new Date(),
  });
});

describe("billing web public boundary", () => {
  it("does not expose sponsor professional subscription to a covered patient", async () => {
    getUserSubscriptionStatus.mockResolvedValue({
      access: {
        allowed: true,
        reason: "sponsored_by_professional",
        sponsorUserId: 77,
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date(),
      },
      subscription: null,
      professionalSubscription: {
        id: "sponsor-subscription",
        provider: "asaas",
        planCode: "professional",
        planName: "Profissional",
        status: "active",
        billingCycle: "monthly",
        currency: "BRL",
        unitAmount: 9990,
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(),
        cancelAtPeriodEnd: false,
        planId: "private-plan",
        capacityLimit: 30,
        capacityUsed: 12,
        entitlements: ["professional_patients"],
      },
    });

    const result = await getBillingWebOverview(12);

    expect(result.sponsoredCoverage).toBe(true);
    expect(result.professionalSubscription).toBeNull();
  });

  it("requires explicit trial waiver for Pix Automático before calling the provider", async () => {
    await expect(
      startBillingWebCheckout({
        userId: 12,
        accountName: "Pessoa",
        accountEmail: "pessoa@example.com",
        payload: {
          contractKey: "web_contract_123456789",
          versionCode: "individual_monthly_v1",
          paymentMethod: "pix_automatic",
          trialChoice: "request",
          couponCode: null,
          customer: {
            name: "Pessoa",
            email: null,
            mobilePhone: "15999999999",
            cpfCnpj: "12345678901",
          },
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(prepareAsaasBillingFlow).not.toHaveBeenCalled();
  });

  it("binds checkout to the authenticated payer and keeps browser result pending", async () => {
    const transitionUntil = new Date("2026-08-30T00:00:00.000Z");
    getUserEntitlements.mockResolvedValue({
      allowed: true,
      reason: "transition_access",
      validUntil: transitionUntil,
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    });
    prepareAsaasBillingFlow.mockResolvedValue({
      flow: {
        kind: "hosted_checkout",
        provider: "asaas",
        externalId: "checkout-1",
        url: "https://example.test/checkout",
        state: "pending",
      },
      subscriptionId: null,
      pendingAuthoritativeConfirmation: true,
    });

    const result = await startBillingWebCheckout({
      userId: 12,
      accountName: "Conta",
      accountEmail: "conta@example.com",
      payload: {
        contractKey: "web_contract_123456789",
        versionCode: "individual_monthly_v1",
        paymentMethod: "credit_card",
        trialChoice: "waive",
        couponCode: null,
        customer: {
          name: "Pagador",
          email: "outro@example.com",
          mobilePhone: "15999999999",
          cpfCnpj: "12345678901",
        },
      },
    });

    expect(prepareAsaasBillingFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        payerUserId: 12,
        transitionAccessUntil: transitionUntil,
        customer: expect.objectContaining({
          payerUserId: 12,
          email: "conta@example.com",
        }),
      })
    );
    expect(result.pendingAuthoritativeConfirmation).toBe(true);
  });

  it("cancels only through the authenticated payer boundary", async () => {
    requestAsaasCancellation.mockResolvedValue(undefined);
    requestCancellation.mockResolvedValue("applied");

    await cancelBillingWebSubscription({
      userId: 12,
      subscriptionId: "subscription-1",
    });

    expect(requestAsaasCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "subscription-1",
        payerUserId: 12,
      })
    );
    expect(requestCancellation).toHaveBeenCalledWith(
      "subscription-1",
      expect.stringContaining("billing-web-cancel:")
    );
  });
});
