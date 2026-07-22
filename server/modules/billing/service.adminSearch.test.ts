import { describe, expect, it, vi } from "vitest";
import { createBillingService } from "./service";
import type { BillingRepository } from "./types";

const NOW = new Date("2026-07-22T12:00:00.000Z");

function repository(): BillingRepository {
  return {
    recordProviderEvent: vi.fn(),
    listAccessCandidates: vi.fn(async () => [
      {
        reason: "sponsored_by_professional" as const,
        sourceId: "coverage-1",
        sponsorUserId: 88,
        planCode: "professional-base",
        entitlements: ["system_access"],
      },
    ]),
    getOwnSubscription: vi.fn(async () => ({
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
    })),
    getActiveProfessionalSubscription: vi.fn(async () => null),
    reserveProfessionalCapacity: vi.fn(async () => ({
      reserved: false as const,
      reason: "unavailable" as const,
    })),
    releaseProfessionalCapacity: vi.fn(async () => undefined),
    grantAdminOverride: vi.fn(),
    revokeAdminOverride: vi.fn(),
    getActiveAdminOverride: vi.fn(async () => null),
    listAdminOverrides: vi.fn(async () => []),
    searchUsers: vi.fn(async () => [
      {
        id: 15,
        name: "Paciente com cobertura",
        email: "paciente@example.com",
        phoneNumber: "5511999999999",
      },
    ]),
    getAdminAnalytics: vi.fn(),
  };
}

describe("billing admin user search", () => {
  it("returns payer subscription and sponsored access as separate facts", async () => {
    const repo = repository();
    const service = createBillingService({
      repository: repo,
      now: () => NOW,
      accessMode: () => "enforced",
    });

    await expect(
      service.searchAdminUsers({ query: "paciente", limit: 25 })
    ).resolves.toEqual([
      expect.objectContaining({
        id: 15,
        access: expect.objectContaining({
          reason: "sponsored_by_professional",
          sponsorUserId: 88,
          planCode: "professional-base",
        }),
        ownSubscription: expect.objectContaining({
          planCode: "individual-monthly",
          status: "past_due",
        }),
      }),
    ]);

    expect(repo.getOwnSubscription).toHaveBeenCalledWith(15, NOW);
    expect(repo.getActiveAdminOverride).toHaveBeenCalledWith(15, NOW);
  });
});
