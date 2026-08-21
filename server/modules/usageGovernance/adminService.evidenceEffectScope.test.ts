import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAbuseCase: vi.fn(),
  listUsageLimitationsForCase: vi.fn(),
  createLimitation: vi.fn(),
}));

vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getAbuseCase: mocks.getAbuseCase,
}));
vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  listUsageLimitationsForCase: mocks.listUsageLimitationsForCase,
}));
vi.mock("../../repositories/usageGovernanceAdminRepository", () => ({
  approveAbuseReview: vi.fn(),
  createAbuseCase: vi.fn(),
  createAllowanceGrant: vi.fn(),
  createConsumptionChargeAuthorization: vi.fn(),
  createLegalHold: vi.fn(),
  createLimitation: mocks.createLimitation,
  revokeAllowanceGrant: vi.fn(),
  revokeConsumptionChargeAuthorization: vi.fn(),
  revokeLegalHold: vi.fn(),
  revokeLimitation: vi.fn(),
  reviewLimitationAppeal: vi.fn(),
  submitLimitationAppeal: vi.fn(),
}));

import { applyUsageLimitation } from "./adminService";

function emergencyCase(overrides: Record<string, unknown> = {}) {
  return {
    id: "case-1",
    subjectUserId: 99,
    reviewOutcome: null,
    systemFailuresExcluded: false,
    legitimateGrowthReviewed: false,
    signalsJson: JSON.stringify(["control_bypass_attempt"]),
    sanitizedEvidenceJson: JSON.stringify({
      blockedControlId: "image-operation-guard",
      securityRiskConfirmed: true,
      affectedOperations: ["image_processing"],
    }),
    impactJson: null,
    ...overrides,
  };
}

function emergencyInput(operations: string[]) {
  return {
    abuseCaseId: "case-1",
    subjectUserId: 99,
    operations,
    reason: "bounded emergency protection",
    startsAt: new Date("2026-08-18T12:00:00.000Z"),
    endsAt: new Date("2026-08-19T12:00:00.000Z"),
    emergencySecurity: true,
    approvedByUserId: 11,
    communicatedAt: new Date("2026-08-18T11:55:00.000Z"),
    appealOfferedAt: new Date("2026-08-18T11:55:00.000Z"),
  };
}

describe("emergency limitation evidence-effect scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAbuseCase.mockResolvedValue(emergencyCase());
    mocks.listUsageLimitationsForCase.mockResolvedValue([]);
    mocks.createLimitation.mockResolvedValue({
      lifecycleKind: "emergency",
      approvedByUserId: 11,
      secondApprovedByUserId: null,
    });
  });

  it("accepts only an operation explicitly sustained by the security evidence", async () => {
    await expect(applyUsageLimitation(emergencyInput(["image_processing"])))
      .resolves.toMatchObject({ state: "active", lifecycleKind: "emergency" });
    expect(mocks.createLimitation).toHaveBeenCalledWith(expect.objectContaining({
      operations: ["image_processing"],
      emergencySecurity: true,
    }));
  });

  it("rejects an unrelated heavy operation before persistence", async () => {
    await expect(applyUsageLimitation(emergencyInput(["audio_processing"])))
      .rejects.toThrow("usage_emergency_security_operation_not_evidenced");
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });

  it("rejects an atomic mixed request when any operation is outside the evidence scope", async () => {
    await expect(applyUsageLimitation(emergencyInput(["image_processing", "audio_processing"])))
      .rejects.toThrow("usage_emergency_security_operation_not_evidenced");
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });

  it("fails closed when confirmed security evidence has no affected-operation scope", async () => {
    mocks.getAbuseCase.mockResolvedValue(emergencyCase({
      sanitizedEvidenceJson: JSON.stringify({
        blockedControlId: "image-operation-guard",
        securityRiskConfirmed: true,
      }),
    }));
    await expect(applyUsageLimitation(emergencyInput(["image_processing"])))
      .rejects.toThrow("usage_emergency_security_scope_required");
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });

  it("preserves the same scope invariant for a sibling credential-abuse signal", async () => {
    mocks.getAbuseCase.mockResolvedValue(emergencyCase({
      signalsJson: JSON.stringify(["credential_abuse"]),
      sanitizedEvidenceJson: JSON.stringify({
        securityRiskConfirmed: true,
        affectedOperations: ["whatsapp_processing"],
      }),
    }));
    await expect(applyUsageLimitation(emergencyInput(["ai_heavy_processing"])))
      .rejects.toThrow("usage_emergency_security_operation_not_evidenced");
    expect(mocks.createLimitation).not.toHaveBeenCalled();
  });
});
