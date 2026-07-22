import { describe, expect, it, vi } from "vitest";
import {
  createLegacyProfessionalEntitlementPolicy,
  legacyProfessionalEntitlementResourceForPath,
} from "./legacyEntitlementPolicy";

const ctx = {
  user: {
    id: 77,
    email: "professional@example.com",
    name: "Profissional",
    role: "user" as const,
  },
} as any;

describe("legacy professional entitlement policy", () => {
  it("maps each professional operation to its specific resource", () => {
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.portfolio"
      )
    ).toBe("professional_portfolio");
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.patientPeriodBundle"
      )
    ).toBe("professional_reports");
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.askPatientQuestion"
      )
    ).toBe("professional_ai_assistance");
  });

  it("does not apply commercial gates to patient-side decisions", () => {
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.approveAccess"
      )
    ).toBeNull();
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.revokeAccess"
      )
    ).toBeNull();
    expect(
      legacyProfessionalEntitlementResourceForPath(
        "nutrition.professionals.respondGoalSuggestion"
      )
    ).toBeNull();
  });

  it("defers inactive-profile errors to the domain service", async () => {
    const assertEntitlement = vi.fn();
    const policy = createLegacyProfessionalEntitlementPolicy({
      getProfile: vi.fn().mockResolvedValue({ active: false }),
      assertEntitlement,
    } as any);

    await expect(
      policy({ path: "nutrition.professionals.portfolio", ctx })
    ).resolves.toBeUndefined();
    expect(assertEntitlement).not.toHaveBeenCalled();
  });

  it("checks the discriminating resource instead of a global boolean", async () => {
    const assertEntitlement = vi.fn().mockResolvedValue(undefined);
    const policy = createLegacyProfessionalEntitlementPolicy({
      getProfile: vi.fn().mockResolvedValue({ active: true }),
      assertEntitlement,
    } as any);

    await policy({
      path: "nutrition.professionals.patientPeriodBundle",
      ctx,
    });

    expect(assertEntitlement).toHaveBeenCalledWith(77, "professional_reports");
  });
});
