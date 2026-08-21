import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getUserEntitlements: vi.fn(),
  listCatalog: vi.fn(),
  loadLifecycle: vi.fn(),
  prepareAsaasBillingFlow: vi.fn(),
  requestAsaasCancellation: vi.fn(),
  requestCancellation: vi.fn(),
}));

vi.mock("./service", () => ({
  billingService: {
    getUserSubscriptionStatus: mocks.getUserSubscriptionStatus,
    getUserEntitlements: mocks.getUserEntitlements,
  },
}));
vi.mock("./catalogRuntime", () => ({
  billingCatalogService: { listCatalog: mocks.listCatalog },
}));
vi.mock("./asaas/runtime", () => ({
  prepareAsaasBillingFlow: mocks.prepareAsaasBillingFlow,
  requestAsaasCancellation: mocks.requestAsaasCancellation,
}));
vi.mock("./subscriptionLifecycleRuntime", () => ({
  billingSubscriptionLifecycleRepository: { loadLifecycle: mocks.loadLifecycle },
  billingSubscriptionLifecycleService: {
    requestCancellation: mocks.requestCancellation,
  },
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

const noSubscriptionStatus = () => ({
  access: {
    allowed: false,
    reason: "no_access",
    entitlements: [],
    sourceAvailable: true,
    evaluatedAt: new Date(),
  },
  subscription: null,
  professionalSubscription: null,
});

const activeSubscription = () => ({
  id: "subscription-1",
  provider: "asaas",
  planCode: "individual",
  planName: "Individual",
  status: "active",
  billingCycle: "monthly",
  currency: "BRL",
  unitAmount: 1990,
  currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
  currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
  cancelAtPeriodEnd: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCatalog.mockResolvedValue(catalog);
  mocks.getUserSubscriptionStatus.mockResolvedValue(noSubscriptionStatus());
  mocks.getUserEntitlements.mockResolvedValue({
    allowed: false,
    reason: "no_access",
    entitlements: [],
    sourceAvailable: true,
    evaluatedAt: new Date(),
  });
  mocks.loadLifecycle.mockResolvedValue(null);
});

describe("billing web public boundary", () => {
  it("does not expose sponsor professional subscription to a covered patient", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
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
    expect(mocks.loadLifecycle).not.toHaveBeenCalled();
  });

  it("returns trial and recovery boundaries from the canonical lifecycle", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      ...noSubscriptionStatus(),
      subscription: activeSubscription(),
    });
    mocks.loadLifecycle.mockResolvedValue({
      state: "past_due",
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      trialStartedAt: new Date("2026-07-20T00:00:00.000Z"),
      trialEndsAt: new Date("2026-07-27T00:00:00.000Z"),
      firstChargeAt: new Date("2026-07-28T00:00:00.000Z"),
      graceStartedAt: new Date("2026-08-20T00:00:00.000Z"),
      graceEndsAt: new Date("2026-08-27T00:00:00.000Z"),
      suspendedAt: null,
      recoveryEndsAt: null,
      reconciliationRequired: true,
    });

    const result = await getBillingWebOverview(12);

    expect(mocks.loadLifecycle).toHaveBeenCalledWith("subscription-1");
    expect(result.lifecycle).toMatchObject({
      state: "past_due",
      reconciliationRequired: true,
    });
    expect(result.actions.canRegularize).toBe(true);
    expect(result.actions.canStartCheckout).toBe(false);
  });

  it("blocks a second self-service checkout while an own subscription exists", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      ...noSubscriptionStatus(),
      subscription: activeSubscription(),
    });

    await expect(
      startBillingWebCheckout({
        userId: 12,
        accountName: "Pessoa",
        accountEmail: "pessoa@example.com",
        payload: {
          contractKey: "web_contract_123456789",
          versionCode: "individual_monthly_v1",
          paymentMethod: "credit_card",
          trialChoice: "waive",
          couponCode: null,
          customer: {
            name: "Pessoa",
            email: null,
            mobilePhone: "15999999999",
            cpfCnpj: "12345678901",
          },
        },
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prepareAsaasBillingFlow).not.toHaveBeenCalled();
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
    expect(mocks.prepareAsaasBillingFlow).not.toHaveBeenCalled();
  });

  it("binds checkout to the authenticated payer and keeps browser result pending", async () => {
    const transitionUntil = new Date("2026-08-30T00:00:00.000Z");
    mocks.getUserEntitlements.mockResolvedValue({
      allowed: true,
      reason: "transition_access",
      validUntil: transitionUntil,
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: new Date(),
    });
    mocks.prepareAsaasBillingFlow.mockResolvedValue({
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

    expect(mocks.prepareAsaasBillingFlow).toHaveBeenCalledWith(
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
    mocks.requestAsaasCancellation.mockResolvedValue(undefined);
    mocks.requestCancellation.mockResolvedValue("applied");

    await cancelBillingWebSubscription({
      userId: 12,
      subscriptionId: "subscription-1",
    });

    expect(mocks.requestAsaasCancellation).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "subscription-1",
        payerUserId: 12,
      })
    );
    expect(mocks.requestCancellation).toHaveBeenCalledWith(
      "subscription-1",
      expect.stringContaining("billing-web-cancel:")
    );
  });
});
