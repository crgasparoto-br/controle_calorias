import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => vi.clearAllMocks());

  it("keeps access open by default when no commercial record exists", async () => {
    const service = createBillingService({
      repository: repository(),
      now: () => NOW,
      accessMode: () => "open_access",
    });

    await expect(service.getUserEntitlements(10)).resolves.toEqual({
      allowed: true,
      reason: "free_access",
      entitlements: ["system_access"],
      sourceAvailable: true,
      evaluatedAt: NOW,
    });
  });

  it("keeps access open when persistence is unavailable during rollout", async () => {
    const warning = vi.fn();
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => {
          throw new Error("database unavailable");
        }),
      }),
      now: () => NOW,
      accessMode: () => "open_access",
      onWarning: warning,
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: true,
      reason: "free_access",
      sourceAvailable: false,
    });
    expect(warning).toHaveBeenCalledWith(
      "billing_entitlements",
      expect.any(Error)
    );
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

  it("uses deterministic precedence independent of repository ordering", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [
          candidate("free_access"),
          candidate("admin_override"),
          candidate("active_trial"),
          candidate("sponsored_by_professional", { sponsorUserId: 55 }),
          candidate("active_subscription", {
            planCode: "professional-monthly",
          }),
        ]),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: true,
      reason: "active_subscription",
      planCode: "professional-monthly",
      entitlements: ["resource:active_subscription"],
    });
  });

  it("ignores expired and future candidates before applying precedence", async () => {
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [
          candidate("active_subscription", {
            validUntil: new Date("2026-07-22T11:59:59.000Z"),
          }),
          candidate("sponsored_by_professional", {
            validFrom: new Date("2026-07-22T12:00:01.000Z"),
          }),
          candidate("admin_override", {
            validUntil: new Date("2026-08-01T00:00:00.000Z"),
          }),
        ]),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserEntitlements(10)).resolves.toMatchObject({
      allowed: true,
      reason: "admin_override",
      validUntil: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("denies access in enforced mode when no valid source exists", async () => {
    const service = createBillingService({
      repository: repository(),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.userCanUseSystem(10)).resolves.toBe(false);
  });

  it("composes own subscription status with the effective access", async () => {
    const ownSubscription = {
      id: "subscription-1",
      provider: "manual",
      planCode: "individual-monthly",
      planName: "Individual",
      status: "past_due" as const,
      billingCycle: "monthly" as const,
      currency: "BRL",
      unitAmount: 1990,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
    const service = createBillingService({
      repository: repository({
        listAccessCandidates: vi.fn(async () => [candidate("admin_override")]),
        getOwnSubscription: vi.fn(async () => ownSubscription),
      }),
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(service.getUserSubscriptionStatus(10)).resolves.toEqual({
      access: expect.objectContaining({ reason: "admin_override" }),
      subscription: ownSubscription,
    });
  });

  it("requires an override end after its start", async () => {
    const repo = repository();
    const service = createBillingService({
      repository: repo,
      now: () => NOW,
    });

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

  it("filters admin user search by effective access reason", async () => {
    const activeOverride = {
      id: "11111111-1111-4111-8111-111111111111",
      userId: 20,
      reason: "Suporte temporário",
      startsAt: NOW,
      endsAt: null,
      state: "active" as const,
      grantedByUserId: 1,
      revokedByUserId: null,
      revokedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const repo = repository({
      searchUsers: vi.fn(async () => [
        { id: 10, name: "Ana", email: "ana@example.com", phoneNumber: null },
        { id: 20, name: "Bia", email: "bia@example.com", phoneNumber: null },
      ]),
      listAccessCandidates: vi.fn(async userId =>
        userId === 10
          ? [candidate("active_subscription")]
          : [candidate("admin_override")]
      ),
      getActiveAdminOverride: vi.fn(async userId =>
        userId === 20 ? activeOverride : null
      ),
    });
    const service = createBillingService({
      repository: repo,
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(
      service.searchAdminUsers({
        query: "",
        limit: 25,
        accessReason: "admin_override",
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 20,
        access: expect.objectContaining({ reason: "admin_override" }),
        activeOverride,
      }),
    ]);
  });

  it("continues paginating until a filtered access match is found", async () => {
    const users = Array.from({ length: 51 }, (_, index) => ({
      id: index + 1,
      name: `User ${String(index + 1).padStart(2, "0")}`,
      email: `user-${index + 1}@example.com`,
      phoneNumber: null,
    }));
    const searchUsers = vi.fn(
      async (_query: string, limit: number, offset = 0) =>
        users.slice(offset, offset + limit)
    );
    const repo = repository({
      searchUsers,
      listAccessCandidates: vi.fn(async userId =>
        userId === 51 ? [candidate("admin_override")] : []
      ),
    });
    const service = createBillingService({
      repository: repo,
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(
      service.searchAdminUsers({
        query: "",
        limit: 1,
        accessReason: "admin_override",
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 51,
        access: expect.objectContaining({ reason: "admin_override" }),
      }),
    ]);
    expect(searchUsers).toHaveBeenNthCalledWith(1, "", 50, 0);
    expect(searchUsers).toHaveBeenNthCalledWith(2, "", 50, 50);
  });

  it("loads override history with the same evaluation instant", async () => {
    const history = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        userId: 10,
        reason: "Suporte temporário",
        startsAt: NOW,
        endsAt: null,
        state: "active" as const,
        grantedByUserId: 1,
        revokedByUserId: null,
        revokedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ];
    const repo = repository({ listAdminOverrides: vi.fn(async () => history) });
    const service = createBillingService({ repository: repo, now: () => NOW });

    await expect(service.listAdminOverrides(10, 25)).resolves.toEqual(history);
    expect(repo.listAdminOverrides).toHaveBeenCalledWith(10, 25, NOW);
  });
});
