import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getUserEntitlements: vi.fn(),
  claimAttempt: vi.fn(),
  releaseAttempt: vi.fn(),
  prepareAsaasBillingFlow: vi.fn(),
}));

vi.mock("./service", () => ({
  billingService: {
    getUserSubscriptionStatus: mocks.getUserSubscriptionStatus,
    getUserEntitlements: mocks.getUserEntitlements,
  },
}));
vi.mock("./billingWebCheckoutAttempt", () => ({
  claimBillingWebCheckoutAttempt: mocks.claimAttempt,
  releaseBillingWebCheckoutAttempt: mocks.releaseAttempt,
}));
vi.mock("./asaas/runtime", () => ({
  prepareAsaasBillingFlow: mocks.prepareAsaasBillingFlow,
  requestAsaasCancellation: vi.fn(),
  reactivateAsaasCancellation: vi.fn(),
}));
vi.mock("./asaas/remediationRuntime", () => ({
  prepareAsaasProfessionalEarlyConversion: vi.fn(),
}));
vi.mock("./catalogRuntime", () => ({
  billingCatalogService: { listCatalog: vi.fn() },
}));
vi.mock("./professionalCapacityRead", () => ({
  getProfessionalCapacityWebSnapshot: vi.fn(),
}));
vi.mock("./subscriptionHistoryRead", () => ({
  getSubscriptionWebHistory: vi.fn(),
}));
vi.mock("./subscriptionManagementRead", () => ({
  getSubscriptionManagementCapabilities: vi.fn(),
}));
vi.mock("./subscriptionLifecycleRuntime", () => ({
  billingSubscriptionLifecycleRepository: {
    loadLifecycle: vi.fn(),
    getPlan: vi.fn(),
  },
}));

import { startBillingWebCheckout } from "./webPublic";

function payload(contractKey: string, paymentMethod: "credit_card" | "pix_automatic" = "credit_card") {
  return {
    contractKey,
    versionCode: "individual_monthly_v1",
    paymentMethod,
    trialChoice: "waive" as const,
    couponCode: null,
    customer: {
      name: "Pessoa",
      email: null,
      mobilePhone: "15999999999",
      cpfCnpj: "12345678901",
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUserSubscriptionStatus.mockResolvedValue({
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
  mocks.getUserEntitlements.mockResolvedValue({
    allowed: false,
    reason: "no_access",
    entitlements: [],
    sourceAvailable: true,
    evaluatedAt: new Date(),
  });
  mocks.claimAttempt.mockResolvedValue({
    status: "claimed",
    contractKey: "web_server_canonical",
    reused: true,
    generation: 1,
    persist: false,
  });
  mocks.releaseAttempt.mockResolvedValue(true);
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
});

describe("billing web checkout cross-tab idempotency", () => {
  it("ignores different browser-generated keys and uses the same server canonical attempt", async () => {
    await Promise.all([
      startBillingWebCheckout({
        userId: 12,
        accountName: "Conta",
        accountEmail: "conta@example.com",
        payload: payload("web_tab_a_123456"),
      }),
      startBillingWebCheckout({
        userId: 12,
        accountName: "Conta",
        accountEmail: "conta@example.com",
        payload: payload("web_tab_b_123456"),
      }),
    ]);

    expect(mocks.prepareAsaasBillingFlow).toHaveBeenCalledTimes(2);
    for (const call of mocks.prepareAsaasBillingFlow.mock.calls) {
      expect(call[0]).toMatchObject({
        contractKey: "web_server_canonical",
        payerUserId: 12,
        versionCode: "individual_monthly_v1",
        paymentMethod: "credit_card",
      });
    }
  });

  it("blocks an incompatible concurrent attempt before any provider call", async () => {
    mocks.claimAttempt.mockResolvedValueOnce({
      status: "conflict",
      contractKey: "web_current",
      versionCode: "individual_monthly_v1",
      paymentMethod: "credit_card",
      trialChoice: "waive",
      couponCode: null,
    });

    await expect(
      startBillingWebCheckout({
        userId: 12,
        accountName: "Conta",
        accountEmail: "conta@example.com",
        payload: payload("web_tab_pix_123456", "pix_automatic"),
      })
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.prepareAsaasBillingFlow).not.toHaveBeenCalled();
  });

  it("releases only a safely failed pre-provider claim so a corrected retry can rotate", async () => {
    mocks.prepareAsaasBillingFlow.mockRejectedValueOnce(
      new Error("billing_coupon_user_limit_reached")
    );

    await expect(
      startBillingWebCheckout({
        userId: 12,
        accountName: "Conta",
        accountEmail: "conta@example.com",
        payload: {
          ...payload("web_bad_coupon_123456"),
          couponCode: "INVALID",
        },
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    expect(mocks.releaseAttempt).toHaveBeenCalledWith({
      userId: 12,
      contractKey: "web_server_canonical",
      reason: "billing_coupon_user_limit_reached",
    });
  });
});
