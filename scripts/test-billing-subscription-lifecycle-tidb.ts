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
import { createBillingLifecycleRemediationReadModel } from "../server/repositories/billingLifecycleRemediationReadModel";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the billing lifecycle integration test.");
}

const users = {
  trialA: 9391,
  trialB: 9392,
  professional: 9393,
  transition: 9394,
};
const provider = "lifecycle-integration-test";
const day = 24 * 60 * 60 * 1000;

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
  const remediationReadModel = createBillingLifecycleRemediationReadModel(deps);
  const billingRepository = createDrizzleBillingRepository(deps);

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
    await pool.query(
      `DELETE FROM billingEntitlements WHERE beneficiaryUserId IN (${placeholders})`,
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

    // Other billing integration tests intentionally exercise catalog activation
    // and may leave the shared ephemeral TiDB fixture inactive. This test owns
    // the lifecycle state machine, so normalize only the two catalog rows it
    // consumes instead of coupling lifecycle behavior to previous test order.
    const base = new Date("2030-01-01T12:00:00.000Z");
    const fixtureEffectiveFrom = new Date(base.getTime() - 60_000);
    await pool.query(
      `UPDATE billingPlans
       SET status = 'active', active = true, effectiveFrom = ?, effectiveUntil = NULL
       WHERE versionCode IN (?, ?)`,
      [fixtureEffectiveFrom, individual.versionCode, professional.versionCode]
    );
    await pool.query(
      `UPDATE billingProducts p
       INNER JOIN billingPlans v ON v.productId = p.id
       SET p.state = 'active'
       WHERE v.versionCode IN (?, ?)`,
      [individual.versionCode, professional.versionCode]
    );

    const plusDays = (days: number) => new Date(base.getTime() + days * day);
    const service = createBillingSubscriptionLifecycleService({
      repository: lifecycleRepository,
      remediationReadModel,
      hashTrialIdentity: createTrialIdentityHasher(
        "billing-lifecycle-integration-secret-0001"
      ),
      now: () => base,
    });

    await pool.query(
      `INSERT INTO billingEntitlements (
        id, beneficiaryUserId, sourceType, sourceId, state, activeGrantKey,
        entitlementsJson, validFrom, validUntil, createdAt, updatedAt
      ) VALUES (?, ?, 'transition', ?, 'active', ?, JSON_ARRAY('system_access'), ?, ?, NOW(), NOW())`,
      [
        "lifecycle-transition-entitlement",
        users.transition,
        "migration-30-days",
        "transition:lifecycle-test",
        base,
        plusDays(30),
      ]
    );
    const migrationContract = await service.startContract({
      contractKey: "lifecycle-transition-contract",
      providerCode: provider,
      payerUserId: users.transition,
      versionCode: individual.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      transitionAccessUntil: plusDays(30),
      correlationId: "transition-contract",
    });
    assert(migrationContract.ok);
    assert.equal(migrationContract.snapshot.trialStartedAt, null);
    assert.equal(migrationContract.snapshot.trialEndsAt, null);
    assert.equal(migrationContract.snapshot.firstChargeAt?.getTime(), plusDays(31).getTime());
    const [transitionClaims] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingTrialIdentityClaims WHERE subscriptionId = ?",
      [migrationContract.snapshot.subscriptionId]
    );
    assert.equal(Number(transitionClaims[0]?.total ?? 0), 0);
    const laterTrial = await service.startContract({
      contractKey: "lifecycle-transition-later-trial",
      providerCode: provider,
      payerUserId: users.transition,
      versionCode: individual.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      verifiedPaymentInstrument: {
        payerUserId: users.transition,
        providerCode: provider,
        paymentMethod: "credit_card",
        registrationId: "registered-card-transition",
        verifiedAt: base,
      },
      identity: {
        userId: users.transition,
        cpf: "98765432100",
        phone: "11944444444",
      },
      correlationId: "transition-later-trial",
    });
    assert.deepEqual(laterTrial, { ok: false, reason: "trial_already_used" });

    const [trialA, trialB] = await Promise.all([
      service.startContract({
        contractKey: "lifecycle-trial-a",
        providerCode: provider,
        payerUserId: users.trialA,
        versionCode: individual.versionCode,
        paymentMethod: "credit_card",
        trialChoice: "request",
        verifiedPaymentInstrument: {
          payerUserId: users.trialA,
          providerCode: provider,
          paymentMethod: "credit_card",
          registrationId: "registered-card",
          verifiedAt: base,
        },
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
        verifiedPaymentInstrument: {
          payerUserId: users.trialB,
          providerCode: provider,
          paymentMethod: "credit_card",
          registrationId: "registered-card",
          verifiedAt: base,
        },
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
        result =>
          !result.ok &&
          ["trial_already_used", "trial_identity_conflict"].includes(result.reason)
      ),
      "the losing trial must be an explicit identity decision"
    );
    const winner = successfulTrials[0];
    assert(winner?.ok);

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(6));
    const firstPayment = {
      providerCode: provider,
      providerEventId: "lifecycle-payment-confirmed",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_confirmed" as const,
      chargePurpose: "initial" as const,
      occurredAt: plusDays(8),
      competenceKey: "first-paid-competence",
      currentPeriodStart: plusDays(8),
      currentPeriodEnd: plusDays(38),
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
      occurredAt: plusDays(7),
      competenceKey: "next-competence",
      correlationId: "stale-failure",
    });
    let current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "active", "stale failure must not regress active state");

    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-old-competence-failure",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(20),
      competenceKey: "older-competence",
      currentPeriodStart: base,
      currentPeriodEnd: plusDays(8),
      correlationId: "old-competence-failure",
    });
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "active", "older competence must not regress active state");

    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-renewal-failed",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(38),
      competenceKey: "next-competence",
      currentPeriodStart: plusDays(38),
      currentPeriodEnd: plusDays(68),
      correlationId: "renewal-failed",
    });
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "past_due");
    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-old-competence-payment",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "renewal",
      occurredAt: plusDays(39),
      competenceKey: "first-paid-competence",
      currentPeriodStart: plusDays(8),
      currentPeriodEnd: plusDays(38),
      correlationId: "old-competence-payment",
    });
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "past_due", "older payment must not clear current delinquency");
    const winnerUserId = winner.snapshot.payerUserId;
    const graceAccess = await billingRepository.listAccessCandidates(
      winnerUserId,
      plusDays(40)
    );
    assert(
      graceAccess.some(candidate => candidate.reason === "active_subscription"),
      "past_due grace must preserve full subscription access"
    );

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(45));
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

    await service.tickSubscription(winner.snapshot.subscriptionId, plusDays(75));
    current = await lifecycleRepository.loadLifecycle(winner.snapshot.subscriptionId);
    assert.equal(current?.state, "expired");
    await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-late-payment",
      subscriptionId: winner.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "recovery",
      occurredAt: plusDays(76),
      competenceKey: "next-competence",
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
      verifiedPaymentInstrument: {
        payerUserId: users.professional,
        providerCode: provider,
        paymentMethod: "credit_card",
        registrationId: "registered-card-professional",
        verifiedAt: base,
      },
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
      plusDays(1)
    );
    assert.equal(professionalAccess?.capacityLimit, 5);
    assert.equal(professionalAccess?.status, "pending");

    const earlyUnconfirmed = await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-early-unconfirmed",
      subscriptionId: professionalTrial.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "early_conversion",
      occurredAt: plusDays(2),
      competenceKey: "professional-first-paid",
      currentPeriodStart: plusDays(2),
      currentPeriodEnd: plusDays(32),
      commercialConfirmationKey: "professional-early-confirmation",
      correlationId: "early-unconfirmed",
    });
    assert.equal(earlyUnconfirmed.state, "pending");
    await service.confirmEarlyConversion({
      subscriptionId: professionalTrial.snapshot.subscriptionId,
      actorUserId: users.professional,
      confirmationKey: "professional-early-confirmation",
      productCode: professional.productCode,
      versionCode: professional.versionCode,
      billingCycle: professional.billingCycle,
      currency: professional.currency,
      unitAmount: professional.unitAmount,
      capacityLimit: professional.capacityLimit,
      firstChargeAt: plusDays(2),
    });
    const earlyConfirmed = await service.applyFinancialFact({
      providerCode: provider,
      providerEventId: "lifecycle-early-confirmed",
      subscriptionId: professionalTrial.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "early_conversion",
      occurredAt: plusDays(2),
      competenceKey: "professional-first-paid",
      currentPeriodStart: plusDays(2),
      currentPeriodEnd: plusDays(32),
      commercialConfirmationKey: "professional-early-confirmation",
      correlationId: "early-confirmed",
    });
    assert.equal(earlyConfirmed.state, "active");
    const professionalPaid = await billingRepository.getActiveProfessionalSubscription(
      users.professional,
      plusDays(3)
    );
    assert.equal(professionalPaid?.capacityLimit, professional.capacityLimit);
    assert.equal(professionalPaid?.status, "active");

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
