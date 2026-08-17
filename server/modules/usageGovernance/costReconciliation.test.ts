import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcileUsageEventEffectiveCost: vi.fn(),
  refreshUsageDailyAggregates: vi.fn(),
  refreshEconomicAggregatesForRange: vi.fn(),
}));

vi.mock("../../repositories/usageCostReconciliationRepository", () => ({
  reconcileUsageEventEffectiveCost: mocks.reconcileUsageEventEffectiveCost,
}));
vi.mock("../../repositories/usageGovernanceRepository", () => ({
  refreshUsageDailyAggregates: mocks.refreshUsageDailyAggregates,
}));
vi.mock("./service", () => ({
  USAGE_RULE_VERSION: "test-rule",
  refreshEconomicAggregatesForRange: mocks.refreshEconomicAggregatesForRange,
}));

import { reconcileUsageCost } from "./costReconciliation";

describe("usage cost reconciliation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates derived daily and monthly state after an effective cost is applied", async () => {
    mocks.reconcileUsageEventEffectiveCost.mockResolvedValue({
      applied: true,
      usageEventId: "event-1",
      occurredAt: new Date("2026-08-16T18:30:00.000Z"),
    });

    await reconcileUsageCost({
      reconciliationKey: "meta-invoice-line-001",
      usageIdempotencyKey: "meta:whatsapp:abc12345",
      effectiveCostMicros: 1234,
      currency: "usd",
      reason: "provider settlement",
      actorUserId: 9,
    });

    expect(mocks.reconcileUsageEventEffectiveCost).toHaveBeenCalledWith(expect.objectContaining({
      reconciliationKey: "meta-invoice-line-001",
      usageIdempotencyKey: "meta:whatsapp:abc12345",
      effectiveCostMicros: 1234,
      currency: "USD",
      actorUserId: 9,
    }));
    expect(mocks.refreshUsageDailyAggregates).toHaveBeenCalledWith(
      new Date("2026-08-16T00:00:00.000Z"),
      new Date("2026-08-17T00:00:00.000Z"),
      "test-rule",
    );
    expect(mocks.refreshEconomicAggregatesForRange).toHaveBeenCalled();
  });

  it("does not recompute aggregates for an idempotent duplicate reconciliation", async () => {
    mocks.reconcileUsageEventEffectiveCost.mockResolvedValue({
      applied: false,
      usageEventId: "event-1",
      occurredAt: new Date("2026-08-16T18:30:00.000Z"),
    });
    await reconcileUsageCost({
      reconciliationKey: "meta-invoice-line-001",
      usageIdempotencyKey: "meta:whatsapp:abc12345",
      effectiveCostMicros: 1234,
      currency: "USD",
      reason: "provider settlement",
    });
    expect(mocks.refreshUsageDailyAggregates).not.toHaveBeenCalled();
    expect(mocks.refreshEconomicAggregatesForRange).not.toHaveBeenCalled();
  });
});
