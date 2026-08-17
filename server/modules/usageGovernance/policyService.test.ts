import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getActiveUsagePolicy: vi.fn(),
  replaceUsagePolicy: vi.fn(),
}));

vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  getActiveUsagePolicy: mocks.getActiveUsagePolicy,
  replaceUsagePolicy: mocks.replaceUsagePolicy,
}));
vi.mock("./service", () => ({
  USAGE_RULE_VERSION: "test-rule",
  FAIR_USE_POLICY: {
    observationDays: 90,
    alertThresholdPercentages: [70, 85, 100],
    automaticBlockingAtBudgetThreshold: false,
    initialLimitationDays: 7,
    extensionDays: 7,
    emergencySecurityHours: 24,
  },
}));

import { configureUsagePolicy, resolveFairUsePolicy } from "./policyService";

describe("usage policy configuration", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns persisted thresholds instead of the defaults", async () => {
    mocks.getActiveUsagePolicy.mockResolvedValue({
      id: "policy-1",
      scopeType: "global",
      scopeId: "default",
      currency: "BRL",
      expectedBudgetMicros: 1_000_000,
      alertThresholdPercentages: [65, 80, 95],
      observationStartsAt: new Date("2026-08-01T00:00:00.000Z"),
      observationEndsAt: new Date("2026-11-01T00:00:00.000Z"),
      ruleVersion: "test-rule",
      reason: "pilot",
    });
    const policy = await resolveFairUsePolicy({});
    expect(policy.alertThresholdPercentages).toEqual([65, 80, 95]);
    expect(policy.automaticBlockingAtBudgetThreshold).toBe(false);
  });

  it("persists a versioned replacement with three strictly increasing thresholds", async () => {
    mocks.replaceUsagePolicy.mockResolvedValue({ id: "policy-2" });
    const result = await configureUsagePolicy({
      scopeType: "global",
      scopeId: "default",
      currency: "brl",
      expectedBudgetMicros: 2_000_000,
      alertThresholdPercentages: [70, 85, 100],
      observationStartsAt: new Date("2026-08-01T00:00:00.000Z"),
      observationEndsAt: new Date("2026-11-01T00:00:00.000Z"),
      reason: "initial observation",
      actorUserId: 1,
    });
    expect(mocks.replaceUsagePolicy).toHaveBeenCalledWith(expect.objectContaining({
      currency: "BRL",
      ruleVersion: "test-rule",
      alertThresholdPercentages: [70, 85, 100],
    }));
    expect(result.automaticBlockingAtBudgetThreshold).toBe(false);
  });
});
