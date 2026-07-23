import { beforeEach, describe, expect, it, vi } from "vitest";

const getProfessionalEntitlements = vi.fn();

vi.mock("./entitlementService", () => ({
  getProfessionalEntitlements,
}));

import {
  assertProfessionalResourceAccess,
  ProfessionalEntitlementVerificationUnavailableError,
  ProfessionalResourceDeniedError,
} from "./entitlementAccess";

beforeEach(() => {
  getProfessionalEntitlements.mockReset();
});

describe("assertProfessionalResourceAccess", () => {
  it("accepts the exact enabled resource", async () => {
    const snapshot = {
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_reports"],
    };
    getProfessionalEntitlements.mockResolvedValue(snapshot);

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).resolves.toBe(snapshot);
  });

  it("rejects a missing resource as an access denial", async () => {
    getProfessionalEntitlements.mockResolvedValue({
      allowed: true,
      commercialState: "active",
      enabledResources: ["professional_record"],
    });

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).rejects.toBeInstanceOf(ProfessionalResourceDeniedError);
  });

  it("keeps provider outages separate from commercial denial", async () => {
    getProfessionalEntitlements.mockResolvedValue({
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
    getProfessionalEntitlements.mockResolvedValue({
      allowed: false,
      commercialState: "no_access",
      enabledResources: [],
    });

    await expect(
      assertProfessionalResourceAccess(7, "professional_reports")
    ).rejects.toBeInstanceOf(ProfessionalResourceDeniedError);
  });
});
