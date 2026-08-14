import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { createDrizzleAsaasOperationStore } from "../server/modules/billing/asaas/operationStore";

const operationKey = "billing-test-asaas-concurrent-claim";
const externalReference = "billing-test-concurrent-contract";

async function main() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = mysql.createPool(databaseUrl);
  try {
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = 'asaas' AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) = ?",
      [operationKey]
    );

    const firstStore = createDrizzleAsaasOperationStore();
    const peerStore = createDrizzleAsaasOperationStore();
    const input = {
      kind: "reconciliation" as const,
      operationKey,
      externalReference,
    };

    const claims = await Promise.allSettled([
      firstStore.prepare(input),
      peerStore.prepare(input),
    ]);
    assert.equal(
      claims.filter(result => result.status === "fulfilled").length,
      1,
      "exactly one store instance must own a fresh provider mutation"
    );
    assert.equal(
      claims.filter(
        result =>
          result.status === "rejected" &&
          result.reason instanceof Error &&
          result.reason.message === "asaas_operation_in_progress"
      ).length,
      1,
      "the losing store instance must fail closed before provider I/O"
    );
    assert.equal(
      (await firstStore.get("reconciliation", operationKey))?.state,
      "prepared",
      "the fresh owner remains prepared until the provider mutation resolves"
    );

    await pool.query(
      `UPDATE billingProviderEvents
       SET updatedAt = DATE_SUB(NOW(), INTERVAL 121 SECOND)
       WHERE provider = 'asaas'
         AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) = ?`,
      [operationKey]
    );
    const recovered = await peerStore.prepare(input);
    assert.equal(
      recovered.operation.state,
      "outcome_unknown",
      "an abandoned owner must become reconcilable after the safety window"
    );

    console.log(
      JSON.stringify({
        event: "billing.asaas.concurrent_claim.passed",
        singleOwner: true,
        staleClaimRecovery: true,
      })
    );
  } finally {
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = 'asaas' AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) = ?",
      [operationKey]
    );
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
