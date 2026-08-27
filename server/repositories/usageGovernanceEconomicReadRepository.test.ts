import { MySqlDialect } from "drizzle-orm/mysql-core";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));

vi.mock("../db", async importOriginal => {
  const actual = await importOriginal<typeof import("../db")>();
  return {
    ...actual,
    getDb: vi.fn(async () => ({ execute: mocks.execute })),
  };
});

import { getUsageGovernanceAdminEconomicRows } from "../modules/usageGovernance/adminEconomicRows";

describe("usage governance economic admin read", () => {
  it("filters retained economic rows in SQL without a hidden LIMIT", async () => {
    mocks.execute.mockResolvedValue([[]]);

    await getUsageGovernanceAdminEconomicRows({
      month: "2026-08",
      payerUserId: 41,
      productCode: "professional",
      versionCode: "v1",
      billingCycle: "monthly",
    });

    expect(mocks.execute).toHaveBeenCalledTimes(1);
    const compiled = new MySqlDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(compiled.sql).toContain("competenceMonth >= DATE(?)");
    expect(compiled.sql).toContain("competenceMonth < DATE(?)");
    expect(compiled.sql).toContain("payerUserId = ?");
    expect(compiled.sql).toContain("productCode LIKE ?");
    expect(compiled.sql).toContain("versionCode LIKE ?");
    expect(compiled.sql).toContain("billingCycle LIKE ?");
    expect(compiled.sql).not.toMatch(/\bLIMIT\b/i);
    expect(compiled.params).toEqual(expect.arrayContaining([41, "%professional%", "%v1%", "%monthly%"]));
  });
});
