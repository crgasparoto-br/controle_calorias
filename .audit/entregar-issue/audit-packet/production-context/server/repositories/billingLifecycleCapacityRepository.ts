import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  BillingRepository,
  ReserveBillingCapacityInput,
  ReserveBillingCapacityResult,
} from "../modules/billing/types";
import {
  authorizationIdFromCoverageKey,
  dateOrNull,
  insertAuditEvent,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingLifecycleCapacityRepository(
  deps: BillingRepositoryDeps,
  baseline: Pick<BillingRepository, "reserveProfessionalCapacity">
) {
  async function reserveProfessionalCapacity(
    input: ReserveBillingCapacityInput
  ): Promise<ReserveBillingCapacityResult> {
    const db = await requireDb(deps.getDb);
    const result = await db.transaction(async tx => {
      const [existing] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id, state
          FROM billingCapacityAllocations
          WHERE coverageKey = ${input.coverageKey}
          LIMIT 1 FOR UPDATE
        `)
      );
      if (existing) {
        return existing.state === "released"
          ? { reserved: false as const, reason: "unavailable" as const }
          : { reserved: true as const, reservationId: String(existing.id) };
      }

      const [candidate] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT s.id AS subscriptionId, s.planId, l.state,
            CASE WHEN l.state = 'pending' THEN l.trialCapacityLimit ELSE p.capacityLimit END AS capacityLimit,
            CASE
              WHEN l.state = 'pending' THEN l.trialEndsAt
              WHEN l.state = 'past_due' THEN l.graceEndsAt
              ELSE s.currentPeriodEnd
            END AS accessValidUntil,
            p.coveredBeneficiaryEntitlementsJson
          FROM billingSubscriptionLifecycle l
          INNER JOIN billingSubscriptions s ON s.id = l.subscriptionId
          INNER JOIN billingPlans p ON p.id = s.planId
          WHERE s.payerUserId = ${input.professionalUserId}
            AND p.audience = 'professional'
            AND (
              (l.state = 'pending' AND l.trialEndsAt > NOW())
              OR (l.state = 'past_due' AND l.graceEndsAt > NOW())
            )
          ORDER BY accessValidUntil DESC
          LIMIT 1 FOR UPDATE
        `)
      );
      if (!candidate) {
        return { fallback: true as const };
      }
      if (candidate.capacityLimit == null) {
        return { reserved: false as const, reason: "unavailable" as const };
      }

      const subscriptionId = String(candidate.subscriptionId);
      const activeAllocations = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id
          FROM billingCapacityAllocations
          WHERE subscriptionId = ${subscriptionId}
            AND state IN ('reserved', 'active')
          FOR UPDATE
        `)
      );
      if (activeAllocations.length >= numberValue(candidate.capacityLimit)) {
        return { reserved: false as const, reason: "capacity_exceeded" as const };
      }

      const allocationId = crypto.randomUUID();
      const entitlementId = crypto.randomUUID();
      const authorizationId = authorizationIdFromCoverageKey(input.coverageKey);
      const validUntil = dateOrNull(candidate.accessValidUntil);
      const entitlements = stringArray(candidate.coveredBeneficiaryEntitlementsJson);

      await tx.execute(sql`
        INSERT INTO billingCapacityAllocations (
          id, subscriptionId, professionalUserId, patientUserId,
          authorizationId, coverageKey, state, reservedAt, activatedAt,
          createdAt, updatedAt
        ) VALUES (
          ${allocationId}, ${subscriptionId}, ${input.professionalUserId},
          ${input.patientUserId}, ${authorizationId}, ${input.coverageKey},
          'active', NOW(), NOW(), NOW(), NOW()
        )
      `);
      await tx.execute(sql`
        INSERT INTO billingEntitlements (
          id, beneficiaryUserId, sourceType, sourceId, sponsorUserId,
          planId, professionalAuthorizationId, state, activeGrantKey,
          entitlementsJson, validFrom, validUntil, createdAt, updatedAt
        ) VALUES (
          ${entitlementId}, ${input.patientUserId}, 'professional_coverage',
          ${input.coverageKey}, ${input.professionalUserId}, ${String(candidate.planId)},
          ${authorizationId}, 'active', ${`professional_coverage:${input.coverageKey}`},
          ${JSON.stringify(entitlements)}, NOW(), ${validUntil}, NOW(), NOW()
        )
      `);
      await insertAuditEvent(tx, {
        subjectUserId: input.patientUserId,
        actorUserId: input.professionalUserId,
        action: "capacity_reserved",
        sourceType: "professional_coverage",
        sourceId: input.coverageKey,
        metadata: {
          subscriptionId,
          allocationId,
          lifecycleState: String(candidate.state),
          lifecycleCapacityLimit: numberValue(candidate.capacityLimit),
        },
      });
      return { reserved: true as const, reservationId: allocationId };
    });
    if ("fallback" in result) return baseline.reserveProfessionalCapacity(input);
    return result;
  }

  return { reserveProfessionalCapacity };
}
