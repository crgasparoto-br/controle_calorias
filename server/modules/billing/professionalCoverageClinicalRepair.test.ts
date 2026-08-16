import { describe, expect, it, vi } from "vitest";
import { createProfessionalCoverageClinicalRepair } from "./professionalCoverageClinicalRepair";

describe("professional clinical coverage repair", () => {
  it("keeps the allocation intact when transition persistence fails", async () => {
    const transitionRepository = {
      grantTransitionAfterClinicalLoss: vi
        .fn()
        .mockRejectedValue(new Error("transition persistence unavailable")),
    };
    const capacityRepository = {
      releaseProfessionalCapacity: vi.fn(),
    };
    const repair = createProfessionalCoverageClinicalRepair({
      getDb: async () => null,
      transitionRepository: transitionRepository as any,
      capacityRepository: capacityRepository as any,
    });

    await expect(
      repair.repairClinicalCoverageLoss({
        professionalUserId: 10,
        patientUserId: 20,
        coverageKey: "professional-authorization:auth-1",
        causeKey: "authorization-revoked:auth-1",
      })
    ).rejects.toThrow("transition persistence unavailable");

    expect(capacityRepository.releaseProfessionalCapacity).not.toHaveBeenCalled();
  });

  it("releases only after the transition decision is durably resolved", async () => {
    const order: string[] = [];
    const transitionRepository = {
      grantTransitionAfterClinicalLoss: vi.fn(async () => {
        order.push("transition");
        return { granted: false, reason: "cooldown" };
      }),
    };
    const capacityRepository = {
      releaseProfessionalCapacity: vi.fn(async () => {
        order.push("release");
      }),
    };
    const repair = createProfessionalCoverageClinicalRepair({
      getDb: async () => null,
      transitionRepository: transitionRepository as any,
      capacityRepository: capacityRepository as any,
    });

    await repair.repairClinicalCoverageLoss({
      professionalUserId: 10,
      patientUserId: 20,
      coverageKey: "professional-authorization:auth-1",
      causeKey: "authorization-revoked:auth-1",
    });

    expect(order).toEqual(["transition", "release"]);
  });
});
