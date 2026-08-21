import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBillingService } from "./service";
import type { BillingRepository } from "./types";
import { mapSubscription } from "../../repositories/billingRepositorySupport";

const NOW = new Date("2026-08-18T09:00:00.000Z");

function repository(overrides: Partial<BillingRepository> = {}): BillingRepository {
  return {
    recordProviderEvent: vi.fn(async () => ({ id: "event", created: true })),
    listAccessCandidates: vi.fn(async () => []),
    getOwnSubscription: vi.fn(async () => null),
    getActiveProfessionalSubscription: vi.fn(async () => null),
    reserveProfessionalCapacity: vi.fn(async () => ({ reserved: false, reason: "unavailable" })),
    releaseProfessionalCapacity: vi.fn(async () => undefined),
    grantAdminOverride: vi.fn() as BillingRepository["grantAdminOverride"],
    revokeAdminOverride: vi.fn() as BillingRepository["revokeAdminOverride"],
    getActiveAdminOverride: vi.fn(async () => null),
    listAdminOverrides: vi.fn(async () => []),
    searchUsers: vi.fn(async () => []),
    getAdminAnalytics: vi.fn(async () => ({
      plans: [], subscriptionStatusTotals: {}, activeOverrides: 0,
      usersWithoutCommercialAccess: 0, estimatedMonthlyRecurringRevenue: [], generatedAt: NOW,
    })),
    ...overrides,
  };
}

describe("billing commercial identity audit remediation", () => {
  it("selects product and version identity from billing catalog joins", () => {
    const source = readFileSync(
      new URL("../../repositories/billingAccessRepository.ts", import.meta.url),
      "utf8",
    );
    expect(source.match(/bp\.code AS productCode/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(source.match(/p\.versionCode/g)?.length ?? 0).toBeGreaterThanOrEqual(5);
    expect(source).toContain("INNER JOIN billingProducts bp ON bp.id = p.productId");
  });

  it("keeps plan code, product code and version code as distinct subscription fields", () => {
    const mapped = mapSubscription({
      id: "sub-1",
      provider: "manual",
      planCode: "professional-monthly",
      productCode: "professional-product",
      versionCode: "professional-version-7",
      planName: "Professional",
      status: "active",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 14900,
      currentPeriodStart: NOW,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    });

    expect(mapped).toMatchObject({
      planCode: "professional-monthly",
      productCode: "professional-product",
      versionCode: "professional-version-7",
    });
    expect(mapped.planCode).not.toBe(mapped.versionCode);
  });


  it("resolves sponsored professional identity from the sponsor rather than the patient", async () => {
    const getActiveProfessionalSubscription = vi.fn(async () => ({
      id: "sub-pro", provider: "manual", planId: "plan-pro",
      planCode: "professional-monthly", productCode: "professional-product",
      versionCode: "professional-version-7", planName: "Professional",
      status: "active" as const, billingCycle: "monthly" as const, currency: "BRL",
      unitAmount: 14900, currentPeriodStart: NOW, currentPeriodEnd: null,
      cancelAtPeriodEnd: false, capacityLimit: 25, capacityUsed: 3, entitlements: ["system_access"],
    }));
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [{
          reason: "sponsored_by_professional",
          sourceId: "coverage-1",
          sponsorUserId: 77,
          planCode: "professional-monthly",
          productCode: "professional-product",
          versionCode: "professional-version-7",
          entitlements: ["system_access"],
        }]),
        getActiveProfessionalSubscription,
      }),
      accessMode: () => "enforced",
      now: () => NOW,
    });

    const status = await service.getUserSubscriptionStatus(99);

    expect(getActiveProfessionalSubscription).toHaveBeenCalledWith(77, NOW);
    expect(status.professionalSubscription).toMatchObject({
      id: "sub-pro",
      productCode: "professional-product",
      versionCode: "professional-version-7",
    });
  });

  it("propagates product/version from the selected entitlement without relabeling planCode", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [{
          reason: "active_subscription",
          sourceId: "sub-1",
          planCode: "professional-monthly",
          productCode: "professional-product",
          versionCode: "professional-version-7",
          entitlements: ["system_access"],
        }]),
      }),
      accessMode: () => "enforced",
      now: () => NOW,
    });

    await expect(service.getUserEntitlements(7)).resolves.toMatchObject({
      planCode: "professional-monthly",
      productCode: "professional-product",
      versionCode: "professional-version-7",
    });
  });
});
