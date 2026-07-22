import { describe, expect, it, vi } from "vitest";
import { PROFESSIONAL_ENTITLEMENT_RESOURCES } from "../professionals/entitlementService";
import { createBillingProfessionalEntitlementProvider } from "./professionalProvider";

const NOW = new Date("2026-07-22T12:00:00.000Z");

function access(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: "active_subscription",
    planCode: "professional-monthly",
    entitlements: ["professional_dashboard", "professional_portfolio"],
    sourceAvailable: true,
    evaluatedAt: NOW,
    ...overrides,
  };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "subscription-1",
    provider: "manual",
    planId: "plan-1",
    planCode: "professional-monthly",
    planName: "Profissional",
    status: "active",
    billingCycle: "monthly",
    currency: "BRL",
    unitAmount: 4990,
    currentPeriodStart: NOW,
    currentPeriodEnd: new Date("2026-08-22T12:00:00.000Z"),
    cancelAtPeriodEnd: false,
    capacityLimit: 10,
    capacityUsed: 3,
    entitlements: ["professional_dashboard", "professional_portfolio"],
    ...overrides,
  };
}

function dependencies(input: {
  access?: Record<string, unknown>;
  subscription?: Record<string, unknown> | null;
} = {}) {
  const service = {
    getUserEntitlements: vi.fn(async () => access(input.access)),
  };
  const repository = {
    getActiveProfessionalSubscription: vi.fn(async () =>
      input.subscription === null
        ? null
        : subscription(input.subscription)
    ),
    reserveProfessionalCapacity: vi.fn(async () => ({
      reserved: true as const,
      reservationId: "allocation-1",
    })),
    releaseProfessionalCapacity: vi.fn(async () => undefined),
  };
  return { service, repository };
}

describe("billing professional entitlement provider", () => {
  it("maps the canonical subscription and capacity without local billing rules", async () => {
    const deps = dependencies();
    const provider = createBillingProfessionalEntitlementProvider(deps as any);

    await expect(provider.getEntitlements(10)).resolves.toEqual({
      allowed: true,
      reason: "active_subscription",
      validUntil: null,
      planCode: "professional-monthly",
      planName: "Profissional",
      entitlements: ["professional_dashboard", "professional_portfolio"],
      capacity: { limit: 10, used: 3 },
    });
    expect(deps.service.getUserEntitlements).toHaveBeenCalledWith(10);
    expect(deps.repository.getActiveProfessionalSubscription).toHaveBeenCalledWith(
      10,
      expect.any(Date)
    );
  });

  it("turns an admin override into full professional access without a fake subscription", async () => {
    const deps = dependencies({
      access: {
        reason: "admin_override",
        entitlements: ["system_access"],
      },
      subscription: null,
    });
    const provider = createBillingProfessionalEntitlementProvider(deps as any);

    const result = await provider.getEntitlements(10);

    expect(result).toMatchObject({
      allowed: true,
      reason: "admin_override",
      planName: "Liberação administrativa",
      capacity: { limit: null, used: null },
    });
    expect(result.entitlements).toEqual([...PROFESSIONAL_ENTITLEMENT_RESOURCES]);
  });

  it("does not convert sponsorship as a patient into professional access", async () => {
    const deps = dependencies({
      access: {
        reason: "sponsored_by_professional",
        sponsorUserId: 55,
      },
      subscription: null,
    });
    const provider = createBillingProfessionalEntitlementProvider(deps as any);

    await expect(provider.getEntitlements(10)).resolves.toMatchObject({
      allowed: false,
      reason: "no_access",
    });
  });

  it("delegates reservation and release to the central repository", async () => {
    const deps = dependencies();
    const provider = createBillingProfessionalEntitlementProvider(deps as any);
    const input = {
      professionalUserId: 10,
      patientUserId: 20,
      coverageKey: "professional-authorization:authorization-1",
    };

    await expect(provider.reserveCapacity?.(input)).resolves.toEqual({
      reserved: true,
      reservationId: "allocation-1",
    });
    await expect(provider.releaseCapacity?.(input)).resolves.toBeUndefined();
    expect(deps.repository.reserveProfessionalCapacity).toHaveBeenCalledWith(input);
    expect(deps.repository.releaseProfessionalCapacity).toHaveBeenCalledWith(input);
  });
});
