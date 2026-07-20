import { afterEach, describe, expect, it } from "vitest";
import {
  _forTestOnly_setProfessionalEntitlementProvider,
  assertProfessionalCapacityAvailable,
  getProfessionalEntitlements,
  ProfessionalCapacityExceededError,
  PROFESSIONAL_ENTITLEMENT_RESOURCES,
} from "./entitlementService";

const previousMode = process.env.BILLING_ACCESS_MODE;

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
    expect(snapshot.capacity.limit).toBeNull();
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

  it("rejects capacity before a caller starts a patient-creation operation", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () => ({
      allowed: true,
      reason: "active_subscription",
      planCode: "professional-test",
      planName: "Profissional Teste",
      entitlements: [...PROFESSIONAL_ENTITLEMENT_RESOURCES],
      capacity: { limit: 5, used: 5 },
    }));

    await expect(assertProfessionalCapacityAvailable(104)).rejects.toBeInstanceOf(
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

    const snapshot = await getProfessionalEntitlements(105);

    expect(snapshot.enabledResources).toEqual(["professional_settings"]);
  });

  it("denies an otherwise allowed entitlement after expiration", async () => {
    process.env.BILLING_ACCESS_MODE = "enforced";
    _forTestOnly_setProfessionalEntitlementProvider(async () => ({
      allowed: true,
      reason: "active_subscription",
      validUntil: new Date(Date.now() - 1_000),
      planName: "Profissional expirado",
      entitlements: [...PROFESSIONAL_ENTITLEMENT_RESOURCES],
      capacity: { limit: 10, used: 3 },
    }));

    const snapshot = await getProfessionalEntitlements(106);

    expect(snapshot.allowed).toBe(false);
    expect(snapshot.reason).toBe("no_access");
    expect(snapshot.commercialState).toBe("no_access");
    expect(snapshot.enabledResources).toEqual([]);
    expect(snapshot.planName).toBe("Profissional expirado");
  });
});
