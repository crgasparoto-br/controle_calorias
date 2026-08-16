import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiInferenceEvent } from "../../_core/ai/observability";

const mocks = vi.hoisted(() => ({
  getUserSubscriptionStatus: vi.fn(),
  getActiveUsageLimitation: vi.fn(),
  hasActiveUsageExemption: vi.fn(),
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
  refreshUsageDailyAggregates: mocks.refreshUsageDailyAggregates,
  upsertMonthlyEconomicAggregate: mocks.upsertMonthlyEconomicAggregate,
}));
vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({
  hasActiveUsageExemption: mocks.hasActiveUsageExemption,
}));
vi.mock("../../repositories/usageGovernanceRetentionRepository", () => ({
  purgeUsageGovernanceRetention: mocks.purgeUsageGovernanceRetention,
}));

import {
  AiUsageTemporarilyLimitedError,
  FAIR_USE_POLICY,
  USAGE_RETENTION_POLICY,
  calculateNetEconomicRevenueMinor,
  calculateVariableCostRatioBps,
  economicHealthBand,
  enforceUsageAllowance,
  getInternalUsageAnalytics,
  prorateMinorUnits,
  recordAiEconomicUsage,
  refreshEconomicAggregates,
  runUsageRetention,
} from "./service";

function status(reason = "active_subscription", sponsorUserId?: number) {
  return {
    access: { allowed: true, reason, ...(sponsorUserId ? { sponsorUserId } : {}), planCode: reason === "sponsored_by_professional" ? "professional_v1" : "individual_v1", entitlements: ["system_access"], sourceAvailable: true, evaluatedAt: new Date() },
    subscription: { id: "sub-own", planCode: "individual_v1", billingCycle: "monthly", currency: "BRL" },
    professionalSubscription: sponsorUserId ? { id: "sub-pro", planCode: "professional_v1", billingCycle: "monthly", currency: "BRL" } : null,
  };
}

function inferenceEvent(executionId: string, correlation: Record<string, string | number | boolean | null>): AiInferenceEvent {
  return {
    schemaVersion: 1,
    occurredAt: "2026-08-16T12:30:00.000Z",
    executionId,
    capability: "QUESTION",
    origin: "whatsapp",
    flow: "whatsapp_question",
    configuredProvider: "openai",
    configuredModel: "gpt-4o-mini",
    effectiveProvider: "openai",
    effectiveModel: "gpt-4o-mini",
    callRole: "primary",
    attemptIndex: 1,
    totalAttempts: 1,
    latencyMs: 10,
    totalLatencyMs: 10,
    outcome: "success",
    usage: { totalTokens: 100 },
    tools: [],
    estimatedCostUsd: 0.001,
    executionEstimatedCostUsd: 0.001,
    pricingCatalogVersion: "test",
    pricingEffectiveDate: "2026-08-01",
    fallback: {
      requested: false,
      enabled: false,
      kind: "none",
      eligibility: "not_needed",
      reason: "primary_succeeded",
      primaryAttempts: 1,
      fallbackCalls: 0,
    },
    degradation: "none",
    correlation,
  };
}

function economicRow(month: string, ratioBps: number | null) {
  const netEconomicRevenueMinor = 10_000;
  return {
    competenceMonth: `${month}-01T00:00:00.000Z`,
    payerUserId: 7,
    subscriptionId: "sub-pro",
    versionCode: "professional_v1",
    currency: "BRL",
    recognizedContractRevenueMinor: netEconomicRevenueMinor,
    netEconomicRevenueMinor,
    variableCostMicros: ratioBps == null ? 0 : ratioBps * 10_000,
    variableCostRatioBps: ratioBps,
    measurementCoverageBps: 10_000,
  };
}

describe("usage governance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getActiveUsageLimitation.mockResolvedValue([]);
    mocks.hasActiveUsageExemption.mockResolvedValue(false);
    mocks.getUserSubscriptionStatus.mockResolvedValue(status());
    mocks.recordUsageEvent.mockResolvedValue({ created: true });
    mocks.purgeUsageGovernanceRetention.mockResolvedValue(undefined);
    mocks.listEconomicFacts.mockResolvedValue([]);
    mocks.listMonthlyEconomicAggregates.mockResolvedValue([]);
    mocks.listUsageEvents.mockResolvedValue([]);
    mocks.refreshUsageDailyAggregates.mockResolvedValue(undefined);
    mocks.upsertMonthlyEconomicAggregate.mockResolvedValue(undefined);
  });

  it("attributes sponsored patient use to the professional payer without losing beneficiary", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(status("sponsored_by_professional", 7));
    const result = await enforceUsageAllowance({ userId: 99, capability: "QUESTION", origin: "whatsapp", flow: "whatsapp_question", conversationId: "wamid.private" });
    expect(result.correlation).toMatchObject({ beneficiaryUserId: 99, payerUserId: 7, sponsorUserId: 7, subscriptionId: "sub-pro", accessSource: "sponsored_by_professional" });
    expect(JSON.stringify(result.correlation)).not.toContain("wamid.private");
  });

  it("keeps historical attribution frozen when the current plan changes", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValueOnce(status("sponsored_by_professional", 7));
    const historical = await enforceUsageAllowance({ userId: 99, capability: "QUESTION", origin: "whatsapp", flow: "whatsapp_question", conversationId: "wamid.before-plan-change" });
    mocks.getUserSubscriptionStatus.mockResolvedValueOnce(status());
    const current = await enforceUsageAllowance({ userId: 99, capability: "QUESTION", origin: "whatsapp", flow: "whatsapp_question", conversationId: "wamid.after-plan-change" });
    await recordAiEconomicUsage(inferenceEvent("exec-before", historical.correlation));
    await recordAiEconomicUsage(inferenceEvent("exec-after", current.correlation));
    expect(mocks.recordUsageEvent.mock.calls[0][0]).toMatchObject({ beneficiaryUserId: 99, payerUserId: 7, sponsorUserId: 7, subscriptionId: "sub-pro", versionCode: "professional_v1", accessSource: "sponsored_by_professional" });
    expect(mocks.recordUsageEvent.mock.calls[1][0]).toMatchObject({ beneficiaryUserId: 99, payerUserId: 99, sponsorUserId: null, subscriptionId: "sub-own", versionCode: "individual_v1", accessSource: "active_subscription" });
    expect(mocks.getUserSubscriptionStatus).toHaveBeenCalledTimes(2);
  });

  it("does not block at a budget threshold; only an approved active limitation blocks heavy processing", async () => {
    expect(FAIR_USE_POLICY.automaticBlockingAtBudgetThreshold).toBe(false);
    await expect(enforceUsageAllowance({ userId: 2, capability: "QUESTION", origin: "web", flow: "question_answer" })).resolves.toBeTruthy();
    mocks.getActiveUsageLimitation.mockResolvedValue([{ id: "lim", abuseCaseId: "case", subjectUserId: 2, operations: ["ai_heavy_processing"], reason: "reviewed", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000), emergencySecurity: false, approvedByUserId: 1, secondApprovedByUserId: null }]);
    await expect(enforceUsageAllowance({ userId: 2, capability: "QUESTION", origin: "web", flow: "question_answer" })).rejects.toBeInstanceOf(AiUsageTemporarilyLimitedError);
  });

  it("honors temporary exemptions for the user or sponsoring professional before enforcing a limitation", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue(status("sponsored_by_professional", 7));
    mocks.getActiveUsageLimitation.mockResolvedValue([{ id: "lim", abuseCaseId: "case", subjectUserId: 99, operations: ["ai_heavy_processing"], reason: "reviewed", startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 60_000), emergencySecurity: false, approvedByUserId: 1, secondApprovedByUserId: null }]);
    mocks.hasActiveUsageExemption.mockResolvedValue(true);
    await expect(enforceUsageAllowance({ userId: 99, capability: "QUESTION", origin: "web", flow: "question_answer" })).resolves.toBeTruthy();
    expect(mocks.hasActiveUsageExemption).toHaveBeenCalledWith(expect.objectContaining({ userId: 99, professionalId: 7 }));
    expect(mocks.getActiveUsageLimitation).not.toHaveBeenCalled();
  });

  it("applies a professional exemption to the professional self-use only when a professional subscription exists", async () => {
    mocks.getUserSubscriptionStatus.mockResolvedValue({
      ...status(),
      professionalSubscription: { id: "sub-pro", planCode: "professional_v1", billingCycle: "monthly", currency: "BRL" },
    });
    mocks.hasActiveUsageExemption.mockResolvedValue(true);
    await expect(enforceUsageAllowance({ userId: 7, capability: "QUESTION", origin: "web", flow: "question_answer" })).resolves.toBeTruthy();
    expect(mocks.hasActiveUsageExemption).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, professionalId: 7 }));

    mocks.hasActiveUsageExemption.mockClear();
    mocks.getUserSubscriptionStatus.mockResolvedValue(status());
    await enforceUsageAllowance({ userId: 8, capability: "QUESTION", origin: "web", flow: "question_answer" });
    expect(mocks.hasActiveUsageExemption).toHaveBeenCalledWith(expect.objectContaining({ userId: 8, professionalId: null }));
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

  it("never mixes usage cost from another currency into the official KPI", async () => {
    mocks.listEconomicFacts.mockResolvedValue([{
      competenceStart: "2026-08-01", competenceEnd: "2026-08-31", amountMinor: 10_000,
      payerUserId: 7, subscriptionId: "sub-pro", versionCode: "professional_v1", billingCycle: "monthly",
      currency: "BRL", factType: "contract_revenue", valueKind: "effective",
    }]);
    mocks.listUsageEvents.mockResolvedValue([{
      occurredAt: "2026-08-10T00:00:00.000Z", payerUserId: 7, subscriptionId: "sub-pro",
      currency: "USD", estimatedCostMicros: 20_000_000,
    }]);
    await refreshEconomicAggregates(new Date("2026-08-16T12:00:00.000Z"));
    expect(mocks.upsertMonthlyEconomicAggregate).toHaveBeenCalledWith(expect.objectContaining({
      currency: "BRL", variableCostMicros: 0, variableCostRatioBps: null,
    }));
    expect(mocks.upsertMonthlyEconomicAggregate).toHaveBeenCalledWith(expect.objectContaining({
      currency: "USD", recognizedContractRevenueMinor: 0, variableCostMicros: 20_000_000, variableCostRatioBps: null,
    }));
  });

  it("keeps same-currency variable cost comparable in the official KPI", async () => {
    mocks.listEconomicFacts.mockResolvedValue([{
      competenceStart: "2026-08-01", competenceEnd: "2026-08-31", amountMinor: 10_000,
      payerUserId: 7, subscriptionId: "sub-pro", versionCode: "professional_v1", billingCycle: "monthly",
      currency: "BRL", factType: "contract_revenue", valueKind: "effective",
    }]);
    mocks.listUsageEvents.mockResolvedValue([{
      occurredAt: "2026-08-10T00:00:00.000Z", payerUserId: 7, subscriptionId: "sub-pro",
      currency: "BRL", estimatedCostMicros: 20_000_000,
    }]);
    await refreshEconomicAggregates(new Date("2026-08-16T12:00:00.000Z"));
    expect(mocks.upsertMonthlyEconomicAggregate).toHaveBeenCalledWith(expect.objectContaining({
      currency: "BRL", variableCostMicros: 20_000_000, variableCostRatioBps: 2000,
    }));
  });

  it("uses a three-month moving average and requires two consecutive rolling months above 30 percent", async () => {
    mocks.listMonthlyEconomicAggregates.mockResolvedValue([
      economicRow("2026-04", 3100), economicRow("2026-05", 3100), economicRow("2026-06", 3100),
      economicRow("2026-07", 3100), economicRow("2026-08", 3100),
    ]);
    const result = await getInternalUsageAnalytics({ from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-08-31T23:59:59.000Z"), userId: 7 });
    expect(result.monthlyEconomics).toHaveLength(2);
    expect(result.monthlyEconomics[0]).toMatchObject({ rolling3MonthVariableCostRatioBps: 3100, mandatoryReviewRequired: true, rolling3MonthHealth: "mandatory_review" });
    expect(result.monthlyEconomics[1]).toMatchObject({ rolling3MonthVariableCostRatioBps: 3100, mandatoryReviewRequired: true, rolling3MonthHealth: "mandatory_review" });
  });

  it("marks the rolling decision unavailable when any month is not currency-comparable", async () => {
    mocks.listMonthlyEconomicAggregates.mockResolvedValue([
      economicRow("2026-06", 2000), economicRow("2026-07", null), economicRow("2026-08", 2000),
    ]);
    const result = await getInternalUsageAnalytics({ from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-31T23:59:59.000Z"), userId: 7 });
    expect(result.monthlyEconomics[0]).toMatchObject({ rolling3MonthVariableCostRatioBps: null, rolling3MonthHealth: "unavailable", mandatoryReviewRequired: false });
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
