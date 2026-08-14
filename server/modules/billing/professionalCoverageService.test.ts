import { describe, expect, it, vi } from "vitest";
import { createProfessionalCoverageService } from "./professionalCoverageService";

function repository() {
  return {
    recordIndividualRenewalSync: vi.fn(),
    grantTransitionAfterClinicalLoss: vi.fn(),
    listPendingLifecycleFacts: vi.fn().mockResolvedValue([]),
    listProfessionalCapacityReconciliationIds: vi.fn().mockResolvedValue([]),
    applyLifecycleFact: vi.fn(),
    reconcileProfessionalCapacity: vi.fn(),
    grantCapacityExtension: vi.fn(),
  } as any;
}

describe("professional coverage service", () => {
  it("performs at most one explicit cancellation attempt and persists confirmation", async () => {
    const repo = repository();
    repo.recordIndividualRenewalSync
      .mockResolvedValueOnce({
        subscriptionId: "individual-1",
        payerUserId: 20,
        provider: "asaas",
      })
      .mockResolvedValueOnce({
        subscriptionId: "individual-1",
        payerUserId: 20,
        provider: "asaas",
      });
    const cancel = vi.fn().mockResolvedValue({ status: "confirmed" });
    const service = createProfessionalCoverageService({
      repository: repo,
      cancelIndividualRenewal: cancel,
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    await expect(
      service.handleCoverageConfirmed({
        patientUserId: 20,
        coverageKey: "professional-authorization:auth-1",
      })
    ).resolves.toEqual({ status: "confirmed" });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(repo.recordIndividualRenewalSync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "confirmed" })
    );
  });

  it("keeps cancellation synchronization pending when the remote operation fails", async () => {
    const repo = repository();
    repo.recordIndividualRenewalSync
      .mockResolvedValueOnce({
        subscriptionId: "individual-1",
        payerUserId: 20,
        provider: "asaas",
      })
      .mockResolvedValueOnce({
        subscriptionId: "individual-1",
        payerUserId: 20,
        provider: "asaas",
      });
    const cancel = vi.fn().mockRejectedValue(new Error("network"));
    const service = createProfessionalCoverageService({
      repository: repo,
      cancelIndividualRenewal: cancel,
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    await expect(
      service.handleCoverageConfirmed({
        patientUserId: 20,
        coverageKey: "professional-authorization:auth-1",
      })
    ).resolves.toEqual({ status: "pending" });

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(repo.recordIndividualRenewalSync).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ status: "pending" })
    );
  });

  it("does not call a provider when the patient has no individual commercial origin", async () => {
    const repo = repository();
    repo.recordIndividualRenewalSync.mockResolvedValue(null);
    const cancel = vi.fn();
    const service = createProfessionalCoverageService({
      repository: repo,
      cancelIndividualRenewal: cancel,
    });

    await expect(
      service.handleCoverageConfirmed({
        patientUserId: 20,
        coverageKey: "professional-authorization:auth-1",
      })
    ).resolves.toEqual({ status: "not_applicable" });
    expect(cancel).not.toHaveBeenCalled();
  });
});
