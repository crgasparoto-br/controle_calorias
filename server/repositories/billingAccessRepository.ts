import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { sanitizeBillingProviderEventMetadata } from "../modules/billing/providerEvents";
import type {
  BillingEntitlementCandidate,
  BillingSubscriptionSummary,
  ProfessionalBillingSubscription,
  RecordBillingProviderEventInput,
  RecordBillingProviderEventResult,
} from "../modules/billing/types";
import {
  dateOrNull,
  earliestDate,
  isDuplicateEntryError,
  mapSubscription,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingAccessRepository(deps: BillingRepositoryDeps) {
  async function recordProviderEvent(
    input: RecordBillingProviderEventInput
  ): Promise<RecordBillingProviderEventResult> {
    const db = await requireDb(deps.getDb);
    const eventId = crypto.randomUUID();
    const metadata = sanitizeBillingProviderEventMetadata(input.metadata);
    try {
      await db.execute(sql`
        INSERT INTO billingProviderEvents (
          id, provider, providerEventId, eventType, status, subscriptionId,
          occurredAt, payloadJson, createdAt, updatedAt
        ) VALUES (
          ${eventId}, ${input.provider}, ${input.providerEventId},
          ${input.eventType}, 'received', ${input.subscriptionId ?? null},
          ${input.occurredAt ?? null},
          ${metadata ? JSON.stringify(metadata) : null}, NOW(), NOW()
        )
      `);
      return { id: eventId, created: true };
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const [existing] = resultRows<Record<string, unknown>>(
        await db.execute(sql`
          SELECT id FROM billingProviderEvents
          WHERE provider = ${input.provider}
            AND providerEventId = ${input.providerEventId}
          LIMIT 1
        `)
      );
      if (!existing) throw error;
      return { id: String(existing.id), created: false };
    }
  }
  async function listAccessCandidates(userId: number, now: Date) {
    const db = await requireDb(deps.getDb);
    const candidates: BillingEntitlementCandidate[] = [];

    const ownRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id AS sourceId, p.code AS planCode, p.entitlementsJson,
          s.currentPeriodStart AS validFrom, s.currentPeriodEnd AS validUntil
        FROM billingSubscriptions s
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.payerUserId = ${userId}
          AND s.status = 'active'
          AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
          AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        ORDER BY s.currentPeriodEnd DESC, s.createdAt DESC
      `)
    );
    for (const row of ownRows) {
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
          s.currentPeriodEnd AS subscriptionValidUntil
        FROM billingEntitlements e
        INNER JOIN billingCapacityAllocations c
          ON c.coverageKey = e.sourceId AND c.state IN ('reserved', 'active')
        INNER JOIN billingSubscriptions s
          ON s.id = c.subscriptionId AND s.status = 'active'
        INNER JOIN billingPlans p ON p.id = s.planId
        INNER JOIN professionalPatientAuthorizations a
          ON a.id = c.authorizationId AND a.status = 'approved'
        WHERE e.beneficiaryUserId = ${userId}
          AND e.sourceType = 'professional_coverage'
          AND e.state = 'active'
          AND e.validFrom <= ${now}
          AND (e.validUntil IS NULL OR e.validUntil > ${now})
          AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        ORDER BY e.createdAt DESC
      `)
    );
    for (const row of sponsoredRows) {
      candidates.push({
        reason: "sponsored_by_professional",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: earliestDate(
          row.entitlementValidUntil,
          row.subscriptionValidUntil
        ),
        sponsorUserId: numberValue(row.sponsorUserId),
        planCode: row.planCode ? String(row.planCode) : null,
        entitlements: stringArray(row.entitlementsJson),
      });
    }

    const standaloneRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT e.sourceId, e.sourceType, e.validFrom, e.validUntil,
          e.sponsorUserId, p.code AS planCode, e.entitlementsJson
        FROM billingEntitlements e
        LEFT JOIN billingPlans p ON p.id = e.planId
        WHERE e.beneficiaryUserId = ${userId}
          AND e.sourceType IN ('trial', 'free_access')
          AND e.state = 'active'
          AND e.validFrom <= ${now}
          AND (e.validUntil IS NULL OR e.validUntil > ${now})
        ORDER BY e.createdAt DESC
      `)
    );
    for (const row of standaloneRows) {
      candidates.push({
        reason: row.sourceType === "trial" ? "active_trial" : "free_access",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: dateOrNull(row.validUntil),
        sponsorUserId:
          row.sponsorUserId === null || row.sponsorUserId === undefined
            ? null
            : numberValue(row.sponsorUserId),
        planCode: row.planCode ? String(row.planCode) : null,
        entitlements: stringArray(row.entitlementsJson),
      });
    }

    const overrideRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id AS sourceId, startsAt AS validFrom, endsAt AS validUntil
        FROM billingAdminOverrides
        WHERE userId = ${userId}
          AND state = 'active'
          AND accessWithoutSubscription = true
          AND startsAt <= ${now}
          AND (endsAt IS NULL OR endsAt > ${now})
        ORDER BY createdAt DESC
      `)
    );
    for (const row of overrideRows) {
      candidates.push({
        reason: "admin_override",
        sourceId: String(row.sourceId),
        validFrom: dateOrNull(row.validFrom),
        validUntil: dateOrNull(row.validUntil),
        entitlements: ["system_access"],
      });
    }

    return candidates;
  }

  async function getOwnSubscription(userId: number, now: Date) {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.provider, s.status, s.currentPeriodStart,
          s.currentPeriodEnd, s.cancelAtPeriodEnd, p.code AS planCode,
          p.name AS planName, p.billingCycle, p.currency, p.unitAmount
        FROM billingSubscriptions s
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.payerUserId = ${userId}
        ORDER BY
          CASE s.status
            WHEN 'active' THEN 1
            WHEN 'past_due' THEN 2
            WHEN 'pending' THEN 3
            WHEN 'canceled' THEN 4
            ELSE 5
          END,
          (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now}) DESC,
          s.updatedAt DESC
        LIMIT 1
      `)
    );
    return row ? mapSubscription(row) : null;
  }

  async function getActiveProfessionalSubscription(
    professionalUserId: number,
    now: Date
  ): Promise<ProfessionalBillingSubscription | null> {
    const db = await requireDb(deps.getDb);
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id, s.provider, s.planId, s.status, s.currentPeriodStart,
          s.currentPeriodEnd, s.cancelAtPeriodEnd, p.code AS planCode,
          p.name AS planName, p.billingCycle, p.currency, p.unitAmount,
          p.capacityLimit, p.entitlementsJson,
          (
            SELECT COUNT(*)
            FROM billingCapacityAllocations c
            WHERE c.subscriptionId = s.id AND c.state IN ('reserved', 'active')
          ) AS capacityUsed
        FROM billingSubscriptions s
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.payerUserId = ${professionalUserId}
          AND p.audience = 'professional'
          AND s.status = 'active'
          AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
          AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        ORDER BY s.currentPeriodEnd DESC, s.createdAt DESC
        LIMIT 1
      `)
    );
    if (!row) return null;
    return {
      ...mapSubscription(row),
      planId: String(row.planId),
      capacityLimit:
        row.capacityLimit === null || row.capacityLimit === undefined
          ? null
          : numberValue(row.capacityLimit),
      capacityUsed: numberValue(row.capacityUsed),
      entitlements: stringArray(row.entitlementsJson),
    };
  }

  return {
    recordProviderEvent,
    listAccessCandidates,
    getOwnSubscription,
    getActiveProfessionalSubscription,
  };
}
