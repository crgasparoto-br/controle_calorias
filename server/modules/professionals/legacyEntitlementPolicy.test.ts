import { describe, expect, it, vi } from "vitest";
import {
  createLegacyProfessionalEntitlementPolicy,
  legacyProfessionalEntitlementResourceForPath,
  legacyProfessionalEntitlementResourcesForPath,
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

  it("allows the timezone helper through every authorized individual route", () => {
    expect(
      legacyProfessionalEntitlementResourcesForPath(
        "nutrition.professionals.patientTimeZone"
      )
    ).toEqual([
      "professional_portfolio",
      "professional_record",
      "professional_reports",
      "professional_messages",
    ]);
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

  it("accepts a reports-only professional when resolving patient timezone", async () => {
    const assertEntitlement = vi.fn(
      async (_userId: number, resource: string) => {
        if (resource !== "professional_reports") {
          throw new Error(`missing:${resource}`);
        }
      }
    );
    const policy = createLegacyProfessionalEntitlementPolicy({
      getProfile: vi.fn().mockResolvedValue({ active: true }),
      assertEntitlement,
    } as any);

    await expect(
      policy({ path: "nutrition.professionals.patientTimeZone", ctx })
    ).resolves.toBeUndefined();
    expect(assertEntitlement.mock.calls.map(call => call[1])).toEqual([
      "professional_portfolio",
      "professional_record",
      "professional_reports",
    ]);
  });

  it("fails closed when none of the allowed timezone resources is present", async () => {
    const assertEntitlement = vi
      .fn()
      .mockRejectedValue(new Error("Sem entitlement individual"));
    const policy = createLegacyProfessionalEntitlementPolicy({
      getProfile: vi.fn().mockResolvedValue({ active: true }),
      assertEntitlement,
    } as any);

    await expect(
      policy({ path: "nutrition.professionals.patientTimeZone", ctx })
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "Sem entitlement individual",
    });
    expect(assertEntitlement).toHaveBeenCalledTimes(4);
  });
});
