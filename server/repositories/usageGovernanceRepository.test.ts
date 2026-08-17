import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
}));

vi.mock("drizzle-orm", () => {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => strings.reduce(
    (text, part, index) => text + part + (index < values.length ? String(values[index] ?? "") : ""),
    "",
  );
  return { sql };
});
vi.mock("../db", () => ({
  getDb: vi.fn(async () => ({
    execute: mocks.execute,
    transaction: async (callback: (tx: { execute: typeof mocks.execute }) => Promise<void>) => callback({ execute: mocks.execute }),
  })),
}));
vi.mock("./billingRepositorySupport", () => ({ resultRows: vi.fn(() => []) }));

import { purgeUsageGovernanceRetention } from "./usageGovernanceRetentionRepository";

describe("usage governance retention legal holds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue([]);
  });

  it("applies active legal holds to detail, daily aggregates and monthly economics", async () => {
    await purgeUsageGovernanceRetention({
      now: new Date("2026-08-16T12:00:00.000Z"),
      detailedCutoff: new Date("2025-07-16T12:00:00.000Z"),
      dailyCutoff: new Date("2024-08-16T12:00:00.000Z"),
      monthlyCutoff: new Date("2021-08-16T12:00:00.000Z"),
      governanceCutoff: new Date("2021-08-16T12:00:00.000Z"),
      ruleVersion: "test",
      auditId: "audit-1",
    });

    const queries = mocks.execute.mock.calls.map(call => String(call[0]));
    const detail = queries.find(query => query.includes("DELETE e FROM billingUsageEvents")) ?? "";
    const daily = queries.find(query => query.includes("DELETE d FROM billingUsageDailyAggregates")) ?? "";
    const monthly = queries.find(query => query.includes("DELETE m FROM billingEconomicMonthlyAggregates")) ?? "";

    for (const query of [detail, daily, monthly]) {
      expect(query).toContain("billingUsageLegalHolds");
      expect(query).toContain("h.startsAt <=");
      expect(query).toContain("h.endsAt IS NULL OR h.endsAt >");
      expect(query).toContain("h.scopeType='global'");
    }
    expect(detail).toContain("CAST(e.payerUserId AS CHAR)");
    expect(detail).toContain("CAST(e.sponsorUserId AS CHAR)");
    expect(daily).toContain("CAST(d.payerUserId AS CHAR)");
    expect(daily).toContain("CAST(d.sponsorUserId AS CHAR)");
    expect(monthly).toContain("CAST(m.payerUserId AS CHAR)");
    expect(monthly).toContain("h.scopeId=m.subscriptionId");

    const governedDeletes = [
      "DELETE p FROM billingUsagePolicies",
      "DELETE g FROM billingUsageAllowanceGrants",
      "DELETE appeal FROM billingUsageLimitationAppeals",
      "DELETE c FROM billingUsageAbuseCases",
      "DELETE l FROM billingUsageLimitations",
      "DELETE a FROM billingConsumptionChargeAuthorizations",
      "DELETE r FROM billingUsageCostReconciliations",
      "DELETE a FROM billingUsageRetentionAudit",
      "DELETE held FROM billingUsageLegalHolds",
    ];
    for (const deletion of governedDeletes) {
      const query = queries.find(candidate => candidate.includes(deletion)) ?? "";
      expect(query).toContain("billingUsageLegalHolds");
      expect(query).toContain("Aug 16 2021");
    }
  });

  it("materializes terminal dismissed and limited case states before applying the exact five-year cutoff", async () => {
    await purgeUsageGovernanceRetention({
      now: new Date("2026-08-16T12:00:00.000Z"),
      detailedCutoff: new Date("2025-07-16T12:00:00.000Z"),
      dailyCutoff: new Date("2024-08-16T12:00:00.000Z"),
      monthlyCutoff: new Date("2021-08-16T12:00:00.000Z"),
      governanceCutoff: new Date("2021-08-16T12:00:00.000Z"),
      ruleVersion: "test", auditId: "audit-terminal",
    });
    const queries=mocks.execute.mock.calls.map(call=>String(call[0]));
    expect(queries.some(query=>query.includes("SET state='expired'")&&query.includes("endsAt <="))).toBe(true);
    expect(queries.some(query=>query.includes("reviewOutcome='dismissed'")&&query.includes("closedAt=COALESCE"))).toBe(true);
    const limited=queries.find(query=>query.includes("JOIN (\n        SELECT abuseCaseId"))??"";
    expect(limited).toContain("appeal.state='pending'");
    const cases=queries.find(query=>query.includes("DELETE c FROM billingUsageAbuseCases"))??"";
    expect(cases).toContain("c.closedAt <");
    expect(cases).not.toContain("c.closedAt <=");
    expect(cases).toContain("h.id IS NULL");
    const appeals=queries.find(query=>query.includes("DELETE appeal FROM billingUsageLimitationAppeals"))??"";
    expect(appeals).toContain("billingUsageLegalHolds");
    expect(appeals).toContain("COALESCE(appeal.reviewedAt, appeal.submittedAt) <");
  });
});
