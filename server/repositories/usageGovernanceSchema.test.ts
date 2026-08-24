import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

describe("usage governance canonical Drizzle installation", () => {
  it("keeps multi-statement governance migrations split for TiDB", () => {
    const expectedStatementCounts = {
      "drizzle/0043_billing_usage_economics_governance.sql": 11,
      "drizzle/0047_usage_governance_audit_closure.sql": 11,
    };

    for (const [migrationPath, expectedStatementCount] of Object.entries(expectedStatementCounts)) {
      const statements = read(migrationPath)
        .split("--> statement-breakpoint")
        .map(statement => statement.trim())
        .filter(Boolean);

      expect(statements, migrationPath).toHaveLength(expectedStatementCount);
      for (const statement of statements) {
        expect(statement, migrationPath).toMatch(/;$/);
        expect(statement.match(/;/g), migrationPath).toHaveLength(1);
      }
    }
  });

  it("keeps migrations 0043-0047 journaled and represented by the canonical schema", () => {
    const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.slice(-5).map(entry => entry.tag)).toEqual([
      "0043_billing_usage_economics_governance",
      "0044_billing_usage_charge_revoke_reason",
      "0045_billing_usage_cost_reconciliation",
      "0046_billing_usage_provider_dispatch_state",
      "0047_usage_governance_audit_closure",
    ]);

    const snapshot = JSON.parse(read("drizzle/meta/0046_snapshot.json")) as {
      tables: Record<string, { columns: Record<string, unknown> }>;
    };
    const requiredTables = [
      "billingUsageEvents",
      "billingUsageDailyAggregates",
      "billingEconomicFacts",
      "billingEconomicMonthlyAggregates",
      "billingUsagePolicies",
      "billingUsageAllowanceGrants",
      "billingUsageAbuseCases",
      "billingUsageLimitations",
      "billingConsumptionChargeAuthorizations",
      "billingUsageLegalHolds",
      "billingUsageRetentionAudit",
      "billingUsageCostReconciliations",
    ];
    for (const table of requiredTables) {
      expect(snapshot.tables[table], table).toBeDefined();
    }
    expect(snapshot.tables.billingUsageEvents.columns).toHaveProperty("providerDispatchStartedAt");
    expect(snapshot.tables.billingConsumptionChargeAuthorizations.columns).toHaveProperty("revokeReason");
    expect(read("drizzle/0047_usage_governance_audit_closure.sql")).toContain("billingUsageLimitationAppeals");
  });

  it("keeps every governance migration represented in the configured TypeScript schema", () => {
    const config = read("drizzle.config.ts");
    const schema = read("drizzle/usage-governance-schema.ts");
    const generatedDocs = read("docs/generated/db-schema.md");
    expect(config).toContain("./drizzle/usage-governance-schema.ts");
    for (const table of Array.from(read("drizzle/0043_billing_usage_economics_governance.sql").matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`/g), match => match[1])) {
      expect(schema, table).toContain(`mysqlTable(\"${table}\"`);
      expect(generatedDocs, table).toContain(`\`${table}\``);
    }
    expect(schema).toContain('mysqlTable("billingUsageCostReconciliations"');
  });
});
