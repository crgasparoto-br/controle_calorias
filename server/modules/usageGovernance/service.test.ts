import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getActiveUsageLimitation: vi.fn(),
  recordUsageEvent: vi.fn(),
  recordEconomicFact: vi.fn(),
  listEconomicFacts: vi.fn(),
  listMonthlyEconomicAggregates: vi.fn(),
  listUsageEvents: vi.fn(),
  purgeUsageGovernanceRetention: vi.fn(),
  refreshUsageDailyAggregates: vi.fn(),
  upsertMonthlyEconomicAggregate: vi.fn(),
}));

vi.mock("../billing/service", () => ({ billingService: { getUserSubscriptionStatus: mocks.getUserSubscriptionStatus } }));
vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getActiveUsageLimitation: mocks.getActiveUsageLimitation,
  recordUsageEvent: mocks.recordUsageEvent,
  recordEconomicFact: mocks.recordEconomicFact,
  listEconomicFacts: mocks.listEconomicFacts,
  listMonthlyEconomicAggregates: mocks.listMonthlyEconomicAggregates,
  listUsageEvents: mocks.listUsageEvents,
  purgeUsageGovernanceRetention: mocks.purgeUsageGovernanceRetention,
  refreshUsageDailyAggregates: mocks.refreshUsageDailyAggregates,
  upsertMonthlyEconomicAggregate: mocks.upsertMonthlyEconomicAggregate,
}));

import {
  AiUsageTemporarilyLimitedError,
  FAIR_USE_POLICY,
  USAGE_RETENTION_POLICY,
  calculateNetEconomicRevenueMinor,
  calculateVariableCostRatioBps,
  economicHealthBand,
  enforceUsageAllowance,
  prorateMinorUnits,
  runUsageRetention,
} from "./service";

function status(reason = "active_subscription", sponsorUserId?: number) {
  return {
    access: { allowed: true, reason, ...(sponsorUserId ? { sponsorUserId } : {}), planCode: reason === "sponsored_by_professional" ? "professional_v1" : "individual_v1", entitlements: ["system_access"], sourceAvailable: true, evaluatedAt: new Date() },
    subscription: { id: "sub-own", planCode: "individual_v1", billingCycle: "monthly", currency: "BRL" },
    professionalSubscription: sponsorUserId ? { id: "sub-pro", planCode: "professional_v1", billingCycle: "monthly", currency: "BRL" } : null,
  };
}

describe("usage governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveUsageLimitation.mockResolvedValue([]);
    mocks.getUserSubscriptionStatus.mockResolvedValue(status());
    mocks.purgeUsageGovernanceRetention.mockResolvedValue(undefined);
  });

  it("attributes sponsored patient use to the professional payer without losing beneficiary", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(status("sponsored_by_professional", 7));
    const result = await enforceUsageAllowance({ userId: 99, capability: "QUESTION", origin: "whatsapp", flow: "whatsapp_question", conversationId: "wamid.private" });
    expect(result.correlation).toMatchObject({ beneficiaryUserId: 99, payerUserId: 7, sponsorUserId: 7, subscriptionId: "sub-pro", accessSource: "sponsored_by_professional" });
    expect(JSON.stringify(result.correlation)).not.toContain("wamid.private");
  });

  it("does not block at a budget threshold; only an approved active limitation blocks heavy processing", async () => {
    expect(FAIR_USE_POLICY.automaticBlockingAtBudgetThreshold).toBe(false);
    await expect(enforceUsageAllowance({ userId: 2, capability: "QUESTION", origin: "web", flow: "question_answer" })).resolves.toBeTruthy();
    mocks.getActiveUsageLimitation.mockResolvedValue([{ id: "lim", abuseCaseId: "case", subjectUserId: 2, operations: ["ai_heavy_processing"], reason: "reviewed", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000), emergencySecurity: false, approvedByUserId: 1, secondApprovedByUserId: null }]);
    await expect(enforceUsageAllowance({ userId: 2, capability: "QUESTION", origin: "web", flow: "question_answer" })).rejects.toBeInstanceOf(AiUsageTemporarilyLimitedError);
  });

  it("prorates contractual revenue across service competence", () => {
    const annual = 120_000;
    const start = new Date("2026-01-01T00:00:00.000Z");
    const end = new Date("2027-01-01T00:00:00.000Z");
    const january = prorateMinorUnits(annual, start, end, start, new Date("2026-02-01T00:00:00.000Z"));
    expect(january).toBeGreaterThan(9_000);
    expect(january).toBeLessThan(11_000);
  });

  it("computes net economic revenue without financial anticipation in the denominator", () => {
    const net = calculateNetEconomicRevenueMinor({ recognizedContractRevenueMinor: 10000, discountMinor: 500, couponMinor: 500, creditMinor: 100, refundMinor: 200, chargebackMinor: 300, taxMinor: 600, receiptFeeMinor: 100 });
    expect(net).toBe(7700);
    expect(calculateVariableCostRatioBps(15_400_000, net)).toBe(2000);
    expect(economicHealthBand(2000)).toBe("healthy");
    expect(economicHealthBand(2300)).toBe("attention");
    expect(economicHealthBand(2800)).toBe("review");
    expect(economicHealthBand(3100)).toBe("mandatory_review_candidate");
  });

  it("retains detail 13 months, daily aggregates 24 months and monthly economics/audit five years", async () => {
    const now = new Date("2026-08-16T12:00:00.000Z");
    await runUsageRetention(now);
    const input = mocks.purgeUsageGovernanceRetention.mock.calls[0][0];
    expect(input.detailedCutoff.toISOString().slice(0, 7)).toBe("2025-07");
    expect(input.dailyCutoff.toISOString().slice(0, 7)).toBe("2024-08");
    expect(input.monthlyCutoff.toISOString().slice(0, 7)).toBe("2021-08");
    expect(USAGE_RETENTION_POLICY).toMatchObject({ detailedUsageMonths: 13, dailyAggregateMonths: 24, monthlyEconomicYears: 5, governanceAuditYears: 5, rawConversationalContentStored: false, legalHoldSupported: true });
  });
});
