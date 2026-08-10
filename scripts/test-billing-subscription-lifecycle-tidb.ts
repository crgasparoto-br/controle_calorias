import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { INITIAL_BILLING_CATALOG } from "../server/modules/billing/catalogPolicy";
import {
  createBillingSubscriptionLifecycleService,
  createTrialIdentityHasher,
} from "../server/modules/billing/subscriptionLifecycle";
import { createBillingCatalogRepository } from "../server/repositories/billingCatalogRepository";
import { createDrizzleBillingRepository } from "../server/repositories/billingRepository";
import { createBillingSubscriptionLifecycleRepository } from "../server/repositories/billingSubscriptionLifecycleRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the billing lifecycle integration test.");
}

const users = {
  trialA: 9391,
  trialB: 9392,
  professional: 9393,
};
const provider = "lifecycle-integration-test";
const base = new Date("2026-08-09T12:00:00.000Z");
const day = 24 * 60 * 60 * 1000;
const plusDays = (value: Date, days: number) => new Date(value.getTime() + days * day);

async function main() {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 8,
    ...(process.env.TIDB_ENABLE_SSL === "true"
      ? { ssl: { minVersion: "TLSv1.2" as const } }
      : {}),
  });
  const db = drizzle(pool);
  const deps = {
    getDb: async () => db,
    onWarning: (scope: string, error: unknown) => {
      console.warn(scope, error instanceof Error ? error.message : String(error));
    },
  };
  const catalog = createBillingCatalogRepository(deps);
  const lifecycleRepository = createBillingSubscriptionLifecycleRepository(deps);
  const billingRepository = createDrizzleBillingRepository(deps);
  const service = createBillingSubscriptionLifecycleService({
    repository: lifecycleRepository,
    hashTrialIdentity: createTrialIdentityHasher(
      "billing-lifecycle-integration-secret-0001"
    ),
    now: () => base,
  });

  async function cleanup() {
    const ids = Object.values(users);
    const placeholders = ids.map(() => "?").join(",");
    const [subscriptionRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT id FROM billingSubscriptions WHERE payerUserId IN (${placeholders})`,
      ids
    );
    const subscriptionIds = subscriptionRows.map(row => String(row.id));
    if (subscriptionIds.length) {
      const subPlaceholders = subscriptionIds.map(() => "?").join(",");
      await pool.query(
        `DELETE FROM billingTrialIdentityClaims WHERE subscriptionId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingSubscriptionLifecycleAuditEvents WHERE subscriptionId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingSubscriptionFacts WHERE subscriptionId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingProviderEvents WHERE subscriptionId IN (${subPlaceholders}) OR provider = ?`,
        [...subscriptionIds, provider]
      );
      await pool.query(
        `DELETE FROM billingEntitlements WHERE sourceId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingContractIntents WHERE subscriptionId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingSubscriptionLifecycle WHERE subscriptionId IN (${subPlaceholders})`,
        subscriptionIds
      );
      await pool.query(
        `DELETE FROM billingSubscriptions WHERE id IN (${subPlaceholders})`,
        subscriptionIds
      );
    }
    await pool.query(
      `DELETE FROM billingTrialEligibilityAuditEvents WHERE payerUserId IN (${placeholders})`,
      ids
    );
    await pool.query(`DELETE FROM users WHERE id IN (${placeholders})`, ids);
  }

  try {
    await cleanup();
    for (const userId of Object.values(users)) {
      await pool.query(
        "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, 'user')",
        [
          userId,
          `billing-lifecycle-${userId}`,
          `Billing Lifecycle ${userId}`,
          `billing-lifecycle-${userId}@example.com`,
        ]
      );
    }
    await catalog.seedInitialCatalog(INITIAL_BILLING_CATALOG);
    const individual = INITIAL_BILLING_CATALOG.find(
      item => item.audience === "individual" && item.billingCycle === "monthly"
    );
    const professional = INITIAL_BILLING_CATALOG.find(
      item => item.audience === "professional" && item.billingCycle === "monthly"
    );
    assert(individual, "individual monthly plan must exist");
    assert(professional, "professional monthly plan must exist");

    const [trialA, trialB] = await Promise.all([
      service.startContract({
        contractKey: "lifecycle-trial-a",
        providerCode: provider,
        payerUserId: users.trialA,
        versionCode: individual.versionCode,
        paymentMethod: "credit_card",
        trialChoice: "request",
        identity: {
          userId: users.trialA,
          cpf: "12345678901",
          phone: "11911111111",
        },
        correlationId: "trial-a",
      }),
      service.startContract({
        contractKey: "lifecycle-trial-b",
        providerCode: provider,
        payerUserId: users.trialB,
        versionCode: individual.versionCode,
        paymentMethod: "credit_card",
        trialChoice: "request",
        identity: {
          userId: users.trialB,
          cpf: "12345678901",
          phone: "11922222222",
        },
        correlationId: "trial-b",
      }),
    ]);
    const successfulTrials = [trialA, trialB].filter(result => result.ok);
    assert.equal(successfulTrials.length, 1, "only one concurrent CPF trial may win");
    assert(
      [trialA, trialB].some(
        result => !result.ok && ["trial_already_used", "trial_identity_conflict"].includes(result.reason)
      ),
      "the losing trial must be an explicit identity decision"
    );
    const winner = successfulTrials[0];
    assert(winner?.ok);

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(base, 6));
    const firstPayment = {
      providerCode: provider,
      providerEventId: "lifecycle-payment-confirmed",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_confirmed" as const,
      chargePurpose: "initial" as const,
      occurredAt: plusDays(base, 8),
      competenceKey: "2026-08",
      currentPeriodStart: plusDays(base, 8),
      currentPeriodEnd: plusDays(base, 38),
      correlationId: "payment-confirmed",
    };
    const applied = await service.applyFinancialFact(firstPayment);
    assert.equal(applied.result, "applied");
    assert.equal(applied.state, "active");
    const duplicate = await service.applyFinancialFact(firstPayment);
    assert.equal(duplicate.result, "duplicate");

    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-stale-failure",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(base, 7),
      competenceKey: "2026-09",
      correlationId: "stale-failure",
    });
    let current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "active", "stale failure must not regress active state");

    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-renewal-failed",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(base, 38),
      competenceKey: "2026-09",
      correlationId: "renewal-failed",
    });
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "past_due");
    const graceAccess = await billingRepository.listAccessCandidates(
      users.trialA === winner.snapshot.payerUserId ? users.trialA : users.trialB,
      plusDays(base, 40)
    );
    assert(
      graceAccess.some(candidate => candidate.reason === "active_subscription"),
      "past_due grace must preserve full subscription access"
    );

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(base, 45));
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "suspended");
    const [noticeRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT factType, COUNT(*) AS total
       FROM billingSubscriptionFacts
       WHERE subscriptionId = ? AND factType LIKE 'past_due_notice_day_%'
       GROUP BY factType`,
      [winner.snapshot.subscriptionId]
    );
    assert.deepEqual(
      Object.fromEntries(noticeRows.map(row => [String(row.factType), Number(row.total)])),
      {
        past_due_notice_day_0: 1,
        past_due_notice_day_2: 1,
        past_due_notice_day_5: 1,
        past_due_notice_day_7: 1,
      }
    );

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(base, 75));
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "expired");
    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-late-payment",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "recovery",
      occurredAt: plusDays(base, 76),
      competenceKey: "2026-09",
      correlationId: "late-payment",
    });
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "expired");
    assert.equal(current?.reconciliationRequired, true);

    const professionalTrial = await service.startContract({
      contractKey: "lifecycle-professional-trial",
      providerCode: provider,
      payerUserId: users.professional,
      versionCode: professional.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      identity: {
        userId: users.professional,
        cnpj: "12345678000199",
        phone: "11933333333",
      },
      correlationId: "professional-trial",
    });
    assert(professionalTrial.ok);
    const professionalAccess = await billingRepository.getActiveProfessionalSubscription(
      users.professional,
      plusDays(base, 1)
    );
    assert.equal(professionalAccess?.capacityLimit, 5);
    assert.equal(professionalAccess?.status, "pending");

    const [factPayloads] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT payloadJson FROM billingSubscriptionFacts WHERE subscriptionId = ?",
      [winner.snapshot.subscriptionId]
    );
    const serialized = JSON.stringify(factPayloads).toLowerCase();
    assert(!serialized.includes("credit_card"));
    assert(!serialized.includes("pix_automatic"));
    assert(!serialized.includes(String(individual.unitAmount)));

    console.log("Billing subscription lifecycle TiDB test passed.");
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
