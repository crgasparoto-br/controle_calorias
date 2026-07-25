import { describe, expect, it, vi } from "vitest";
import { createBillingService } from "./service";
import type { BillingEntitlementCandidate, BillingRepository } from "./types";

const NOW = new Date("2026-07-22T12:00:00.000Z");

function candidate(
  reason: BillingEntitlementCandidate["reason"],
  overrides: Partial<BillingEntitlementCandidate> = {}
): BillingEntitlementCandidate {
  return {
    reason,
    sourceId: `${reason}-source`,
    entitlements: [`resource:${reason}`],
    ...overrides,
  };
}

function repository(
  overrides: Partial<BillingRepository> = {}
): BillingRepository {
  return {
    recordProviderEvent: vi.fn(async () => ({ id: "event-1", created: true })),
    listAccessCandidates: vi.fn(async () => []),
    getOwnSubscription: vi.fn(async () => null),
    getActiveProfessionalSubscription: vi.fn(async () => null),
    reserveProfessionalCapacity: vi.fn(async () => ({
      reserved: false,
      reason: "unavailable",
    })),
    releaseProfessionalCapacity: vi.fn(async () => undefined),
    grantAdminOverride: vi.fn(async input => ({
      id: "override-1",
      userId: input.userId,
      reason: input.reason,
      startsAt: input.startsAt ?? NOW,
      endsAt: input.endsAt ?? null,
      state: "active",
      grantedByUserId: input.grantedByUserId,
      revokedByUserId: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    revokeAdminOverride: vi.fn(async input => ({
      id: input.overrideId,
      userId: 10,
      reason: input.reason,
      startsAt: NOW,
      endsAt: null,
      state: "revoked",
      grantedByUserId: 1,
      revokedByUserId: input.revokedByUserId,
      revokedAt: NOW,
      createdAt: NOW,
      updatedAt: NOW,
    })),
    getActiveAdminOverride: vi.fn(async () => null),
    listAdminOverrides: vi.fn(async () => []),
    searchUsers: vi.fn(async () => []),
    getAdminAnalytics: vi.fn(async () => ({
      plans: [],
      subscriptionStatusTotals: {},
      activeOverrides: 0,
      usersWithoutCommercialAccess: 0,
      estimatedMonthlyRecurringRevenue: [],
      generatedAt: NOW,
    })),
    ...overrides,
  };
}

describe("billing entitlement service", () => {
  it("keeps open access as the safe rollout default", async () => {
    const service = createBillingService({
      repository: repository(),
      now: () => NOW,
      accessMode: () => "open_access",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: true,
      reason: "free_access",
      entitlements: ["system_access"],
    });
  });

  it("fails closed in enforced mode when persistence is unavailable", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: false,
      reason: "no_access",
      sourceAvailable: false,
    });
  });

  it("applies the binding precedence independently of repository ordering", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [
          candidate("read_only_access"),
          candidate("active_subscription"),
          candidate("transition_access"),
          candidate("active_trial"),
          candidate("sponsored_by_professional", { sponsorUserId: 55 }),
          candidate("admin_override"),
        ]),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: true,
      reason: "admin_override",
      entitlements: ["resource:admin_override"],
    });
  });

  it.each([
    ["sponsored_by_professional", "active_subscription"],
    ["active_subscription", "active_trial"],
    ["active_trial", "transition_access"],
    ["transition_access", "read_only_access"],
  ] as const)("prefers %s over %s", async (preferred, secondary) => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [
          candidate(secondary),
          candidate(preferred),
        ]),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      reason: preferred,
    });
  });

  it("ignores expired and future candidates before precedence", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [
          candidate("admin_override", {
            validUntil: new Date("2026-07-22T11:59:59.000Z"),
          }),
          candidate("sponsored_by_professional", {
            validFrom: new Date("2026-07-22T12:00:01.000Z"),
          }),
          candidate("transition_access"),
        ]),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      reason: "transition_access",
    });
  });

  it("returns the professional plan matrix as one own subscription without consuming patient capacity", async () => {
    const personalEntitlements = [
      "system_access",
      "patient_dashboard",
      "meal_registration",
    ];
    const professionalEntitlements = [
      "professional_dashboard",
      "professional_portfolio",
    ];
    const combinedEntitlements = [
      ...personalEntitlements,
      ...professionalEntitlements,
    ];
    const professionalSubscription = {
      id: "subscription-professional-1",
      provider: "manual",
      planId: "plan-professional",
      planCode: "professional-monthly",
      planName: "Profissional",
      status: "active" as const,
      billingCycle: "monthly" as const,
      currency: "BRL",
      unitAmount: 9990,
      currentPeriodStart: NOW,
      currentPeriodEnd: new Date("2026-08-22T12:00:00.000Z"),
      cancelAtPeriodEnd: false,
      capacityLimit: 25,
      capacityUsed: 7,
      entitlements: combinedEntitlements,
    };
    const listAccessCandidates = vi.fn(async () => [
      candidate("active_subscription", {
        sourceId: professionalSubscription.id,
        planCode: professionalSubscription.planCode,
        entitlements: professionalSubscription.entitlements,
      }),
    ]);
    const reserveProfessionalCapacity = vi.fn();
    const service = createBillingService({
      repository: repository({
        listAccessCandidates,
        getOwnSubscription: vi.fn(async () => professionalSubscription),
        getActiveProfessionalSubscription: vi.fn(
          async () => professionalSubscription
        ),
        reserveProfessionalCapacity,
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    const access = await service.getUserEntitlements(10);
    expect(access).toMatchObject({
      reason: "active_subscription",
      planCode: "professional-monthly",
      entitlements: [...combinedEntitlements].sort(),
    });
    expect(access.entitlements).toEqual(
      expect.arrayContaining(personalEntitlements)
    );
    expect(access.entitlements).toEqual(
      expect.arrayContaining(professionalEntitlements)
    );
    expect(listAccessCandidates).toHaveBeenCalledWith(10, NOW);

    await expect(service.getUserSubscriptionStatus(10)).resolves.toMatchObject({
      subscription: { id: "subscription-professional-1" },
      professionalSubscription: {
        capacityLimit: 25,
        capacityUsed: 7,
      },
    });
    expect(reserveProfessionalCapacity).not.toHaveBeenCalled();
  });

  it("requires an override end after its start", async () => {
    const repo = repository();
    const service = createBillingService({ repository: repo, now: () => NOW });

    await expect(
      service.grantAdminOverride({
        userId: 10,
        reason: "Suporte temporário",
        startsAt: NOW,
        endsAt: new Date("2026-07-22T11:00:00.000Z"),
        grantedByUserId: 1,
      })
    ).rejects.toThrow("vigência final");
    expect(repo.grantAdminOverride).not.toHaveBeenCalled();
  });
});
