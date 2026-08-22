import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getUserEntitlements: vi.fn(),
  listCatalog: vi.fn(),
  loadLifecycle: vi.fn(),
  getPlan: vi.fn(),
  getCapacity: vi.fn(),
  getManagement: vi.fn(),
  getHistory: vi.fn(),
  claimAttempt: vi.fn(),
  releaseAttempt: vi.fn(),
  prepareAsaasBillingFlow: vi.fn(),
  requestAsaasCancellation: vi.fn(),
  reactivateAsaasCancellation: vi.fn(),
  prepareEarlyConversion: vi.fn(),
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
vi.mock("./professionalCapacityRead", () => ({
  getProfessionalCapacityWebSnapshot: mocks.getCapacity,
}));
vi.mock("./subscriptionManagementRead", () => ({
  getSubscriptionManagementCapabilities: mocks.getManagement,
}));
vi.mock("./subscriptionHistoryRead", () => ({
  getSubscriptionWebHistory: mocks.getHistory,
}));
vi.mock("./billingWebCheckoutAttempt", () => ({
  claimBillingWebCheckoutAttempt: mocks.claimAttempt,
  releaseBillingWebCheckoutAttempt: mocks.releaseAttempt,
}));
vi.mock("./asaas/runtime", () => ({
  prepareAsaasBillingFlow: mocks.prepareAsaasBillingFlow,
  requestAsaasCancellation: mocks.requestAsaasCancellation,
  reactivateAsaasCancellation: mocks.reactivateAsaasCancellation,
}));
vi.mock("./asaas/remediationRuntime", () => ({
  prepareAsaasProfessionalEarlyConversion: mocks.prepareEarlyConversion,
}));
vi.mock("./subscriptionLifecycleRuntime", () => ({
  billingSubscriptionLifecycleRepository: {
    loadLifecycle: mocks.loadLifecycle,
    getPlan: mocks.getPlan,
  },
}));

import {
  activateProfessionalTrialNow,
  cancelBillingWebSubscription,
  getBillingWebOverview,
  reactivateBillingWebSubscription,
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

const activeSubscription = (cancelAtPeriodEnd = false) => ({
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
  cancelAtPeriodEnd,
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
  mocks.getCapacity.mockResolvedValue(null);
  mocks.getHistory.mockResolvedValue([]);
  mocks.claimAttempt.mockResolvedValue({
    status: "claimed",
    contractKey: "web_contract_123456789",
    reused: false,
    generation: 1,
    persist: true,
  });
  mocks.releaseAttempt.mockResolvedValue(false);
  mocks.getManagement.mockResolvedValue({
    provider: "asaas",
    paymentMethod: "credit_card",
    canReactivateRenewal: true,
    canUpdatePaymentMethod: false,
    requiresNewPixAuthorizationForReactivation: false,
  });
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
    expect(result.professionalCapacity).toBeNull();
    expect(mocks.getCapacity).not.toHaveBeenCalled();
  });

  it("returns lifecycle, sanitized history and only provider-supported actions", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      ...noSubscriptionStatus(),
      subscription: activeSubscription(true),
    });
    mocks.loadLifecycle.mockResolvedValue({
      state: "past_due",
      audience: "individual",
      productCode: "individual",
      versionCode: "individual_monthly_v1",
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
      cancelAtPeriodEnd: true,
      trialStartedAt: null,
      trialEndsAt: null,
      firstChargeAt: null,
      trialCapacityLimit: null,
      graceStartedAt: new Date("2026-08-20T00:00:00.000Z"),
      graceEndsAt: new Date("2026-08-27T00:00:00.000Z"),
      suspendedAt: null,
      recoveryEndsAt: null,
      reconciliationRequired: true,
    });
    mocks.getHistory.mockResolvedValue([
      { title: "Pagamento ficou pendente", occurredAt: new Date() },
    ]);

    const result = await getBillingWebOverview(12);

    expect(result.lifecycle).toMatchObject({ state: "past_due", reconciliationRequired: true });
    expect(result.history[0]?.title).toBe("Pagamento ficou pendente");
    expect(result.actions.canRegularize).toBe(true);
    expect(result.actions.canReactivateRenewal).toBe(true);
    expect(result.management?.canUpdatePaymentMethod).toBe(false);
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
    expect(mocks.claimAttempt).not.toHaveBeenCalled();
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
    expect(mocks.claimAttempt).not.toHaveBeenCalled();
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

    expect(mocks.claimAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 12,
        versionCode: "individual_monthly_v1",
        paymentMethod: "credit_card",
        trialChoice: "waive",
        couponCode: null,
      })
    );
    expect(mocks.prepareAsaasBillingFlow).toHaveBeenCalledWith(
      expect.objectContaining({
        contractKey: "web_contract_123456789",
        payerUserId: 12,
        transitionAccessUntil: transitionUntil,
        customer: expect.objectContaining({ payerUserId: 12, email: "conta@example.com" }),
      })
    );
    expect(result.pendingAuthoritativeConfirmation).toBe(true);
  });

  it("routes cancel and reactivation through authenticated Asaas operations", async () => {
    mocks.requestAsaasCancellation.mockResolvedValue("applied");
    mocks.reactivateAsaasCancellation.mockResolvedValue("applied");

    await cancelBillingWebSubscription({ userId: 12, subscriptionId: "subscription-1" });
    await reactivateBillingWebSubscription({ userId: 12, subscriptionId: "subscription-1" });

    expect(mocks.requestAsaasCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "subscription-1", payerUserId: 12 })
    );
    expect(mocks.reactivateAsaasCancellation).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionId: "subscription-1", payerUserId: 12 })
    );
  });

  it("builds professional early-conversion terms from backend state", async () => {
    const trialEndsAt = new Date(Date.now() + 86_400_000);
    mocks.loadLifecycle.mockResolvedValue({
      subscriptionId: "subscription-1",
      payerUserId: 12,
      state: "pending",
      audience: "professional",
      productCode: "professional",
      versionCode: "professional_monthly_v1",
      billingCycle: "monthly",
      trialStartedAt: new Date(),
      trialEndsAt,
    });
    mocks.getPlan.mockResolvedValue({
      productCode: "professional",
      versionCode: "professional_monthly_v1",
      audience: "professional",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 7990,
      capacityLimit: 30,
      entitlements: ["system_access"],
      commercialPaymentMethods: ["credit_card"],
    });
    mocks.prepareEarlyConversion.mockResolvedValue({
      confirmation: "applied",
      schedule: { state: "pending" },
      pendingAuthoritativeConfirmation: true,
    });

    const result = await activateProfessionalTrialNow({
      userId: 12,
      subscriptionId: "subscription-1",
    });

    expect(mocks.prepareEarlyConversion).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: "subscription-1",
        actorUserId: 12,
        versionCode: "professional_monthly_v1",
        unitAmount: 7990,
        capacityLimit: 30,
      })
    );
    expect(result.pendingAuthoritativeConfirmation).toBe(true);
  });
});
