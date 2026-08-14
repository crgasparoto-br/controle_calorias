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

function clinicalRepair() {
  return {
    listPendingClinicalCoverageLosses: vi.fn().mockResolvedValue([]),
    repairClinicalCoverageLoss: vi.fn(),
  };
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
      clinicalRepair: clinicalRepair(),
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
      clinicalRepair: clinicalRepair(),
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
      clinicalRepair: clinicalRepair(),
    });

    await expect(
      service.handleCoverageConfirmed({
        patientUserId: 20,
        coverageKey: "professional-authorization:auth-1",
      })
    ).resolves.toEqual({ status: "not_applicable" });
    expect(cancel).not.toHaveBeenCalled();
  });

  it("retries a clinical loss from durable clinical state after the immediate repair fails", async () => {
    const repo = repository();
    const repair = clinicalRepair();
    const loss = {
      professionalUserId: 10,
      patientUserId: 20,
      coverageKey: "professional-authorization:auth-1",
      causeKey: "authorization-revoked:auth-1",
    };
    repair.repairClinicalCoverageLoss
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce({ granted: true });
    repair.listPendingClinicalCoverageLosses.mockResolvedValue([loss]);
    const service = createProfessionalCoverageService({
      repository: repo,
      clinicalRepair: repair,
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    await expect(service.handleClinicalCoverageLoss(loss)).rejects.toThrow(
      "database unavailable"
    );
    await expect(service.processLifecycleFacts()).resolves.toEqual(
      expect.objectContaining({ clinicalScanned: 1, clinicalRepaired: 1 })
    );
    expect(repair.repairClinicalCoverageLoss).toHaveBeenCalledTimes(2);
  });

  it("anchors the initial 90-day capacity window to contract confirmation time", async () => {
    const repo = repository();
    const repair = clinicalRepair();
    const occurredAt = new Date("2026-08-10T09:00:00.000Z");
    repo.listPendingLifecycleFacts.mockResolvedValue([
      {
        id: "fact-1",
        subscriptionId: "professional-1",
        factType: "contract_confirmed",
        occurredAt,
      },
    ]);
    repo.applyLifecycleFact.mockResolvedValue("applied");
    const service = createProfessionalCoverageService({
      repository: repo,
      clinicalRepair: repair,
      now: () => new Date("2026-08-14T12:00:00.000Z"),
    });

    await service.processLifecycleFacts();

    expect(repo.reconcileProfessionalCapacity).toHaveBeenCalledWith(
      "professional-1",
      occurredAt
    );
  });

  it("uses processing time for capacity reconciliation after recovery", async () => {
    const repo = repository();
    const repair = clinicalRepair();
    const processedAt = new Date("2026-08-14T12:00:00.000Z");
    repo.listPendingLifecycleFacts.mockResolvedValue([
      {
        id: "fact-2",
        subscriptionId: "professional-1",
        factType: "subscription_recovered",
        occurredAt: new Date("2026-08-10T09:00:00.000Z"),
      },
    ]);
    repo.applyLifecycleFact.mockResolvedValue("applied");
    const service = createProfessionalCoverageService({
      repository: repo,
      clinicalRepair: repair,
      now: () => processedAt,
    });

    await service.processLifecycleFacts();

    expect(repo.reconcileProfessionalCapacity).toHaveBeenCalledWith(
      "professional-1",
      processedAt
    );
  });
});
