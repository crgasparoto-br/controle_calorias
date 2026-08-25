import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { createDrizzleAsaasOperationStore } from "../server/modules/billing/asaas/operationStore";
import {
  claimBillingWebCheckoutAttempt,
  type BillingWebCheckoutAttemptDecision,
} from "../server/modules/billing/billingWebCheckoutAttempt";
import { configureBillingDbProvider } from "../server/repositories/billingRepositorySupport";

const operationKey = "billing-test-asaas-concurrent-claim";
const externalReference = "billing-test-concurrent-contract";
const checkoutUserId = 9191;
const checkoutProviderEventId = `checkout-intent:${crypto
  .createHash("sha256")
  .update(`payer:${checkoutUserId}`)
  .digest("hex")}`;

function claimed(
  decision: BillingWebCheckoutAttemptDecision
): Extract<BillingWebCheckoutAttemptDecision, { status: "claimed" }> {
  assert.equal(decision.status, "claimed");
  if (decision.status !== "claimed") throw new Error("unreachable");
  return decision;
}

function verifySponsoredPublicBoundary() {
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "vitest",
      "run",
      "server/modules/billing/webPublic.publicBoundary.test.ts",
    ],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        PROFESSIONAL_ACCESS_RECEIPT_STORAGE: "memory",
      },
    }
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    "sponsored billing public-boundary contract must pass inside the billing persistence gate"
  );
}

async function main() {
  verifySponsoredPublicBoundary();

  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  const pool = mysql.createPool({ uri: databaseUrl, connectionLimit: 8 });
  const db = drizzle(pool);
  configureBillingDbProvider(async () => db);

  async function resetCheckoutClaim() {
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = 'billing-web' AND providerEventId = ?",
      [checkoutProviderEventId]
    );
  }

  try {
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = 'asaas' AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) = ?",
      [operationKey]
    );
    await resetCheckoutClaim();
    await pool.query("DELETE FROM users WHERE id = ?", [checkoutUserId]);
    await pool.query(
      "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
      [
        checkoutUserId,
        `billing-checkout-concurrency-${checkoutUserId}`,
        "Billing checkout concurrency",
        `billing-checkout-concurrency-${checkoutUserId}@example.com`,
      ]
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

    const equivalentInput = {
      userId: checkoutUserId,
      versionCode: "individual-monthly-v1",
      paymentMethod: "credit_card" as const,
      trialChoice: "waive" as const,
      couponCode: null,
      replacementSubscriptionId: null,
    };
    const equivalentClaims = (
      await Promise.all([
        claimBillingWebCheckoutAttempt(equivalentInput),
        claimBillingWebCheckoutAttempt(equivalentInput),
      ])
    ).map(claimed);
    assert.equal(
      new Set(equivalentClaims.map(result => result.contractKey)).size,
      1,
      "equivalent cross-tab checkout claims must converge on one canonical key"
    );
    assert.equal(
      equivalentClaims.filter(result => result.persist).length,
      1,
      "only one equivalent cross-tab checkout claim may persist a fresh generation"
    );
    assert.equal(
      equivalentClaims.filter(result => result.reused).length,
      1,
      "the peer equivalent checkout claim must reuse the persisted generation"
    );
    const [equivalentRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingProviderEvents WHERE provider = 'billing-web' AND providerEventId = ? AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.versionCode')) = ?",
      [checkoutProviderEventId, equivalentInput.versionCode]
    );
    assert.equal(
      Number(equivalentRows[0]?.total),
      1,
      "equivalent cross-tab claims must leave exactly one durable checkout-intent row"
    );

    await resetCheckoutClaim();
    const incompatibleClaims = await Promise.all([
      claimBillingWebCheckoutAttempt({
        ...equivalentInput,
        paymentMethod: "credit_card",
      }),
      claimBillingWebCheckoutAttempt({
        ...equivalentInput,
        paymentMethod: "pix_automatic",
      }),
    ]);
    assert.equal(
      incompatibleClaims.filter(result => result.status === "claimed").length,
      1,
      "exactly one incompatible cross-tab checkout claim may own the active lineage"
    );
    assert.equal(
      incompatibleClaims.filter(result => result.status === "conflict").length,
      1,
      "the incompatible peer checkout claim must fail closed before creating another lineage"
    );
    const [incompatibleRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingProviderEvents WHERE provider = 'billing-web' AND providerEventId = ?",
      [checkoutProviderEventId]
    );
    assert.equal(
      Number(incompatibleRows[0]?.total),
      1,
      "incompatible cross-tab claims must still leave exactly one durable checkout-intent row"
    );

    await resetCheckoutClaim();
    const replacementInput = {
      ...equivalentInput,
      replacementSubscriptionId: "billing-test-expired-subscription",
    };
    const replacementClaims = (
      await Promise.all([
        claimBillingWebCheckoutAttempt(replacementInput),
        claimBillingWebCheckoutAttempt(replacementInput),
      ])
    ).map(claimed);
    assert.equal(
      new Set(replacementClaims.map(result => result.contractKey)).size,
      1,
      "retries for the same expired subscription must share one replacement contract key"
    );
    assert.deepEqual(
      replacementClaims.map(result => result.generation).sort(),
      [1, 1],
      "same-replacement concurrent retries must not rotate to a second generation"
    );
    assert.equal(
      replacementClaims.filter(result => result.persist).length,
      1,
      "only one same-replacement retry may persist the generation"
    );

    console.log(
      JSON.stringify({
        event: "billing.asaas.concurrent_claim.passed",
        singleOwner: true,
        staleClaimRecovery: true,
        checkoutCrossTabEquivalentSingleLineage: true,
        checkoutCrossTabIncompatibleFailClosed: true,
        checkoutReplacementRetrySingleGeneration: true,
        sponsoredPublicBoundary: true,
      })
    );
  } finally {
    await pool.query(
      "DELETE FROM billingProviderEvents WHERE provider = 'asaas' AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) = ?",
      [operationKey]
    );
    await resetCheckoutClaim().catch(() => undefined);
    await pool.query("DELETE FROM users WHERE id = ?", [checkoutUserId]);
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
