import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  approveAbuseReview: vi.fn(),
  createAbuseCase: vi.fn(),
  createAllowanceGrant: vi.fn(),
  createConsumptionChargeAuthorization: vi.fn(),
  createLegalHold: vi.fn(),
  createLimitation: vi.fn(),
  revokeAllowanceGrant: vi.fn(),
  revokeConsumptionChargeAuthorization: vi.fn(),
  revokeLegalHold: vi.fn(),
  revokeLimitation: vi.fn(),
  getAbuseCase: vi.fn(),
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getAbuseCase: mocks.getAbuseCase,
}));
vi.mock("../../repositories/usageGovernanceAdminRepository", () => ({
  approveAbuseReview: mocks.approveAbuseReview,
  createAbuseCase: mocks.createAbuseCase,
  createAllowanceGrant: mocks.createAllowanceGrant,
  createConsumptionChargeAuthorization: mocks.createConsumptionChargeAuthorization,
  createLegalHold: mocks.createLegalHold,
  createLimitation: mocks.createLimitation,
  revokeAllowanceGrant: mocks.revokeAllowanceGrant,
  revokeConsumptionChargeAuthorization: mocks.revokeConsumptionChargeAuthorization,
  revokeLegalHold: mocks.revokeLegalHold,
  revokeLimitation: mocks.revokeLimitation,
}));

import {
  authorizeFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
} from "./adminService";

describe("usage governance charging rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
  });

  it("rejects a future charging authorization without an explicit rollback plan", async () => {
    await expect(authorizeFutureConsumptionCharging({
      policyVersion: "pricing-v2",
      reason: "future commercial policy",
      pricing: { aiOperationMinor: 10 },
      affectedPlans: ["professional_v1"],
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      communicationAt: new Date("2026-08-20T00:00:00.000Z"),
      rollback: {},
      actorUserId: 11,
    })).rejects.toThrow("consumption_charge_rollback_required");
    expect(mocks.createConsumptionChargeAuthorization).not.toHaveBeenCalled();
  });

  it("persists the rollback plan and the later deactivation reason", async () => {
    const rollback = { strategy: "disable_policy", restoreCatalogVersion: "pricing-v1" };
    const authorization = await authorizeFutureConsumptionCharging({
      policyVersion: "pricing-v2",
      reason: "future commercial policy",
      pricing: { aiOperationMinor: 10 },
      affectedPlans: ["professional_v1"],
      effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
      communicationAt: new Date("2026-08-20T00:00:00.000Z"),
      rollback,
      actorUserId: 11,
    });

    expect(authorization).toMatchObject({ state: "approved", noRetroactive: true });
    expect(mocks.createConsumptionChargeAuthorization).toHaveBeenCalledWith(expect.objectContaining({
      rollback,
      actorUserId: 11,
    }));

    await expect(revokeFutureConsumptionCharging(authorization.id, 12, " commercial rollback ")).resolves.toMatchObject({
      id: authorization.id,
      state: "revoked",
    });
    expect(mocks.revokeConsumptionChargeAuthorization).toHaveBeenCalledWith(
      authorization.id,
      12,
      "commercial rollback",
    );
  });
});
