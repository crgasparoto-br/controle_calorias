import { afterEach, describe, expect, it, vi } from "vitest";
import {
  _forTestOnly_setProfessionalEntitlementProvider,
  assertProfessionalCapacityAvailable,
  getProfessionalEntitlements,
  ProfessionalCapacityExceededError,
  ProfessionalCapacityUnavailableError,
  PROFESSIONAL_ENTITLEMENT_RESOURCES,
  withProfessionalCapacityReservation,
} from "./entitlementService";

const previousMode = process.env.BILLING_ACCESS_MODE;

function enabledResult(overrides: Record<string, unknown> = {}) {
  return {
    allowed: true,
    reason: "active_subscription" as const,
    planCode: "professional-test",
    planName: "Profissional Teste",
    entitlements: [...PROFESSIONAL_ENTITLEMENT_RESOURCES],
    capacity: null,
    ...overrides,
  };
}

afterEach(() => {
  _forTestOnly_setProfessionalEntitlementProvider(null);
  if (previousMode === undefined) delete process.env.BILLING_ACCESS_MODE;
  else process.env.BILLING_ACCESS_MODE = previousMode;
});

describe("professional entitlement service", () => {
  it("preserves access while billing is in open mode", async () => {
    delete process.env.BILLING_ACCESS_MODE;

    const snapshot = await getProfessionalEntitlements(101);

    expect(snapshot.allowed).toBe(true);
    expect(snapshot.reason).toBe("free_access");
    expect(snapshot.mode).toBe("open_access");
    expect(snapshot.enabledResources).toEqual(PROFESSIONAL_ENTITLEMENT_RESOURCES);
    expect(snapshot.capacity).toEqual({
      limit: null,
      used: null,
      available: null,
      usageAvailable: false,
    });
  });

  it("uses the open-mode fallback when the provider fails", async () => {
    process.env.BILLING_ACCESS_MODE = "open_access";
    _forTestOnly_setProfessionalEntitlementProvider(async () => {
      throw new Error("provider unavailable");
    });

    const snapshot = await getProfessionalEntitlements(102);

    expect(snapshot.allowed).toBe(true);
    expect(snapshot.fallbackUsed).toBe(true);
    expect(snapshot.providerAvailable).toBe(false);
  });

  it("fails closed in enforced mode when the provider is unavailable", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";

    const snapshot = await getProfessionalEntitlements(103);

    expect(snapshot.allowed).toBe(false);
    expect(snapshot.commercialState).toBe("unavailable");
    expect(snapshot.enabledResources).toEqual([]);
  });

  it("does not infer commercial usage when the central provider omits it", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () =>
      enabledResult({ capacity: { limit: 5 } })
    );

    const snapshot = await getProfessionalEntitlements(104);

    expect(snapshot.capacity.limit).toBe(5);
    expect(snapshot.capacity.used).toBeNull();
    expect(snapshot.capacity.available).toBeNull();
    expect(snapshot.capacity.usageAvailable).toBe(false);
  });

  it("rejects capacity when the central contract reports the limit reached", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () =>
      enabledResult({ capacity: { limit: 5, used: 5 } })
    );

    await expect(assertProfessionalCapacityAvailable(105)).rejects.toBeInstanceOf(
      ProfessionalCapacityExceededError
    );
  });

  it("filters unknown resources returned by a provider", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () => ({
      allowed: true,
      reason: "active_trial",
      entitlements: ["professional_settings", "unknown_feature"],
      capacity: null,
    }));

    const snapshot = await getProfessionalEntitlements(106);

    expect(snapshot.enabledResources).toEqual(["professional_settings"]);
  });

  it("denies an otherwise allowed entitlement after expiration", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () =>
      enabledResult({
        validUntil: new Date(Date.now() - 1_000),
        planName: "Profissional expirado",
        capacity: { limit: 10, used: 3 },
      })
    );

    const snapshot = await getProfessionalEntitlements(107);

    expect(snapshot.allowed).toBe(false);
    expect(snapshot.reason).toBe("no_access");
    expect(snapshot.commercialState).toBe("no_access");
    expect(snapshot.enabledResources).toEqual([]);
    expect(snapshot.planName).toBe("Profissional expirado");
  });

  it("fails safely when finite capacity has no atomic reservation contract", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider({
      getEntitlements: async () =>
        enabledResult({ capacity: { limit: 2, used: 1 } }),
    });

    await expect(
      withProfessionalCapacityReservation(
        {
          professionalUserId: 108,
          patientUserId: 208,
          coverageKey: "authorization:a",
        },
        async () => "should-not-run"
      )
    ).rejects.toBeInstanceOf(ProfessionalCapacityUnavailableError);
  });

  it("allows only one concurrent approval for the final available slot", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    let used = 0;
    _forTestOnly_setProfessionalEntitlementProvider({
      getEntitlements: async () =>
        enabledResult({ capacity: { limit: 1, used } }),
      reserveCapacity: async input => {
        await Promise.resolve();
        if (used >= 1) {
          return { reserved: false, reason: "capacity_exceeded" } as const;
        }
        used += 1;
        return {
          reserved: true,
          reservationId: input.coverageKey,
        } as const;
      },
    });

    const results = await Promise.allSettled([
      withProfessionalCapacityReservation(
        {
          professionalUserId: 109,
          patientUserId: 209,
          coverageKey: "authorization:first",
        },
        async () => "first"
      ),
      withProfessionalCapacityReservation(
        {
          professionalUserId: 109,
          patientUserId: 210,
          coverageKey: "authorization:second",
        },
        async () => "second"
      ),
    ]);

    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(result => result.status === "rejected");
    expect(rejected).toMatchObject({
      status: "rejected",
      reason: expect.any(ProfessionalCapacityExceededError),
    });
    expect(used).toBe(1);
  });

  it("releases a reservation when the clinical transition fails", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    const releaseCapacity = vi.fn().mockResolvedValue(undefined);
    _forTestOnly_setProfessionalEntitlementProvider({
      getEntitlements: async () =>
        enabledResult({ capacity: { limit: 3, used: 1 } }),
      reserveCapacity: async () => ({
        reserved: true,
        reservationId: "reservation-1",
      }),
      releaseCapacity,
    });

    await expect(
      withProfessionalCapacityReservation(
        {
          professionalUserId: 110,
          patientUserId: 211,
          coverageKey: "authorization:failure",
        },
        async () => {
          throw new Error("transition failed");
        }
      )
    ).rejects.toThrow("transition failed");

    expect(releaseCapacity).toHaveBeenCalledWith({
      professionalUserId: 110,
      reservationId: "reservation-1",
      coverageKey: "authorization:failure",
    });
  });
});
