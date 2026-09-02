import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const read=(p:string)=>readFileSync(p,"utf8");

describe("usage governance canonical Drizzle installation",()=>{
  it("keeps governance migrations TiDB-safe",()=>{
    for(const [p,n] of Object.entries({
      "drizzle/0043_billing_usage_economics_governance.sql":11,
      "drizzle/0046_billing_usage_provider_dispatch_state.sql":2,
      "drizzle/0047_usage_governance_audit_closure.sql":18,
      "drizzle/0048_billing_consumption_charge_state_machine.sql":1,
    })){
      const statements=read(p).split("--> statement-breakpoint").map(s=>s.trim()).filter(Boolean);
      expect(statements,p).toHaveLength(n);
      for(const statement of statements){expect(statement,p).toMatch(/;$/);expect(statement.match(/;/g),p).toHaveLength(1);}
    }
  });

  it("journals 0043-0048 and installs draft as the canonical default",()=>{
    const journal=JSON.parse(read("drizzle/meta/_journal.json")) as {entries:Array<{tag:string}>};
    expect(journal.entries.slice(-6).map(e=>e.tag)).toEqual([
      "0043_billing_usage_economics_governance","0044_billing_usage_charge_revoke_reason","0045_billing_usage_cost_reconciliation",
      "0046_billing_usage_provider_dispatch_state","0047_usage_governance_audit_closure","0048_billing_consumption_charge_state_machine",
    ]);
    expect(read("drizzle/0048_billing_consumption_charge_state_machine.sql")).toContain("DEFAULT 'draft'");
    expect(read("drizzle/usage-governance-schema.ts")).toContain('state: varchar("state", { length: 24 }).default("draft").notNull()');
  });

  it("keeps governance tables represented in the configured schema and generated docs",()=>{
    const config=read("drizzle.config.ts"),schema=read("drizzle/usage-governance-schema.ts"),docs=read("docs/generated/db-schema.md");
    expect(config).toContain("./drizzle/usage-governance-schema.ts");
    for(const table of Array.from(read("drizzle/0043_billing_usage_economics_governance.sql").matchAll(/CREATE TABLE IF NOT EXISTS `([^`]+)`/g),m=>m[1])){
      expect(schema,table).toContain(`mysqlTable("${table}"`);expect(docs,table).toContain(`\`${table}\``);
    }
    expect(schema).toContain('mysqlTable("billingUsageCostReconciliations"');
  });
});
