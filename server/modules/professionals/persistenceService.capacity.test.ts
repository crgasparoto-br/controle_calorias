import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  logPersistenceWarning: vi.fn(),
  getAuthorizationById: vi.fn(),
  transitionAuthorization: vi.fn(),
  withCapacityReservation: vi.fn(),
}));

vi.mock("../../db", () => ({
  getDb: mocks.getDb,
  logPersistenceWarning: mocks.logPersistenceWarning,
}));
vi.mock("../../repositories/professionalRepository", () => ({
  createDrizzleProfessionalRepository: () => ({
    getProfile: vi.fn(),
    upsertProfile: vi.fn(),
    listAuthorizationsByProfessional: vi.fn(),
    listAuthorizationsByPatient: vi.fn(),
    getAuthorizationById: mocks.getAuthorizationById,
    getApprovedAuthorization: vi.fn(),
    upsertAuthorization: vi.fn(),
    transitionAuthorization: mocks.transitionAuthorization,
    getTrackingByAuthorization: vi.fn(),
    transitionTracking: vi.fn(),
    migrateLegacyUser: vi.fn(),
    migrateAllLegacyData: vi.fn(),
  }),
}));
vi.mock("./entitlementService", () => ({
  withProfessionalCapacityReservation: mocks.withCapacityReservation,
}));

import { professionalRepository } from "./persistenceService";

const pendingAuthorization = {
  id: "authorization-1",
  professionalUserId: 10,
  patientUserId: 20,
  status: "pending",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getAuthorizationById.mockResolvedValue(pendingAuthorization);
  mocks.transitionAuthorization.mockResolvedValue({
    ...pendingAuthorization,
    status: "approved",
  });
  mocks.withCapacityReservation.mockImplementation(
    async (_input: unknown, operation: () => Promise<unknown>) => operation()
  );
});

describe("professional authorization capacity boundary", () => {
  it("wraps approval in an idempotent central capacity reservation", async () => {
    const result = await professionalRepository.transitionAuthorization({
      authorizationId: "authorization-1",
      patientUserId: 20,
      nextStatus: "approved",
      responseOrigin: "web",
    } as any);

    expect(mocks.withCapacityReservation).toHaveBeenCalledWith(
      {
        professionalUserId: 10,
        patientUserId: 20,
        coverageKey: "professional-authorization:authorization-1",
      },
      expect.any(Function)
    );
    expect(mocks.transitionAuthorization).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "approved" });
  });

  it("does not start the clinical transition when the central reservation fails", async () => {
    mocks.withCapacityReservation.mockRejectedValueOnce(
      new Error("capacity exceeded")
    );

    await expect(
      professionalRepository.transitionAuthorization({
        authorizationId: "authorization-1",
        patientUserId: 20,
        nextStatus: "approved",
        responseOrigin: "web",
      } as any)
    ).rejects.toThrow("capacity exceeded");

    expect(mocks.transitionAuthorization).not.toHaveBeenCalled();
  });

  it("does not involve capacity when rejecting or revoking a link", async () => {
    await professionalRepository.transitionAuthorization({
      authorizationId: "authorization-1",
      patientUserId: 20,
      nextStatus: "rejected",
      responseOrigin: "web",
    } as any);

    expect(mocks.withCapacityReservation).not.toHaveBeenCalled();
    expect(mocks.transitionAuthorization).toHaveBeenCalledTimes(1);
  });
});
