import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../../db")>();
  return {
    ...actual,
    getDb: vi.fn(async () => ({ execute: mocks.execute })),
  };
});

import { getUsageGovernanceAdminEconomicRows } from "./adminEconomicRows";

function economicRow(index: number, competenceMonth: string) {
  return {
    competenceMonth,
    payerUserId: index + 1,
    subscriptionId: `sub-${index}`,
    productCode: "professional",
    versionCode: "v1",
    billingCycle: "monthly",
    currency: "BRL",
    recognizedContractRevenueMinor: 10000,
    discountMinor: 0,
    couponMinor: 0,
    creditMinor: 0,
    refundMinor: 0,
    chargebackMinor: 0,
    taxMinor: 0,
    receiptFeeMinor: 0,
    financialCostMinor: 0,
    netEconomicRevenueMinor: 10000,
    variableCostMicros: 1000000,
    variableCostRatioBps: 100,
    measurementCoverageBps: 10000,
    ruleVersion: "v1",
    updatedAt: `${competenceMonth.slice(0, 7)}-15T12:00:00.000Z`,
  };
}

describe("usage governance admin economic period read model", () => {
  it("returns the requested month exhaustively even when it exceeds the former recent-row sample", async () => {
    mocks.execute.mockResolvedValue([[
      economicRow(900, "2026-06-01T00:00:00.000Z"),
      economicRow(901, "2026-07-01T00:00:00.000Z"),
      ...Array.from({ length: 700 }, (_, index) => economicRow(index, "2026-08-01T00:00:00.000Z")),
    ]]);

    const result = await getUsageGovernanceAdminEconomicRows({
      month: "2026-08",
      productCode: "professional",
      versionCode: "v1",
      billingCycle: "monthly",
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    expect(result.rows).toHaveLength(700);
    expect(result.rows.every(row => row.competenceMonth.getUTCMonth() === 7)).toBe(true);
  });
});
