import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listMonthlyEconomicAggregates: vi.fn(),
  listUsageDailyAggregatesPage: vi.fn(),
  purgeUsageGovernanceRetention: vi.fn(),
}));

vi.mock("../billing/service", () => ({ billingService: { getUserSubscriptionStatus: vi.fn() } }));
vi.mock("../../repositories/usageGovernanceRepository", () => ({
  getActiveUsageLimitation: vi.fn(),
  listEconomicFactsPage: vi.fn(),
  listMonthlyEconomicAggregates: mocks.listMonthlyEconomicAggregates,
  listUsageDailyAggregatesPage: mocks.listUsageDailyAggregatesPage,
  listUsageEventsPage: vi.fn(),
  recordEconomicFact: vi.fn(),
  recordUsageEvent: vi.fn(),
  refreshUsageDailyAggregates: vi.fn(),
  upsertMonthlyEconomicAggregate: vi.fn(),
}));
vi.mock("../../repositories/usageGovernancePolicyRepository", () => ({ hasActiveUsageExemption: vi.fn() }));
vi.mock("../../repositories/usageGovernanceRetentionRepository", () => ({
  purgeUsageGovernanceRetention: mocks.purgeUsageGovernanceRetention,
}));

import { getInternalUsageAnalytics, runUsageRetention } from "./service";

describe("usage governance economic retention coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.listMonthlyEconomicAggregates.mockResolvedValue([]);
    mocks.listUsageDailyAggregatesPage.mockResolvedValue([]);
    mocks.purgeUsageGovernanceRetention.mockResolvedValue(undefined);
  });

  it("reports partial economic coverage when the requested window starts before retained monthly aggregates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2021-07-01T00:00:00.000Z"),
      to: new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(result.coverage.economics).toMatchObject({
      state: "partial",
      requestedFrom: new Date("2021-07-01T00:00:00.000Z"),
      availableFrom: new Date("2021-08-01T00:00:00.000Z"),
      availableTo: new Date("2026-09-01T00:00:00.000Z"),
      retentionYears: 5,
      truncated: false,
    });
    expect(mocks.listMonthlyEconomicAggregates).toHaveBeenCalledWith({
      from: new Date("2021-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      payerUserId: undefined,
    });
  });

  it("reports complete economic coverage at the exact retained month boundary", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2021-08-01T00:00:00.000Z"),
      to: new Date("2026-08-17T00:00:00.000Z"),
    });

    expect(result.coverage.economics).toMatchObject({
      state: "complete",
      requestedFrom: new Date("2021-08-01T00:00:00.000Z"),
      availableFrom: new Date("2021-08-01T00:00:00.000Z"),
    });
    expect(mocks.listMonthlyEconomicAggregates).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date("2021-08-01T00:00:00.000Z"),
    }));
  });

  it("does not query expired economic aggregates when the requested window is entirely before retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T00:00:00.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2020-01-01T00:00:00.000Z"),
      to: new Date("2021-06-30T23:59:59.000Z"),
    });

    expect(result.coverage.economics).toMatchObject({
      state: "partial",
      availableFrom: new Date("2021-08-01T00:00:00.000Z"),
      availableTo: new Date("2021-07-01T00:00:00.000Z"),
    });
    expect(result.monthlyEconomics).toEqual([]);
    expect(mocks.listMonthlyEconomicAggregates).not.toHaveBeenCalled();
  });

  it("reports complete daily coverage at the exact retained day boundary even when now is mid-day", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:34:56.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2024-08-17T00:00:00.000Z"),
      to: new Date("2026-08-17T12:34:56.000Z"),
    });

    expect(result.coverage.usage).toMatchObject({
      state: "complete",
      requestedFrom: new Date("2024-08-17T00:00:00.000Z"),
      availableFrom: new Date("2024-08-17T00:00:00.000Z"),
      availableTo: new Date("2026-08-17T12:34:56.000Z"),
      retentionMonths: 24,
      truncated: false,
    });
    expect(mocks.listUsageDailyAggregatesPage).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date("2024-08-17T00:00:00.000Z"),
      to: new Date("2026-08-17T12:34:56.000Z"),
    }));
  });

  it("clamps partial daily coverage to the retained day boundary with a user filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:34:56.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2024-08-16T23:59:59.000Z"),
      to: new Date("2026-08-17T12:34:56.000Z"),
      userId: 42,
    });

    expect(result.coverage.usage).toMatchObject({
      state: "partial",
      requestedFrom: new Date("2024-08-16T23:59:59.000Z"),
      availableFrom: new Date("2024-08-17T00:00:00.000Z"),
    });
    expect(mocks.listUsageDailyAggregatesPage).toHaveBeenCalledWith(expect.objectContaining({
      from: new Date("2024-08-17T00:00:00.000Z"),
      userId: 42,
    }));
  });

  it("does not query daily aggregates when the requested window is entirely before retention", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:34:56.000Z"));

    const result = await getInternalUsageAnalytics({
      from: new Date("2024-08-15T00:00:00.000Z"),
      to: new Date("2024-08-17T00:00:00.000Z"),
    });

    expect(result.coverage.usage).toMatchObject({
      state: "partial",
      availableFrom: new Date("2024-08-17T00:00:00.000Z"),
      availableTo: new Date("2024-08-17T00:00:00.000Z"),
    });
    expect(result.byOperation).toEqual([]);
    expect(mocks.listUsageDailyAggregatesPage).not.toHaveBeenCalled();
  });

  it("uses the same bucket-aligned cutoffs for retention and coverage", async () => {
    await runUsageRetention(new Date("2026-08-17T12:34:56.000Z"));

    expect(mocks.purgeUsageGovernanceRetention).toHaveBeenCalledWith(expect.objectContaining({
      dailyCutoff: new Date("2024-08-17T00:00:00.000Z"),
      monthlyCutoff: new Date("2021-08-01T00:00:00.000Z"),
    }));
  });
});
