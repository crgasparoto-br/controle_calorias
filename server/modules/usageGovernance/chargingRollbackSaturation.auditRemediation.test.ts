import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createConsumptionChargeAuthorizationDraft: vi.fn(),
  transitionConsumptionChargeAuthorization: vi.fn(async (input: { id: string; toState: string }) => ({ id: input.id, state: input.toState })),
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getAbuseCase: vi.fn(),
}));
vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  listUsageLimitationsForCase: vi.fn(async () => []),
}));
vi.mock("../../repositories/usageGovernanceAdminRepository", () => ({
  approveAbuseReview: vi.fn(),
  createAbuseCase: vi.fn(),
  createAllowanceGrant: vi.fn(),
  createLegalHold: vi.fn(),
  createLimitation: vi.fn(),
  revokeAllowanceGrant: vi.fn(),
  revokeLegalHold: vi.fn(),
  revokeLimitation: vi.fn(),
  reviewLimitationAppeal: vi.fn(),
  submitLimitationAppeal: vi.fn(),
}));

vi.mock("../../repositories/consumptionChargeAuthorizationRepository", () => ({
  createConsumptionChargeAuthorizationDraft: mocks.createConsumptionChargeAuthorizationDraft,
  transitionConsumptionChargeAuthorization: mocks.transitionConsumptionChargeAuthorization,
  listConsumptionChargeAuthorizations: vi.fn(async () => []),
}));

import {
  authorizeFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
} from "./adminService";

const validAuthorization = {
  policyVersion: "pricing-v2",
  reason: "future commercial policy",
  pricing: { aiOperationMinor: 10 },
  affectedPlans: ["professional-v2"],
  effectiveFrom: new Date("2026-09-01T00:00:00.000Z"),
  communicationAt: new Date("2026-08-20T00:00:00.000Z"),
  rollback: { strategy: "disable-policy", restoreCatalogVersion: "pricing-v1" },
  actorUserId: 11,
};

describe("future consumption charging rollback saturation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-19T10:00:00.000Z"));
  });

  it("rejects authorization without an explicit rollback plan before persistence", async () => {
    await expect(authorizeFutureConsumptionCharging({
      ...validAuthorization,
      rollback: {},
    })).rejects.toThrow("consumption_charge_rollback_required");
    expect(mocks.createConsumptionChargeAuthorizationDraft).not.toHaveBeenCalled();
  });

  it("persists the rollback contract and records a trimmed deactivation reason", async () => {
    const result = await authorizeFutureConsumptionCharging(validAuthorization);

    expect(result).toMatchObject({ state: "draft", noRetroactive: true });
    expect(mocks.createConsumptionChargeAuthorizationDraft).toHaveBeenCalledWith(
      expect.objectContaining({ rollback: validAuthorization.rollback, actorUserId: 11 }),
    );

    await expect(revokeFutureConsumptionCharging(result.id, 12, " rollback after review "))
      .resolves.toEqual({ id: result.id, state: "revoked" });
    expect(mocks.transitionConsumptionChargeAuthorization)
      .toHaveBeenCalledWith(expect.objectContaining({ id: result.id, actorUserId: 12, reason: "rollback after review", toState: "revoked" }));
  });

  it("rejects deactivation without a reason and performs no revoke write", async () => {
    await expect(revokeFutureConsumptionCharging("auth-1", 12, "   "))
      .rejects.toThrow("consumption_charge_revoke_reason_required");
    expect(mocks.transitionConsumptionChargeAuthorization).not.toHaveBeenCalled();
  });
});
