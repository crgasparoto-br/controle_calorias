import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  ReleaseBillingCapacityInput,
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

export function createBillingCapacityRepository(deps: BillingRepositoryDeps) {
  async function reserveProfessionalCapacity(
    input: ReserveBillingCapacityInput
  ): Promise<ReserveBillingCapacityResult> {
    const db = await requireDb(deps.getDb);
    try {
      return await db.transaction(async tx => {
        const [existing] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT id, state
            FROM billingCapacityAllocations
            WHERE coverageKey = ${input.coverageKey}
            LIMIT 1
            FOR UPDATE
          `)
        );
        if (existing) {
          return existing.state === "released"
            ? { reserved: false as const, reason: "unavailable" as const }
            : { reserved: true as const, reservationId: String(existing.id) };
        }

        const [subscription] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT s.id AS subscriptionId, s.currentPeriodEnd, p.id AS planId,
              p.capacityLimit, p.entitlementsJson
            FROM billingSubscriptions s
            INNER JOIN billingPlans p ON p.id = s.planId
            WHERE s.payerUserId = ${input.professionalUserId}
              AND p.audience = 'professional'
              AND s.status = 'active'
              AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= NOW())
              AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > NOW())
            ORDER BY s.currentPeriodEnd DESC, s.createdAt DESC
            LIMIT 1
            FOR UPDATE
          `)
        );
        if (!subscription || subscription.capacityLimit === null) {
          return { reserved: false as const, reason: "unavailable" as const };
        }

        const [usage] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT COUNT(*) AS used
            FROM billingCapacityAllocations
            WHERE subscriptionId = ${String(subscription.subscriptionId)}
              AND state IN ('reserved', 'active')
          `)
        );
        if (
          numberValue(usage?.used) >= numberValue(subscription.capacityLimit)
        ) {
          return {
            reserved: false as const,
            reason: "capacity_exceeded" as const,
          };
        }

        const allocationId = crypto.randomUUID();
        const entitlementId = crypto.randomUUID();
        const authorizationId = authorizationIdFromCoverageKey(
          input.coverageKey
        );
        const validUntil = dateOrNull(subscription.currentPeriodEnd);
        const entitlements = stringArray(subscription.entitlementsJson);

        await tx.execute(sql`
          INSERT INTO billingCapacityAllocations (
            id, subscriptionId, professionalUserId, patientUserId,
            authorizationId, coverageKey, state, reservedAt, activatedAt,
            createdAt, updatedAt
          ) VALUES (
            ${allocationId}, ${String(subscription.subscriptionId)},
            ${input.professionalUserId}, ${input.patientUserId},
            ${authorizationId}, ${input.coverageKey}, 'active', NOW(), NOW(),
            NOW(), NOW()
          )
        `);
        await tx.execute(sql`
          INSERT INTO billingEntitlements (
            id, beneficiaryUserId, sourceType, sourceId, sponsorUserId,
            planId, professionalAuthorizationId, state, activeGrantKey,
            entitlementsJson, validFrom, validUntil, createdAt, updatedAt
          ) VALUES (
            ${entitlementId}, ${input.patientUserId}, 'professional_coverage',
            ${input.coverageKey}, ${input.professionalUserId},
            ${String(subscription.planId)}, ${authorizationId}, 'active',
            ${`professional_coverage:${input.coverageKey}`},
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
            subscriptionId: String(subscription.subscriptionId),
            allocationId,
          },
        });
        return { reserved: true as const, reservationId: allocationId };
      });
    } catch (error) {
      try {
        const [existing] = resultRows<Record<string, unknown>>(
          await db.execute(sql`
            SELECT id, state
            FROM billingCapacityAllocations
            WHERE coverageKey = ${input.coverageKey}
            LIMIT 1
          `)
        );
        if (existing && existing.state !== "released") {
          return { reserved: true, reservationId: String(existing.id) };
        }
      } catch (lookupError) {
        deps.onWarning("billing_capacity_idempotency_lookup", lookupError);
      }
      deps.onWarning("billing_capacity_reservation", error);
      throw error;
    }
  }

  async function releaseProfessionalCapacity(
    input: ReleaseBillingCapacityInput
  ) {
    const db = await requireDb(deps.getDb);
    await db.transaction(async tx => {
      const [allocation] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id, professionalUserId, patientUserId, state
          FROM billingCapacityAllocations
          WHERE coverageKey = ${input.coverageKey}
          LIMIT 1
          FOR UPDATE
        `)
      );
      if (!allocation || allocation.state === "released") return;

      await tx.execute(sql`
        UPDATE billingCapacityAllocations
        SET state = 'released', releasedAt = NOW(),
          releaseReason = ${input.reason ?? "professional_coverage_ended"},
          updatedAt = NOW()
        WHERE id = ${String(allocation.id)} AND state <> 'released'
      `);
      await tx.execute(sql`
        UPDATE billingEntitlements
        SET state = 'ended', activeGrantKey = NULL, endedAt = NOW(), updatedAt = NOW()
        WHERE sourceType = 'professional_coverage'
          AND sourceId = ${input.coverageKey}
          AND state = 'active'
      `);
      await insertAuditEvent(tx, {
        subjectUserId: numberValue(allocation.patientUserId),
        actorUserId: numberValue(allocation.professionalUserId),
        action: "capacity_released",
        sourceType: "professional_coverage",
        sourceId: input.coverageKey,
        reason: input.reason ?? "professional_coverage_ended",
        metadata: { allocationId: String(allocation.id) },
      });
    });
  }

  return { reserveProfessionalCapacity, releaseProfessionalCapacity };
}
