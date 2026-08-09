import "dotenv/config";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import {
  BILLING_PERSONAL_ENTITLEMENTS,
  BILLING_PROFESSIONAL_ENTITLEMENTS,
  INITIAL_BILLING_CATALOG,
} from "../server/modules/billing/catalogPolicy";
import { createBillingCatalogRepository } from "../server/repositories/billingCatalogRepository";
import { createDrizzleBillingRepository } from "../server/repositories/billingRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the billing integration test.");
}

const ids = {
  professional: 9181,
  patientA: 9182,
  patientB: 9183,
  admin: 9184,
  couponUserA: 9185,
  couponUserB: 9186,
  product: "billing-test-professional-product",
  plan: "billing-test-professional-plan",
  subscription: "billing-test-subscription",
  futureSubscription: "billing-test-future-subscription",
  staleEntitlement: "billing-test-stale-entitlement",
  authorizationA: "billing-test-authorization-a",
  authorizationB: "billing-test-authorization-b",
  providerEvent: "billing-test-provider-event",
  couponCode: "BILLINGTESTLIMIT1",
  authDeniedProductCode: "billing-test-admin-auth-denied",
  authLockedProductCode: "billing-test-admin-auth-locked",
};

function coverageKey(authorizationId: string) {
  return `professional-authorization:${authorizationId}`;
}

async function main() {
  const pool = mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 8,
    ...(process.env.TIDB_ENABLE_SSL === "true"
      ? { ssl: { minVersion: "TLSv1.2" as const } }
      : {}),
  });
  const db = drizzle(pool);
  const warnings: Array<{ scope: string; error: string }> = [];
  const repositoryDeps = {
    getDb: async () => db,
    onWarning: (scope: string, error: unknown) =>
      warnings.push({
        scope,
        error: error instanceof Error ? error.message : "unknown",
      }),
  };
  const repository = createDrizzleBillingRepository(repositoryDeps);
  const catalogRepository = createBillingCatalogRepository(repositoryDeps);
  const userIds = [
    ids.professional,
    ids.patientA,
    ids.patientB,
    ids.admin,
    ids.couponUserA,
    ids.couponUserB,
  ];

  async function cleanup() {
    await pool.query(
      `DELETE FROM billingAccessAuditEvents WHERE subjectUserId IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
    await pool.query(
      `DELETE FROM billingAdminOverrides WHERE userId IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
    await pool.query("DELETE FROM billingProviderEvents WHERE provider = ?", [
      "integration-test",
    ]);
    await pool.query(
      "DELETE FROM billingCouponRedemptions WHERE userId IN (?, ?)",
      [ids.couponUserA, ids.couponUserB]
    );
    await pool.query("DELETE FROM billingCoupons WHERE code = ?", [ids.couponCode]);
    await pool.query(
      "DELETE FROM billingCommercialAuditEvents WHERE actorUserId = ? OR entityId IN (?, ?)",
      [ids.admin, ids.product, ids.plan]
    );
    await pool.query(
      "DELETE FROM billingEntitlements WHERE sourceId IN (?, ?)",
      [coverageKey(ids.authorizationA), coverageKey(ids.authorizationB)]
    );
    await pool.query(
      "DELETE FROM billingCapacityAllocations WHERE coverageKey IN (?, ?)",
      [coverageKey(ids.authorizationA), coverageKey(ids.authorizationB)]
    );
    await pool.query("DELETE FROM billingSubscriptions WHERE id IN (?, ?)", [
      ids.subscription,
      ids.futureSubscription,
    ]);
    await pool.query("DELETE FROM billingPlans WHERE productId = ?", [ids.product]);
    await pool.query("DELETE FROM billingProducts WHERE id = ?", [ids.product]);
    await pool.query(
      "DELETE FROM billingProducts WHERE code IN (?, ?)",
      [ids.authDeniedProductCode, ids.authLockedProductCode]
    );
    await pool.query(
      "DELETE FROM professionalPatientAuthorizations WHERE id IN (?, ?)",
      [ids.authorizationA, ids.authorizationB]
    );
    await pool.query(
      `DELETE FROM users WHERE id IN (${userIds.map(() => "?").join(",")})`,
      userIds
    );
  }

  try {
    await cleanup();
    for (const userId of userIds) {
      await pool.query(
        "INSERT INTO users (id, openId, name, email, role) VALUES (?, ?, ?, ?, ?)",
        [
          userId,
          `billing-integration-${userId}`,
          `Billing User ${userId}`,
          `billing-integration-${userId}@example.com`,
          userId === ids.admin ? "admin" : "user",
        ]
      );
    }

    const firstSeed = await catalogRepository.seedInitialCatalog(
      INITIAL_BILLING_CATALOG
    );
    const secondSeed = await catalogRepository.seedInitialCatalog(
      INITIAL_BILLING_CATALOG
    );
    assert.deepEqual(
      secondSeed,
      { products: 0, versions: 0 },
      "billing catalog seed must be idempotent"
    );
    assert.equal(
      (await catalogRepository.listEffectiveVersions(new Date())).filter(
        version => INITIAL_BILLING_CATALOG.some(
          expected => expected.versionCode === version.versionCode
        )
      ).length,
      6,
      "all initial commercial versions must be served by the backend"
    );
    assert.equal(
      firstSeed.products >= 0 && firstSeed.versions >= 0,
      true,
      "first seed may insert missing rows or validate migration-seeded rows"
    );

    await pool.query("UPDATE users SET role = 'user' WHERE id = ?", [ids.admin]);
    await assert.rejects(
      catalogRepository.createProduct({
        code: ids.authDeniedProductCode,
        audience: "individual",
        name: "Admin authorization denied",
        description: null,
        actorUserId: ids.admin,
        reason: "TOCTOU pre-lock negative control",
        provenance: { origin: "admin_manual" },
      }),
      /Administrator authorization changed before catalog mutation/,
      "catalog writes must revalidate admin authority inside the transaction"
    );
    const [deniedProductRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingProducts WHERE code = ?",
      [ids.authDeniedProductCode]
    );
    assert.equal(Number(deniedProductRows[0]?.total), 0);
    await pool.query("UPDATE users SET role = 'admin' WHERE id = ?", [ids.admin]);

    let observeAdminLock!: () => void;
    let releaseAdminLock!: () => void;
    const adminLockObserved = new Promise<void>(resolve => {
      observeAdminLock = resolve;
    });
    const adminLockRelease = new Promise<void>(resolve => {
      releaseAdminLock = resolve;
    });
    const guardedCatalogRepository = createBillingCatalogRepository({
      ...repositoryDeps,
      onAdminAuthorizationLocked: async actorUserId => {
        assert.equal(actorUserId, ids.admin);
        observeAdminLock();
        await adminLockRelease;
      },
    });
    const lockedCreate = guardedCatalogRepository.createProduct({
      code: ids.authLockedProductCode,
      audience: "individual",
      name: "Admin authorization locked",
      description: null,
      actorUserId: ids.admin,
      reason: "TOCTOU row-lock control",
      provenance: { origin: "admin_manual" },
    });
    await adminLockObserved;
    let downgradeFinished = false;
    const concurrentDowngrade = pool
      .query("UPDATE users SET role = 'user' WHERE id = ?", [ids.admin])
      .then(() => {
        downgradeFinished = true;
      });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(
      downgradeFinished,
      false,
      "admin role mutation must wait while the catalog transaction owns the authority row lock"
    );
    releaseAdminLock();
    const lockedProduct = await lockedCreate;
    await concurrentDowngrade;
    assert.equal(lockedProduct.code, ids.authLockedProductCode);
    const [downgradedAdminRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT role FROM users WHERE id = ?",
      [ids.admin]
    );
    assert.equal(downgradedAdminRows[0]?.role, "user");
    await pool.query("UPDATE users SET role = 'admin' WHERE id = ?", [ids.admin]);

    const createdCoupon = await catalogRepository.createCouponRevision({
      policy: {
        code: ids.couponCode,
        discountType: "percentage",
        discountValue: 10,
        currency: null,
        eligibleProductCodes: ["individual"],
        eligibleVersionCodes: ["individual-monthly-v1"],
        eligibleCycles: ["monthly"],
        validFrom: new Date("2026-08-08T00:00:00.000Z"),
        validUntil: null,
        maxTotalUses: 1,
        maxUsesPerUser: 1,
        firstContractOnly: false,
        durationCharges: 1,
        active: true,
      },
      actorUserId: ids.admin,
      reason: "Billing integration concurrency",
    });
    assert.equal(createdCoupon.code, ids.couponCode);
    const couponCompetition = await Promise.all([
      catalogRepository.reserveCoupon({
        userId: ids.couponUserA,
        couponCode: ids.couponCode,
        versionCode: "individual-monthly-v1",
        contractKey: "billing-test-coupon-contract-a",
        now: new Date(),
      }),
      catalogRepository.reserveCoupon({
        userId: ids.couponUserB,
        couponCode: ids.couponCode,
        versionCode: "individual-monthly-v1",
        contractKey: "billing-test-coupon-contract-b",
        now: new Date(),
      }),
    ]);
    assert.equal(
      couponCompetition.filter(result => result.reserved).length,
      1,
      "coupon maxTotalUses must remain transactional under concurrency"
    );
    const couponWinner = couponCompetition.find(result => result.reserved);
    const couponLoser = couponCompetition.find(result => !result.reserved);
    assert.ok(couponWinner && couponWinner.reserved);
    assert.deepEqual(couponLoser, {
      reserved: false,
      eligibility: { eligible: false, reason: "total_limit_reached" },
    });
    if (!couponWinner || !couponWinner.reserved) throw new Error("unreachable");
    const couponRetry = await catalogRepository.reserveCoupon({
      userId: couponWinner.reservation.userId,
      couponCode: ids.couponCode,
      versionCode: "individual-monthly-v1",
      contractKey: couponWinner.reservation.contractKey,
      now: new Date(),
    });
    assert.equal(couponRetry.reserved, true);
    if (!couponRetry.reserved) throw new Error("unreachable");
    assert.equal(couponRetry.reservation.id, couponWinner.reservation.id);
    assert.equal(couponRetry.reservation.created, false);

    const revisedCoupon = await catalogRepository.createCouponRevision({
      policy: {
        code: ids.couponCode,
        discountType: "percentage",
        discountValue: 15,
        currency: null,
        eligibleProductCodes: ["individual"],
        eligibleVersionCodes: ["individual-monthly-v1"],
        eligibleCycles: ["monthly"],
        validFrom: new Date("2026-08-08T00:00:00.000Z"),
        validUntil: null,
        maxTotalUses: 2,
        maxUsesPerUser: 1,
        firstContractOnly: false,
        durationCharges: 1,
        active: true,
      },
      actorUserId: ids.admin,
      reason: "Billing integration coupon revision",
    });
    assert.equal(revisedCoupon.revision, 2);
    const retryAfterRevision = await catalogRepository.reserveCoupon({
      userId: couponWinner.reservation.userId,
      couponCode: ids.couponCode,
      versionCode: "individual-monthly-v1",
      contractKey: couponWinner.reservation.contractKey,
      now: new Date(),
    });
    assert.equal(retryAfterRevision.reserved, true);
    if (!retryAfterRevision.reserved) throw new Error("unreachable");
    assert.equal(retryAfterRevision.reservation.id, couponWinner.reservation.id);
    assert.equal(retryAfterRevision.reservation.couponId, createdCoupon.id);
    assert.equal(retryAfterRevision.reservation.created, false);

    await catalogRepository.deactivateVersion({
      versionCode: "individual-monthly-v1",
      effectiveUntil: new Date("2026-08-09T00:00:00.000Z"),
      actorUserId: ids.admin,
      reason: "Seed must preserve legitimate operational state",
    });
    assert.deepEqual(
      await catalogRepository.seedInitialCatalog(INITIAL_BILLING_CATALOG),
      { products: 0, versions: 0 },
      "re-running the seed after a legitimate deactivation must not restore or reject operational state"
    );
    const deactivatedCanonicalVersion = await catalogRepository.getVersionByCode(
      "individual-monthly-v1"
    );
    assert.equal(
      deactivatedCanonicalVersion?.status,
      "inactive",
      "seed re-execution must not reactivate a commercial version"
    );

    const baselineWithoutAccess = (
      await repository.getAdminAnalytics(new Date())
    ).usersWithoutCommercialAccess;
    const now = new Date();
    for (const [authorizationId, patientUserId] of [
      [ids.authorizationA, ids.patientA],
      [ids.authorizationB, ids.patientB],
    ] as const) {
      await pool.query(
        `INSERT INTO professionalPatientAuthorizations (
          id, professionalUserId, patientUserId, status, activePairKey,
          reason, requestedAt, approvedAt, respondedAt, responseOrigin,
          responseDecision, sourceUpdatedAt, createdAt, updatedAt
        ) VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, 'web', 'approved', ?, ?, ?)`,
        [
          authorizationId,
          ids.professional,
          patientUserId,
          `${ids.professional}:${patientUserId}`,
          "Billing integration coverage",
          now,
          now,
          now,
          now,
          now,
          now,
        ]
      );
    }

    await pool.query(
      `INSERT INTO billingProducts (
        id, code, audience, name, state, createdAt, updatedAt
      ) VALUES (?, ?, 'professional', ?, 'active', NOW(), NOW())`,
      [
        ids.product,
        "billing-integration-professional",
        "Billing integration professional",
      ]
    );
    await pool.query(
      `INSERT INTO billingPlans (
        id, productId, code, versionCode, version, audience, name, currency,
        unitAmount, billingCycle, capacityLimit, entitlementsJson,
        coveredBeneficiaryEntitlementsJson, commercialPaymentMethodsJson,
        status, active, effectiveFrom, sortOrder,
        createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, 1, 'professional', ?, 'BRL', 19900, 'monthly', 1, ?, ?, ?,
        'active', true, DATE_SUB(NOW(), INTERVAL 1 DAY), 900, NOW(), NOW())`,
      [
        ids.plan,
        ids.product,
        "billing-integration-professional",
        "billing-integration-professional-monthly-v1",
        "Billing integration professional",
        JSON.stringify(["professional_portfolio", "system_access"]),
        JSON.stringify(INITIAL_BILLING_CATALOG[0].entitlements),
        JSON.stringify(["credit_card", "pix_automatic"]),
      ]
    );
    await pool.query(
      `INSERT INTO billingSubscriptions (
        id, provider, payerUserId, planId, externalSubscriptionId, status,
        activeHolderPlanKey, currentPeriodStart, currentPeriodEnd,
        createdAt, updatedAt
      ) VALUES (?, 'manual', ?, ?, ?, 'active', ?, DATE_SUB(NOW(), INTERVAL 1 DAY),
        DATE_ADD(NOW(), INTERVAL 30 DAY), NOW(), NOW())`,
      [
        ids.subscription,
        ids.professional,
        ids.plan,
        "billing-integration-subscription-external",
        `${ids.professional}:${ids.plan}`,
      ]
    );
    const versionV2 = await catalogRepository.createVersion({
      productCode: "billing-integration-professional",
      name: "Billing integration professional",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 20900,
      capacityLimit: 2,
      entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
      coveredBeneficiaryEntitlements: INITIAL_BILLING_CATALOG[0].entitlements,
      commercialPaymentMethods: ["credit_card", "pix_automatic"],
      effectiveFrom: new Date(),
      effectiveUntil: null,
      sortOrder: 901,
      actorUserId: ids.admin,
      reason: "Versioning integration",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["billing-test-range-alert-1"],
        analysisRef: "billing-test-demand-analysis-1",
      },
    });
    assert.equal(versionV2.version, 2);
    await catalogRepository.publishVersion({
      versionCode: versionV2.versionCode,
      effectiveFrom: new Date(),
      actorUserId: ids.admin,
      reason: "Publish integration v2",
      provenance: {
        origin: "catalog_range_review",
        alertIds: ["billing-test-range-alert-1"],
        analysisRef: "billing-test-demand-analysis-1",
      },
    });
    const [rangeReviewAuditRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT action, metadataJson
       FROM billingCommercialAuditEvents
       WHERE entityId = ? AND action IN ('version_created', 'version_published')
       ORDER BY createdAt ASC`,
      [versionV2.id]
    );
    assert.equal(rangeReviewAuditRows.length, 2);
    for (const auditRow of rangeReviewAuditRows) {
      const metadata = jsonValue(auditRow.metadataJson) as {
        provenance?: {
          origin?: string;
          alertIds?: string[];
          analysisRef?: string;
        };
      };
      assert.deepEqual(metadata.provenance, {
        origin: "catalog_range_review",
        alertIds: ["billing-test-range-alert-1"],
        analysisRef: "billing-test-demand-analysis-1",
      });
    }
    const [versioningRows] = await pool.query<mysql.RowDataPacket[]>(
      `SELECT s.planId, oldPlan.status AS oldStatus,
         oldPlan.effectiveUntil AS oldEffectiveUntil,
         newPlan.status AS newStatus
       FROM billingSubscriptions s
       INNER JOIN billingPlans oldPlan ON oldPlan.id = s.planId
       INNER JOIN billingPlans newPlan ON newPlan.id = ?
       WHERE s.id = ?`,
      [versionV2.id, ids.subscription]
    );
    assert.equal(versioningRows[0]?.planId, ids.plan);
    assert.equal(
      versioningRows[0]?.oldStatus,
      "active",
      "a published historical version remains immutable while its sales window closes"
    );
    assert.ok(
      versioningRows[0]?.oldEffectiveUntil,
      "publishing a new version must close the prior version sales window"
    );
    assert.equal(versioningRows[0]?.newStatus, "active");

    const versionV3 = await catalogRepository.createVersion({
      productCode: "billing-integration-professional",
      name: "Billing integration professional",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 21900,
      capacityLimit: 3,
      entitlements: BILLING_PROFESSIONAL_ENTITLEMENTS,
      coveredBeneficiaryEntitlements: INITIAL_BILLING_CATALOG[0].entitlements,
      commercialPaymentMethods: ["credit_card", "pix_automatic"],
      effectiveFrom: new Date(),
      effectiveUntil: null,
      sortOrder: 902,
      actorUserId: ids.admin,
      reason: "Version ordering integration",
      provenance: { origin: "admin_manual" },
    });
    await assert.rejects(
      catalogRepository.publishVersion({
        versionCode: versionV3.versionCode,
        effectiveFrom: new Date("2026-08-08T00:00:00.000Z"),
        actorUserId: ids.admin,
        reason: "Out-of-order publication negative control",
        provenance: { origin: "admin_manual" },
      }),
      /Catalog publication must advance the commercial effective date/,
      "publishing out of chronological order must not create overlapping or inverted sales windows"
    );

    assert.equal(
      (await repository.getAdminAnalytics(new Date()))
        .usersWithoutCommercialAccess,
      baselineWithoutAccess - 1,
      "a current active subscription must reduce users without commercial access"
    );

    const competing = await Promise.all([
      repository.reserveProfessionalCapacity({
        professionalUserId: ids.professional,
        patientUserId: ids.patientA,
        coverageKey: coverageKey(ids.authorizationA),
      }),
      repository.reserveProfessionalCapacity({
        professionalUserId: ids.professional,
        patientUserId: ids.patientB,
        coverageKey: coverageKey(ids.authorizationB),
      }),
    ]);
    const winnerIndex = competing.findIndex(result => result.reserved);
    const loserIndex = competing.findIndex(result => !result.reserved);
    assert.notEqual(winnerIndex, -1, "one patient must reserve the last slot");
    assert.notEqual(loserIndex, -1, "one patient must be rejected at capacity");
    assert.deepEqual(competing[loserIndex], {
      reserved: false,
      reason: "capacity_exceeded",
    });

    const winnerAuthorization =
      winnerIndex === 0 ? ids.authorizationA : ids.authorizationB;
    const winnerPatient = winnerIndex === 0 ? ids.patientA : ids.patientB;
    const winnerKey = coverageKey(winnerAuthorization);
    const firstReservation = competing[winnerIndex];
    assert.equal(firstReservation.reserved, true);
    if (!firstReservation.reserved) throw new Error("unreachable");

    const retry = await repository.reserveProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
    });
    assert.deepEqual(
      retry,
      firstReservation,
      "reservation retry must be idempotent"
    );

    const [allocationRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM billingCapacityAllocations WHERE subscriptionId = ? AND state IN ('reserved', 'active')",
      [ids.subscription]
    );
    assert.equal(Number(allocationRows[0]?.total), 1);
    assert.equal(
      (await repository.getAdminAnalytics(new Date()))
        .usersWithoutCommercialAccess,
      baselineWithoutAccess - 2,
      "valid professional coverage must use the canonical sponsored eligibility"
    );

    const candidates = await repository.listAccessCandidates(
      winnerPatient,
      new Date()
    );
    assert.equal(
      candidates.some(
        candidate => candidate.reason === "sponsored_by_professional"
      ),
      true,
      "approved coverage must grant a sponsored entitlement"
    );
    const sponsoredCandidate = candidates.find(
      candidate => candidate.reason === "sponsored_by_professional"
    );
    assert.deepEqual(
      [...(sponsoredCandidate?.entitlements ?? [])].sort(),
      [...BILLING_PERSONAL_ENTITLEMENTS].sort(),
      "covered patients must receive the versioned personal matrix, not the professional payer matrix"
    );
    assert.equal(
      sponsoredCandidate?.entitlements.includes("professional_portfolio"),
      false,
      "covered patients must never inherit professional workspace entitlements"
    );

    await repository.releaseProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
      reservationId: firstReservation.reservationId,
      reason: "integration_release",
    });
    await repository.releaseProfessionalCapacity({
      professionalUserId: ids.professional,
      patientUserId: winnerPatient,
      coverageKey: winnerKey,
      reservationId: firstReservation.reservationId,
      reason: "integration_release_retry",
    });
    const [releasedRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT state FROM billingCapacityAllocations WHERE coverageKey = ?",
      [winnerKey]
    );
    assert.equal(releasedRows[0]?.state, "released");
    assert.equal(
      (await repository.listAccessCandidates(winnerPatient, new Date())).some(
        candidate => candidate.reason === "sponsored_by_professional"
      ),
      false
    );
    assert.equal(
      (await repository.getAdminAnalytics(new Date()))
        .usersWithoutCommercialAccess,
      baselineWithoutAccess - 1,
      "released coverage must no longer count as commercial access"
    );

    await pool.query(
      `INSERT INTO billingSubscriptions (
        id, provider, payerUserId, planId, externalSubscriptionId, status,
        activeHolderPlanKey, currentPeriodStart, currentPeriodEnd,
        createdAt, updatedAt
      ) VALUES (?, 'manual', ?, ?, ?, 'active', NULL,
        DATE_ADD(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY),
        NOW(), NOW())`,
      [
        ids.futureSubscription,
        ids.patientB,
        ids.plan,
        "billing-integration-future-subscription-external",
      ]
    );
    await pool.query(
      `INSERT INTO billingEntitlements (
        id, beneficiaryUserId, sourceType, sourceId, sponsorUserId, planId,
        professionalAuthorizationId, state, activeGrantKey,
        entitlementsJson, validFrom, validUntil, createdAt, updatedAt
      ) VALUES (?, ?, 'professional_coverage', ?, ?, ?, ?, 'active', ?, ?,
        DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 30 DAY),
        NOW(), NOW())`,
      [
        ids.staleEntitlement,
        ids.patientB,
        coverageKey(ids.authorizationB),
        ids.professional,
        ids.plan,
        ids.authorizationB,
        `professional_coverage:stale:${ids.authorizationB}`,
        JSON.stringify(["system_access"]),
      ]
    );
    assert.equal(
      (await repository.listAccessCandidates(ids.patientB, new Date())).length,
      0,
      "future subscriptions and orphan sponsored grants must not create access"
    );
    const analyticsWithInvalidSources = await repository.getAdminAnalytics(
      new Date()
    );
    assert.equal(
      analyticsWithInvalidSources.usersWithoutCommercialAccess,
      baselineWithoutAccess - 1,
      "analytics must ignore the same future and orphan sources as eligibility"
    );
    assert.deepEqual(
      analyticsWithInvalidSources.estimatedMonthlyRecurringRevenue,
      [{ currency: "BRL", amountMinor: 19900, estimated: true }],
      "future subscriptions must not inflate recurring revenue"
    );

    const firstOverride = await repository.grantAdminOverride({
      userId: ids.patientA,
      reason: "Primeira liberação de integração",
      grantedByUserId: ids.admin,
    });
    const secondOverride = await repository.grantAdminOverride({
      userId: ids.patientA,
      reason: "Liberação substituta de integração",
      grantedByUserId: ids.admin,
    });
    assert.notEqual(firstOverride.id, secondOverride.id);
    const [overrideRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT state, COUNT(*) AS total FROM billingAdminOverrides WHERE userId = ? GROUP BY state",
      [ids.patientA]
    );
    assert.equal(
      overrideRows.reduce((sum, row) => sum + Number(row.total), 0),
      2,
      "replacement must preserve override history"
    );
    assert.equal(overrideRows.find(row => row.state === "active")?.total, 1);
    const activeOverride = await repository.getActiveAdminOverride(
      ids.patientA,
      new Date()
    );
    assert.equal(activeOverride?.id, secondOverride.id);
    const overrideHistory = await repository.listAdminOverrides(
      ids.patientA,
      25,
      new Date()
    );
    assert.deepEqual(
      overrideHistory.map(item => item.id),
      [secondOverride.id, firstOverride.id],
      "override history must remain discoverable after the grant response is gone"
    );
    assert.equal(
      (await repository.getAdminAnalytics(new Date()))
        .usersWithoutCommercialAccess,
      baselineWithoutAccess - 2,
      "an active override must count as commercial access"
    );
    if (!activeOverride)
      throw new Error("active override must be discoverable");
    await repository.revokeAdminOverride({
      overrideId: activeOverride.id,
      revokedByUserId: ids.admin,
      reason: "Integração encerrada",
    });
    await repository.revokeAdminOverride({
      overrideId: activeOverride.id,
      revokedByUserId: ids.admin,
      reason: "Repetição idempotente",
    });
    assert.equal(
      await repository.getActiveAdminOverride(ids.patientA, new Date()),
      null
    );
    assert.equal(
      (await repository.getAdminAnalytics(new Date()))
        .usersWithoutCommercialAccess,
      baselineWithoutAccess - 1,
      "revoked overrides must immediately leave commercial access analytics"
    );

    const recorded = await repository.recordProviderEvent({
      provider: "integration-test",
      providerEventId: ids.providerEvent,
      eventType: "subscription.updated",
      metadata: {
        objectId: "subscription-external",
        status: "active",
        token: "must-not-be-persisted",
        cardNumber: "4111111111111111",
      },
    });
    const duplicate = await repository.recordProviderEvent({
      provider: "integration-test",
      providerEventId: ids.providerEvent,
      eventType: "subscription.updated",
      metadata: { status: "past_due", token: "another-secret" },
    });
    assert.equal(recorded.created, true);
    assert.deepEqual(duplicate, { id: recorded.id, created: false });
    const [eventRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT payloadJson FROM billingProviderEvents WHERE provider = ? AND providerEventId = ?",
      ["integration-test", ids.providerEvent]
    );
    assert.equal(eventRows.length, 1);
    const payload = JSON.stringify(eventRows[0]?.payloadJson ?? "");
    assert.equal(payload.includes("token"), false);
    assert.equal(payload.includes("411111"), false);

    const [auditRows] = await pool.query<mysql.RowDataPacket[]>(
      "SELECT action, COUNT(*) AS total FROM billingAccessAuditEvents WHERE subjectUserId IN (?, ?) GROUP BY action",
      [ids.patientA, ids.patientB]
    );
    const auditTotals = Object.fromEntries(
      auditRows.map(row => [String(row.action), Number(row.total)])
    );
    assert.equal(auditTotals.capacity_reserved, 1);
    assert.equal(auditTotals.capacity_released, 1);
    assert.equal(auditTotals.override_granted, 2);
    assert.equal(auditTotals.override_revoked, 2);
    assert.deepEqual(warnings, []);

    console.log(
      JSON.stringify({
        event: "billing.persistence.integration.passed",
        concurrentReservations: competing,
        providerEventIdempotent: true,
        durableOverrideLookup: true,
        canonicalAdminAnalytics: true,
        auditTotals,
      })
    );
  } finally {
    await cleanup();
    await pool.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
