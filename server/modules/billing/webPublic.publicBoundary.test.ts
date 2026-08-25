import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getUserEntitlements: vi.fn(),
  listCatalog: vi.fn(),
  getKnownTrialEligibility: vi.fn(),
  getCapacity: vi.fn(),
  getCoverageRenewal: vi.fn(),
  getManagement: vi.fn(),
  getHistory: vi.fn(),
  loadLifecycle: vi.fn(),
  getPlan: vi.fn(),
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
vi.mock("./trialEligibilityRead", () => ({
  getKnownTrialEligibility: mocks.getKnownTrialEligibility,
}));
vi.mock("./professionalCapacityRead", () => ({
  getProfessionalCapacityWebSnapshot: mocks.getCapacity,
}));
vi.mock("./professionalCoverageRenewalRead", () => ({
  getProfessionalCoverageIndividualRenewalSnapshot: mocks.getCoverageRenewal,
}));
vi.mock("./subscriptionManagementRead", () => ({
  getSubscriptionManagementCapabilities: mocks.getManagement,
}));
vi.mock("./subscriptionHistoryRead", () => ({
  getSubscriptionWebHistory: mocks.getHistory,
}));
vi.mock("./subscriptionLifecycleRuntime", () => ({
  billingSubscriptionLifecycleRepository: {
    loadLifecycle: mocks.loadLifecycle,
    getPlan: mocks.getPlan,
  },
}));
vi.mock("./billingWebCheckoutAttempt", () => ({
  claimBillingWebCheckoutAttempt: vi.fn(),
  releaseBillingWebCheckoutAttempt: vi.fn(),
}));
vi.mock("./asaas/runtime", () => ({
  prepareAsaasBillingFlow: vi.fn(),
  requestAsaasCancellation: vi.fn(),
  reactivateAsaasCancellation: vi.fn(),
}));
vi.mock("./asaas/regularizationRuntime", () => ({
  prepareAsaasRegularization: vi.fn(),
}));
vi.mock("./asaas/remediationRuntime", () => ({
  prepareAsaasProfessionalEarlyConversion: vi.fn(),
}));

import { getBillingWebOverview } from "./webPublic";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listCatalog.mockResolvedValue([]);
  mocks.getKnownTrialEligibility.mockResolvedValue({
    individual: { eligible: true, reason: "eligible" },
    professional: { eligible: true, reason: "eligible" },
  });
  mocks.getCoverageRenewal.mockResolvedValue(null);
  mocks.getManagement.mockResolvedValue(null);
  mocks.getHistory.mockResolvedValue([]);
  mocks.loadLifecycle.mockResolvedValue(null);
});

describe("billing web public boundary", () => {
  it("does not serialize sponsor financial or capacity fields for a covered patient", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      access: {
        allowed: true,
        reason: "sponsored_by_professional",
        sponsorUserId: 77,
        entitlements: ["system_access"],
        sourceAvailable: true,
        evaluatedAt: new Date("2026-08-25T00:00:00.000Z"),
      },
      subscription: null,
      professionalSubscription: {
        id: "sponsor-subscription",
        provider: "asaas",
        providerCustomerId: "sponsor-private-financial-token",
        planCode: "professional",
        planId: "sponsor-private-plan-token",
        planName: "Profissional",
        status: "past_due",
        billingCycle: "annual",
        currency: "BRL",
        unitAmount: 987654,
        capacityLimit: 9876,
        capacityUsed: 4321,
        currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
        currentPeriodEnd: new Date("2027-08-01T00:00:00.000Z"),
        cancelAtPeriodEnd: false,
        entitlements: ["professional_patients"],
      },
    });

    const result = await getBillingWebOverview(12);
    const publicPayload = JSON.stringify(result);

    expect(result.sponsoredCoverage).toBe(true);
    expect(result.professionalSubscription).toBeNull();
    expect(result.professionalCapacity).toBeNull();
    expect(mocks.getCapacity).not.toHaveBeenCalled();
    expect(mocks.getManagement).not.toHaveBeenCalled();
    expect(mocks.getHistory).not.toHaveBeenCalled();
    expect(publicPayload).not.toContain("sponsor-private-financial-token");
    expect(publicPayload).not.toContain("sponsor-private-plan-token");
    expect(publicPayload).not.toContain("987654");
    expect(publicPayload).not.toContain("9876");
  });
});
