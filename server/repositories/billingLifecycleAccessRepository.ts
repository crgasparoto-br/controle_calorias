import { sql } from "drizzle-orm";
import type {
  BillingEntitlementCandidate,
  BillingRepository,
  BillingSubscriptionSummary,
  ProfessionalBillingSubscription,
} from "../modules/billing/types";
import {
  dateOrNull,
  earliestDate,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingLifecycleAccessRepository(
  deps: BillingRepositoryDeps,
  baseline: Pick<
    BillingRepository,
    "listAccessCandidates" | "getOwnSubscription" | "getActiveProfessionalSubscription"
  >
) {
  async function listAccessCandidates(userId: number, now: Date) {
    const baselineCandidates = await baseline.listAccessCandidates(userId, now);
    // Lifecycle is authoritative for professional coverage after #893/#894.
    // Removing the baseline sponsored candidate prevents a suspended lifecycle
    // from leaking access merely because billingSubscriptions.status still says
    // active. Legacy subscriptions without a lifecycle row are re-evaluated
    // below with the same clinical/reservation invariants as canonical records.
    const candidates = baselineCandidates.filter(
      candidate => candidate.reason !== "sponsored_by_professional"
    );
    const db = await requireDb(deps.getDb);

    const graceRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id AS sourceId, p.code AS planCode, p.entitlementsJson,
          l.graceStartedAt AS validFrom, l.graceEndsAt AS validUntil
        FROM billingSubscriptionLifecycle l
        INNER JOIN billingSubscriptions s ON s.id = l.subscriptionId
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.payerUserId = ${userId}
          AND l.state = 'past_due'
          AND l.graceEndsAt > ${now}
        ORDER BY l.graceEndsAt DESC
      `)
    );
    for (const row of graceRows) {
      candidates.push({
        reason: "active_subscription",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: dateOrNull(row.validUntil),
        planCode: row.planCode ? String(row.planCode) : null,
        entitlements: stringArray(row.entitlementsJson),
      });
    }

    const sponsoredRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT e.sourceId, e.validFrom, e.validUntil AS entitlementValidUntil,
          e.sponsorUserId, p.code AS planCode, e.entitlementsJson,
          CASE
            WHEN l.state = 'active' THEN s.currentPeriodEnd
            WHEN l.state = 'past_due' THEN l.graceEndsAt
            WHEN l.state = 'pending' THEN l.trialEndsAt
            ELSE NULL
          END AS sponsorValidUntil
        FROM billingEntitlements e
        INNER JOIN billingCapacityAllocations c
          ON c.coverageKey = e.sourceId AND c.state IN ('reserved', 'active')
        INNER JOIN billingSubscriptions s ON s.id = c.subscriptionId
        INNER JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
        INNER JOIN billingPlans p ON p.id = s.planId
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = c.authorizationId AND a.status = 'approved'
        INNER JOIN professionalPatientTrackings t
          ON t.authorizationId = a.id AND t.status IN ('active', 'paused')
        WHERE e.beneficiaryUserId = ${userId}
          AND e.sourceType = 'professional_coverage'
          AND e.state = 'active'
          AND e.validFrom <= ${now}
          AND (e.validUntil IS NULL OR e.validUntil > ${now})
          AND (
            (l.state = 'active'
              AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now}))
            OR (l.state = 'past_due' AND l.graceEndsAt > ${now})
            OR (l.state = 'pending' AND l.trialEndsAt > ${now})
          )
        ORDER BY e.createdAt DESC
      `)
    );
    for (const row of sponsoredRows) {
      candidates.push({
        reason: "sponsored_by_professional",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: earliestDate(row.entitlementValidUntil, row.sponsorValidUntil),
        sponsorUserId: numberValue(row.sponsorUserId),
        planCode: row.planCode ? String(row.planCode) : null,
        entitlements: stringArray(row.entitlementsJson),
      });
    }

    // Compatibility for professional contracts created before the lifecycle
    // table existed. These rows may use the legacy active status only when no
    // lifecycle row exists at all; as soon as #893 owns the subscription, the
    // canonical query above is the sole authority. Clinical state, reservation,
    // entitlement validity and professional audience remain mandatory here.
    const legacySponsoredRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT e.sourceId, e.validFrom, e.validUntil AS entitlementValidUntil,
          e.sponsorUserId, p.code AS planCode, e.entitlementsJson,
          s.currentPeriodEnd AS sponsorValidUntil
        FROM billingEntitlements e
        INNER JOIN billingCapacityAllocations c
          ON c.coverageKey = e.sourceId AND c.state IN ('reserved', 'active')
        INNER JOIN billingSubscriptions s ON s.id = c.subscriptionId
        LEFT JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
        INNER JOIN billingPlans p ON p.id = s.planId AND p.audience = 'professional'
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = c.authorizationId AND a.status = 'approved'
        INNER JOIN professionalPatientTrackings t
          ON t.authorizationId = a.id AND t.status IN ('active', 'paused')
        WHERE e.beneficiaryUserId = ${userId}
          AND e.sourceType = 'professional_coverage'
          AND e.state = 'active'
          AND e.validFrom <= ${now}
          AND (e.validUntil IS NULL OR e.validUntil > ${now})
          AND l.subscriptionId IS NULL
          AND s.status = 'active'
          AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
          AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        ORDER BY e.createdAt DESC
      `)
    );
    for (const row of legacySponsoredRows) {
      candidates.push({
        reason: "sponsored_by_professional",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: earliestDate(row.entitlementValidUntil, row.sponsorValidUntil),
        sponsorUserId: numberValue(row.sponsorUserId),
        planCode: row.planCode ? String(row.planCode) : null,
        entitlements: stringArray(row.entitlementsJson),
      });
    }

    const seen = new Set<string>();
    return candidates.filter((candidate: BillingEntitlementCandidate) => {
      const key = `${candidate.reason}:${candidate.sourceId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  async function getOwnSubscription(userId: number, now: Date) {
    const subscription = await baseline.getOwnSubscription(userId, now);
    if (!subscription) return null;
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT state
        FROM billingSubscriptionLifecycle
        WHERE subscriptionId = ${subscription.id}
        LIMIT 1
      `)
    );
    if (!row) return subscription;
    return {
      ...subscription,
      status: row.state as BillingSubscriptionSummary["status"],
    };
  }

  async function getActiveProfessionalSubscription(
    professionalUserId: number,
    now: Date
  ): Promise<ProfessionalBillingSubscription | null> {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.provider, s.planId, l.state AS lifecycleState,
          s.currentPeriodStart, s.currentPeriodEnd, s.cancelAtPeriodEnd,
          p.code AS planCode, p.name AS planName, p.billingCycle, p.currency,
          p.unitAmount, p.entitlementsJson,
          CASE WHEN l.state = 'pending' THEN l.trialCapacityLimit ELSE p.capacityLimit END AS capacityLimit,
          CASE
            WHEN l.state = 'pending' THEN l.trialEndsAt
            WHEN l.state = 'past_due' THEN l.graceEndsAt
            ELSE s.currentPeriodEnd
          END AS accessValidUntil,
          (
            SELECT COUNT(*)
            FROM billingCapacityAllocations c
            WHERE c.subscriptionId = s.id AND c.state IN ('reserved', 'active')
          ) AS capacityUsed
        FROM billingSubscriptionLifecycle l
        INNER JOIN billingSubscriptions s ON s.id = l.subscriptionId
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.payerUserId = ${professionalUserId}
          AND p.audience = 'professional'
          AND (
            (l.state = 'active'
              AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
              AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now}))
            OR (l.state = 'pending' AND l.trialEndsAt > ${now})
            OR (l.state = 'past_due' AND l.graceEndsAt > ${now})
          )
        ORDER BY accessValidUntil DESC
        LIMIT 1
      `)
    );
    if (!row) {
      // Compatibility only for records predating the lifecycle table. New
      // commercial states must never bypass the lifecycle query above.
      return baseline.getActiveProfessionalSubscription(professionalUserId, now);
    }
    return {
      id: String(row.id),
      provider: String(row.provider),
      planId: String(row.planId),
      planCode: String(row.planCode),
      planName: String(row.planName),
      status: row.lifecycleState as ProfessionalBillingSubscription["status"],
      billingCycle:
        row.billingCycle as ProfessionalBillingSubscription["billingCycle"],
      currency: String(row.currency),
      unitAmount: numberValue(row.unitAmount),
      currentPeriodStart: dateOrNull(row.currentPeriodStart),
      currentPeriodEnd: dateOrNull(row.accessValidUntil),
      cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
      capacityLimit:
        row.capacityLimit == null ? null : numberValue(row.capacityLimit),
      capacityUsed: numberValue(row.capacityUsed),
      entitlements: stringArray(row.entitlementsJson),
    };
  }

  return {
    listAccessCandidates,
    getOwnSubscription,
    getActiveProfessionalSubscription,
  };
}
