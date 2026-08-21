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
  openUsageAbuseCase,
  reviewUsageAbuseCase,
} from "./adminService";

function reviewedCase(affectedOperations: string[] = ["audio_processing", "ai_heavy_processing"]) {
  return {
    id: "case-1",
    subjectUserId: 99,
    reviewOutcome: "limitation_approved",
    systemFailuresExcluded: true,
    legitimateGrowthReviewed: true,
    signalsJson: JSON.stringify(["volume_anomaly", "repetitive_heavy_automation"]),
    sanitizedEvidenceJson: JSON.stringify({ requestRate: 120 }),
    impactJson: JSON.stringify({ affectedOperations }),
  };
}

function limitationInput(operations: string[]) {
  return {
    abuseCaseId: "case-1",
    subjectUserId: 99,
    operations,
    reason: "reviewed abuse",
    startsAt: new Date("2026-08-18T00:00:00.000Z"),
    endsAt: new Date("2026-08-25T00:00:00.000Z"),
    emergencySecurity: false,
    approvedByUserId: 11,
    communicatedAt: new Date("2026-08-17T18:00:00.000Z"),
    appealOfferedAt: new Date("2026-08-17T18:00:00.000Z"),
  };
}

describe("audit remediation: abuse-signal policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects high cost as the only abuse signal", async () => {
    await expect(openUsageAbuseCase({
      subjectUserId: 99,
      signals: ["high_cost"],
      evidence: { variableCostRatioBps: 4200 },
      actorUserId: 11,
    })).rejects.toThrow("usage_abuse_high_cost_not_sufficient");
    expect(mocks.createAbuseCase).not.toHaveBeenCalled();
  });

  it("rejects an unrecognized signal even when paired with a valid one", async () => {
    await expect(openUsageAbuseCase({
      subjectUserId: 99,
      signals: ["volume_anomaly", "made_up_signal"],
      evidence: { requestRate: 120 },
      actorUserId: 11,
    })).rejects.toThrow("usage_abuse_signal_invalid");
    expect(mocks.createAbuseCase).not.toHaveBeenCalled();
  });

  it("persists a distinct behavioral combination and may include high cost only as supporting context", async () => {
    await expect(openUsageAbuseCase({
      subjectUserId: 99,
      signals: ["high_cost", "volume_anomaly", "volume_anomaly"],
      evidence: { variableCostRatioBps: 4200, requestRate: 120 },
      actorUserId: 11,
    })).resolves.toMatchObject({ state: "open" });
    expect(mocks.createAbuseCase).toHaveBeenCalledWith(expect.objectContaining({
      signals: ["high_cost", "volume_anomaly"],
    }));
  });

  it("allows one proven security signal because the evidence itself is the second independent control", async () => {
    await expect(openUsageAbuseCase({
      subjectUserId: 99,
      signals: ["control_bypass_attempt"],
      evidence: { securityRiskConfirmed: true },
      actorUserId: 11,
    })).resolves.toMatchObject({ state: "open" });
  });
});

describe("audit remediation: review scope binds the limitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAbuseCase.mockResolvedValue(reviewedCase());
    mocks.listUsageLimitationsForCase.mockResolvedValue([]);
  });

  it("rejects a limitation-approved review without affected operations", async () => {
    await expect(reviewUsageAbuseCase({
      id: "case-1",
      reviewerUserId: 11,
      outcome: "limitation_approved",
      reason: "reviewed",
      systemFailuresExcluded: true,
      legitimateGrowthReviewed: true,
      impact: { affectedOperations: [] },
    })).rejects.toThrow("usage_abuse_review_operations_required");
    expect(mocks.approveAbuseReview).not.toHaveBeenCalled();
  });

  it("rejects a reviewed scope that contains a non-heavy operation", async () => {
    await expect(reviewUsageAbuseCase({
      id: "case-1",
      reviewerUserId: 11,
      outcome: "limitation_approved",
      reason: "reviewed",
      systemFailuresExcluded: true,
      legitimateGrowthReviewed: true,
      impact: { affectedOperations: ["manual_food_entry"] },
    })).rejects.toThrow("usage_abuse_review_operations_invalid");
  });

  it("rejects a limitation operation that the human review did not approve", async () => {
    await expect(applyUsageLimitation(limitationInput(["whatsapp_processing"])))
      .rejects.toThrow("usage_limitation_operation_not_reviewed");
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });

  it("allows only a subset of the operations persisted in the human review", async () => {
    await expect(applyUsageLimitation(limitationInput(["audio_processing"])))
      .resolves.toMatchObject({ state: "active" });
    expect(mocks.createLimitation).toHaveBeenCalledWith(expect.objectContaining({
      operations: ["audio_processing"],
    }));
  });

  it("fails closed when a legacy reviewed case has no persisted operation scope", async () => {
    mocks.getAbuseCase.mockResolvedValue(reviewedCase([]));
    await expect(applyUsageLimitation(limitationInput(["audio_processing"])))
      .rejects.toThrow("usage_limitation_review_scope_missing");
  });
});
