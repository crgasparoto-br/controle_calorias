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
  listUsageLimitationsForCase: vi.fn(),
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getAbuseCase: mocks.getAbuseCase,
}));
vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  listUsageLimitationsForCase: mocks.listUsageLimitationsForCase,
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
  applyUsageLimitation,
  authorizeFutureConsumptionCharging,
  revokeFutureConsumptionCharging,
} from "./adminService";

function reviewedCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    subjectUserId: 99,
    reviewOutcome: "limitation_approved",
    systemFailuresExcluded: true,
    legitimateGrowthReviewed: true,
    signalsJson: JSON.stringify(["automation_heavy"]),
    sanitizedEvidenceJson: JSON.stringify({ requestRate: 120 }),
    impactJson: JSON.stringify({ affectedOperations: ["ai_heavy_processing"] }),
    ...overrides,
  };
}

function limitationInput(overrides: Record<string, unknown> = {}) {
  return {
    abuseCaseId: "case-1",
    subjectUserId: 99,
    operations: ["ai_heavy_processing"],
    reason: "reviewed abuse",
    startsAt: new Date("2026-08-17T00:00:00.000Z"),
    endsAt: new Date("2026-08-24T00:00:00.000Z"),
    emergencySecurity: false,
    approvedByUserId: 11,
    communicatedAt: new Date("2026-08-16T18:00:00.000Z"),
    appealOfferedAt: new Date("2026-08-16T18:00:00.000Z"),
    ...overrides,
  };
}

describe("usage governance charging rollback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-16T12:00:00.000Z"));
    mocks.getAbuseCase.mockResolvedValue(reviewedCase());
    mocks.listUsageLimitationsForCase.mockResolvedValue([]);
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
    expect(mocks.createConsumptionChargeAuthorization).toHaveBeenCalledWith(expect.objectContaining({ rollback, actorUserId: 11 }));
    await expect(revokeFutureConsumptionCharging(authorization.id, 12, " commercial rollback ")).resolves.toMatchObject({ id: authorization.id, state: "revoked" });
    expect(mocks.revokeConsumptionChargeAuthorization).toHaveBeenCalledWith(authorization.id, 12, "commercial rollback");
  });

  it("requires a distinct second administrator for the single seven-day extension", async () => {
    mocks.listUsageLimitationsForCase.mockResolvedValue([{
      id: "initial", abuseCaseId: "case-1", subjectUserId: 99, emergencySecurity: false,
      startsAt: new Date("2026-08-17T00:00:00.000Z"), endsAt: new Date("2026-08-24T00:00:00.000Z"), approvedByUserId: 11, state: "active", revokedAt: null,
    }]);
    await expect(applyUsageLimitation(limitationInput({
      startsAt: new Date("2026-08-24T00:00:00.000Z"),
      endsAt: new Date("2026-08-31T00:00:00.000Z"),
      approvedByUserId: 11,
    }))).rejects.toThrow("usage_limitation_second_admin_required");
    await expect(applyUsageLimitation(limitationInput({
      startsAt: new Date("2026-08-24T00:00:00.000Z"),
      endsAt: new Date("2026-08-31T00:00:00.000Z"),
      approvedByUserId: 22,
    }))).resolves.toMatchObject({ state: "active" });
    expect(mocks.createLimitation).toHaveBeenCalledWith(expect.objectContaining({
      approvedByUserId: 22,
    }));
  });

  it("rejects a third normal limitation for the same abuse case", async () => {
    mocks.listUsageLimitationsForCase.mockResolvedValue([
      { id: "initial", emergencySecurity: false, startsAt: new Date("2026-08-17"), endsAt: new Date("2026-08-24"), approvedByUserId: 11, state: "active", revokedAt: null },
      { id: "extension", emergencySecurity: false, startsAt: new Date("2026-08-24"), endsAt: new Date("2026-08-31"), approvedByUserId: 11, secondApprovedByUserId: 22, state: "active", revokedAt: null },
    ]);
    await expect(applyUsageLimitation(limitationInput({
      startsAt: new Date("2026-08-31T00:00:00.000Z"),
      endsAt: new Date("2026-09-07T00:00:00.000Z"),
      approvedByUserId: 33,
    }))).rejects.toThrow("usage_limitation_extension_limit_reached");
  });

  it("does not allow a normal extension to overlap the initial limitation", async () => {
    mocks.listUsageLimitationsForCase.mockResolvedValue([{
      id: "initial", emergencySecurity: false, startsAt: new Date("2026-08-17"), endsAt: new Date("2026-08-24"), approvedByUserId: 11, state: "active", revokedAt: null,
    }]);
    await expect(applyUsageLimitation(limitationInput({
      startsAt: new Date("2026-08-23T00:00:00.000Z"),
      endsAt: new Date("2026-08-30T00:00:00.000Z"),
      approvedByUserId: 22,
    }))).rejects.toThrow("usage_limitation_extension_must_follow_initial");
  });

  it("rejects an extension after the initial limitation was revoked", async () => {
    mocks.listUsageLimitationsForCase.mockResolvedValue([{
      id: "initial", abuseCaseId: "case-1", subjectUserId: 99, emergencySecurity: false,
      startsAt: new Date("2026-08-17T00:00:00.000Z"), endsAt: new Date("2026-08-24T00:00:00.000Z"),
      approvedByUserId: 11, state: "revoked", revokedAt: new Date("2026-08-20T00:00:00.000Z"),
    }]);
    await expect(applyUsageLimitation(limitationInput({
      startsAt: new Date("2026-08-24T00:00:00.000Z"),
      endsAt: new Date("2026-08-31T00:00:00.000Z"),
      approvedByUserId: 22,
    }))).rejects.toThrow("usage_limitation_extension_initial_not_active");
  });

  it("requires a concrete security signal and sanitized evidence for emergency protection", async () => {
    mocks.getAbuseCase.mockResolvedValue(reviewedCase({
      reviewOutcome: null,
      systemFailuresExcluded: false,
      legitimateGrowthReviewed: false,
      signalsJson: JSON.stringify(["high_cost"]),
      sanitizedEvidenceJson: JSON.stringify({ costRatio: 4.2 }),
    }));
    await expect(applyUsageLimitation(limitationInput({
      emergencySecurity: true,
      startsAt: new Date("2026-08-16T13:00:00.000Z"),
      endsAt: new Date("2026-08-17T13:00:00.000Z"),
    }))).rejects.toThrow("usage_emergency_security_evidence_required");

    mocks.getAbuseCase.mockResolvedValue(reviewedCase({
      reviewOutcome: null,
      systemFailuresExcluded: false,
      legitimateGrowthReviewed: false,
      signalsJson: JSON.stringify(["control_bypass_attempt"]),
      sanitizedEvidenceJson: JSON.stringify({
        blockedControlId: "heavy-operation-guard",
        securityRiskConfirmed: true,
        affectedOperations: ["ai_heavy_processing"],
      }),
    }));
    await expect(applyUsageLimitation(limitationInput({
      emergencySecurity: true,
      startsAt: new Date("2026-08-16T13:00:00.000Z"),
      endsAt: new Date("2026-08-17T13:00:00.000Z"),
    }))).resolves.toMatchObject({ state: "active" });
  });

  it.each([
    ["communication", { communicatedAt: null }],
    ["appeal offer", { appealOfferedAt: null }],
  ])("requires %s before an emergency limitation can activate", async (_label, missing) => {
    mocks.getAbuseCase.mockResolvedValue(reviewedCase({
      reviewOutcome: null,
      systemFailuresExcluded: false,
      legitimateGrowthReviewed: false,
      signalsJson: JSON.stringify(["control_bypass_attempt"]),
      sanitizedEvidenceJson: JSON.stringify({
        blockedControlId: "heavy-operation-guard",
        securityRiskConfirmed: true,
        affectedOperations: ["ai_heavy_processing"],
      }),
    }));
    await expect(applyUsageLimitation(limitationInput({
      emergencySecurity: true,
      startsAt: new Date("2026-08-16T13:00:00.000Z"),
      endsAt: new Date("2026-08-17T13:00:00.000Z"),
      ...missing,
    }))).rejects.toThrow("usage_limitation_communication_required");
    expect(mocks.getAbuseCase).not.toHaveBeenCalled();
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });

  it("does not chain multiple emergency windows for the same case", async () => {
    mocks.getAbuseCase.mockResolvedValue(reviewedCase({
      signalsJson: JSON.stringify(["security_risk"]),
      sanitizedEvidenceJson: JSON.stringify({ anomalyScore: 99, securityRiskConfirmed: true }),
    }));
    mocks.listUsageLimitationsForCase.mockResolvedValue([{ id: "emergency-1", emergencySecurity: true }]);
    await expect(applyUsageLimitation(limitationInput({
      emergencySecurity: true,
      startsAt: new Date("2026-08-16T13:00:00.000Z"),
      endsAt: new Date("2026-08-17T13:00:00.000Z"),
    }))).rejects.toThrow("usage_emergency_limit_already_applied");
  });
});
