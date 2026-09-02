import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the usage governance migration test.");
}

const migrationPaths = [
  "drizzle/0043_billing_usage_economics_governance.sql",
  "drizzle/0044_billing_usage_charge_revoke_reason.sql",
  "drizzle/0045_billing_usage_cost_reconciliation.sql",
  "drizzle/0046_billing_usage_provider_dispatch_state.sql",
  "drizzle/0047_usage_governance_audit_closure.sql",
  "drizzle/0048_billing_consumption_charge_state_machine.sql",
];

const connection = await mysql.createConnection(databaseUrl);

try {
  for (const migrationPath of migrationPaths) {
    const statements = readFileSync(migrationPath, "utf8")
      .split("--> statement-breakpoint")
      .map(statement => statement.trim())
      .filter(Boolean);

    for (const statement of statements) {
      await connection.query(statement);
    }
  }

  const [providerDispatchColumn] = await connection.query<mysql.RowDataPacket[]>(
    "SHOW COLUMNS FROM billingUsageEvents LIKE 'providerDispatchStartedAt'"
  );
  const [providerDispatchIndex] = await connection.query<mysql.RowDataPacket[]>(
    "SHOW INDEX FROM billingUsageEvents WHERE Key_name='billingUsageEvents_provider_dispatch_state_idx'"
  );
  const [appealsTable] = await connection.query<mysql.RowDataPacket[]>(
    "SHOW TABLES LIKE 'billingUsageLimitationAppeals'"
  );
  const [authorizationStateColumn] = await connection.query<mysql.RowDataPacket[]>(
    "SHOW COLUMNS FROM billingConsumptionChargeAuthorizations LIKE 'state'"
  );

  if (providerDispatchColumn.length !== 1) {
    throw new Error("providerDispatchStartedAt was not installed by migration 0046.");
  }
  if (providerDispatchIndex.length !== 2) {
    throw new Error("Provider dispatch composite index was not installed by migration 0046.");
  }
  if (appealsTable.length !== 1) {
    throw new Error("billingUsageLimitationAppeals was not installed by migration 0047.");
  }
  if (authorizationStateColumn.length !== 1 || authorizationStateColumn[0]?.Default !== "draft") {
    throw new Error("billingConsumptionChargeAuthorizations.state default was not changed to draft by migration 0048.");
  }

  console.log("Usage governance migrations 0043-0048 validated on TiDB.");
} finally {
  await connection.end();
}
