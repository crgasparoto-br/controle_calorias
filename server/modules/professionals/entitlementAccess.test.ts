import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProfessionalEntitlements: vi.fn(),
}));

vi.mock("./entitlementService", () => ({
  getProfessionalEntitlements: mocks.getProfessionalEntitlements,
}));

import {
  assertProfessionalResourceAccess,
  isProfessionalEntitlementVerificationUnavailableError,
  isProfessionalResourceDeniedError,
  ProfessionalEntitlementVerificationUnavailableError,
  ProfessionalResourceDeniedError,
} from "./entitlementAccess";

beforeEach(() => {
  mocks.getProfessionalEntitlements.mockReset();
});

describe("assertProfessionalResourceAccess", () => {
  it("accepts the exact enabled resource", async () => {
    const snapshot = {
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_reports"],
    };
    mocks.getProfessionalEntitlements.mockResolvedValue(snapshot);

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).resolves.toBe(snapshot);
  });

  it("rejects a missing resource as an access denial", async () => {
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_record"],
    });

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).rejects.toBeInstanceOf(ProfessionalResourceDeniedError);
  });

  it("keeps provider outages separate from commercial denial", async () => {
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: false,
      commercialState: "unavailable",
      enabledResources: [],
    });

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).rejects.toBeInstanceOf(
      ProfessionalEntitlementVerificationUnavailableError
    );
  });

  it("treats a confirmed no-access snapshot as denial", async () => {
    mocks.getProfessionalEntitlements.mockResolvedValue({
      allowed: false,
      commercialState: "no_access",
      enabledResources: [],
    });

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).rejects.toBeInstanceOf(ProfessionalResourceDeniedError);
  });

  it("recognizes canonical and compatible denial errors", () => {
    expect(
      isProfessionalResourceDeniedError(new ProfessionalResourceDeniedError())
    ).toBe(true);
    const compatible = new Error("legacy denial");
    Object.defineProperty(compatible, "constructor", {
      value: { name: "ProfessionalEntitlementDeniedError" },
    });
    expect(isProfessionalResourceDeniedError(compatible)).toBe(true);
    expect(isProfessionalResourceDeniedError(new Error("temporary"))).toBe(false);
  });

  it("recognizes canonical verification outage errors", () => {
    expect(
      isProfessionalEntitlementVerificationUnavailableError(
        new ProfessionalEntitlementVerificationUnavailableError()
      )
    ).toBe(true);
    expect(
      isProfessionalEntitlementVerificationUnavailableError(
        new ProfessionalResourceDeniedError()
      )
    ).toBe(false);
  });
});
