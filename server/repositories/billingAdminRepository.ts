import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import type {
  BillingAdminAnalytics,
  BillingAdminUserRow,
  GrantBillingOverrideInput,
  RevokeBillingOverrideInput,
} from "../modules/billing/types";
import {
  insertAuditEvent,
  mapOverride,
  numberValue,
  requireDb,
  resultRows,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingAdminRepository(deps: BillingRepositoryDeps) {
  async function grantAdminOverride(input: GrantBillingOverrideInput) {
    const db = await requireDb(deps.getDb);
    const startsAt = input.startsAt ?? new Date();
    const overrideId = crypto.randomUUID();
    return db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE billingAdminOverrides
        SET state = 'expired', activeUserKey = NULL, updatedAt = NOW()
        WHERE userId = ${input.userId}
          AND state = 'active'
          AND endsAt IS NOT NULL
          AND endsAt <= ${startsAt}
      `);
      const [existing] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides
          WHERE activeUserKey = ${String(input.userId)}
          LIMIT 1
          FOR UPDATE
        `)
      );
      if (existing) {
        await tx.execute(sql`
          UPDATE billingAdminOverrides
          SET state = 'revoked', activeUserKey = NULL,
            revokedByUserId = ${input.grantedByUserId}, revokedAt = NOW(),
            updatedAt = NOW()
          WHERE id = ${String(existing.id)} AND state = 'active'
        `);
        await insertAuditEvent(tx, {
          subjectUserId: input.userId,
          actorUserId: input.grantedByUserId,
          action: "override_revoked",
          sourceType: "admin_override",
          sourceId: String(existing.id),
          reason: "Exceção substituída por uma nova concessão administrativa.",
        });
      }

      await tx.execute(sql`
        INSERT INTO billingAdminOverrides (
          id, userId, accessWithoutSubscription, reason, startsAt, endsAt,
          state, activeUserKey, grantedByUserId, createdAt, updatedAt
        ) VALUES (
          ${overrideId}, ${input.userId}, true, ${input.reason}, ${startsAt},
          ${input.endsAt ?? null}, 'active', ${String(input.userId)},
          ${input.grantedByUserId}, NOW(), NOW()
        )
      `);
      await insertAuditEvent(tx, {
        subjectUserId: input.userId,
        actorUserId: input.grantedByUserId,
        action: "override_granted",
        sourceType: "admin_override",
        sourceId: overrideId,
        reason: input.reason,
        metadata: {
          startsAt: startsAt.toISOString(),
          endsAt: input.endsAt?.toISOString() ?? null,
        },
      });
      const [saved] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides WHERE id = ${overrideId} LIMIT 1
        `)
      );
      if (!saved)
        throw new Error("Não foi possível persistir a exceção administrativa.");
      return mapOverride(saved);
    });
  }

  async function revokeAdminOverride(input: RevokeBillingOverrideInput) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const [current] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides
          WHERE id = ${input.overrideId}
          LIMIT 1
          FOR UPDATE
        `)
      );
      if (!current) throw new Error("Exceção administrativa não encontrada.");
      if (current.state === "active") {
        await tx.execute(sql`
          UPDATE billingAdminOverrides
          SET state = 'revoked', activeUserKey = NULL,
            revokedByUserId = ${input.revokedByUserId}, revokedAt = NOW(),
            updatedAt = NOW()
          WHERE id = ${input.overrideId} AND state = 'active'
        `);
        await insertAuditEvent(tx, {
          subjectUserId: numberValue(current.userId),
          actorUserId: input.revokedByUserId,
          action: "override_revoked",
          sourceType: "admin_override",
          sourceId: input.overrideId,
          reason: input.reason,
        });
      }
      const [saved] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT * FROM billingAdminOverrides WHERE id = ${input.overrideId} LIMIT 1
        `)
      );
      if (!saved) throw new Error("Exceção administrativa não encontrada.");
      return mapOverride(saved);
    });
  }

  async function searchUsers(query: string, limit: number) {
    const db = await requireDb(deps.getDb);
    const normalized = query.trim();
    const pattern = `%${normalized}%`;
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT u.id, u.name, u.email, MAX(w.phoneNumber) AS phoneNumber
        FROM users u
        LEFT JOIN whatsappConnections w ON w.userId = u.id
        WHERE ${normalized === ""}
          OR u.name LIKE ${pattern}
          OR u.email LIKE ${pattern}
          OR w.phoneNumber LIKE ${pattern}
        GROUP BY u.id, u.name, u.email
        ORDER BY u.name ASC, u.id ASC
        LIMIT ${limit}
      `)
    );
    return rows.map(
      row =>
        ({
          id: numberValue(row.id),
          name: row.name ? String(row.name) : null,
          email: row.email ? String(row.email) : null,
          phoneNumber: row.phoneNumber ? String(row.phoneNumber) : null,
        }) satisfies BillingAdminUserRow
    );
  }

  async function getAdminAnalytics(now: Date): Promise<BillingAdminAnalytics> {
    const db = await requireDb(deps.getDb);
    const planRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT id, code, name, audience, billingCycle, currency, unitAmount, active
        FROM billingPlans
        ORDER BY code
      `)
    );
    const subscriptionRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT planId, status, COUNT(*) AS total
        FROM billingSubscriptions
        GROUP BY planId, status
      `)
    );
    const coverageRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.planId,
          COUNT(DISTINCT c.patientUserId) AS coveredBeneficiaries,
          COUNT(*) AS capacityUsed
        FROM billingCapacityAllocations c
        INNER JOIN billingSubscriptions s ON s.id = c.subscriptionId
        WHERE c.state IN ('reserved', 'active')
        GROUP BY s.planId
      `)
    );
    const [overrideRow] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM billingAdminOverrides
        WHERE state = 'active' AND accessWithoutSubscription = true
          AND startsAt <= ${now} AND (endsAt IS NULL OR endsAt > ${now})
      `)
    );
    const [withoutAccessRow] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT COUNT(*) AS total
        FROM users u
        WHERE NOT EXISTS (
          SELECT 1 FROM billingSubscriptions s
          WHERE s.payerUserId = u.id AND s.status = 'active'
            AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM billingEntitlements e
          WHERE e.beneficiaryUserId = u.id AND e.state = 'active'
            AND e.validFrom <= ${now}
            AND (e.validUntil IS NULL OR e.validUntil > ${now})
        )
        AND NOT EXISTS (
          SELECT 1 FROM billingAdminOverrides o
          WHERE o.userId = u.id AND o.state = 'active'
            AND o.accessWithoutSubscription = true
            AND o.startsAt <= ${now}
            AND (o.endsAt IS NULL OR o.endsAt > ${now})
        )
      `)
    );
    const revenueRows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT p.currency, p.billingCycle, p.unitAmount, COUNT(*) AS total
        FROM billingSubscriptions s
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE s.status = 'active'
          AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
          AND p.billingCycle IN ('monthly', 'yearly')
        GROUP BY p.currency, p.billingCycle, p.unitAmount
      `)
    );

    const statusTotals: Record<string, number> = {};
    const statusesByPlan = new Map<string, Record<string, number>>();
    for (const row of subscriptionRows) {
      const planId = String(row.planId);
      const status = String(row.status);
      const total = numberValue(row.total);
      statusTotals[status] = (statusTotals[status] ?? 0) + total;
      const byStatus = statusesByPlan.get(planId) ?? {};
      byStatus[status] = total;
      statusesByPlan.set(planId, byStatus);
    }
    const coverageByPlan = new Map(
      coverageRows.map(row => [
        String(row.planId),
        {
          coveredBeneficiaries: numberValue(row.coveredBeneficiaries),
          capacityUsed: numberValue(row.capacityUsed),
        },
      ])
    );
    const revenueByCurrency = new Map<string, number>();
    for (const row of revenueRows) {
      const currency = String(row.currency);
      const unitAmount = numberValue(row.unitAmount);
      const total = numberValue(row.total);
      const monthly =
        row.billingCycle === "yearly" ? unitAmount / 12 : unitAmount;
      revenueByCurrency.set(
        currency,
        (revenueByCurrency.get(currency) ?? 0) + monthly * total
      );
    }

    return {
      plans: planRows.map(row => {
        const planId = String(row.id);
        const coverage = coverageByPlan.get(planId) ?? {
          coveredBeneficiaries: 0,
          capacityUsed: 0,
        };
        return {
          planCode: String(row.code),
          planName: String(row.name),
          audience: row.audience as "individual" | "professional",
          billingCycle: row.billingCycle as "monthly" | "yearly" | "custom",
          currency: String(row.currency),
          unitAmount: numberValue(row.unitAmount),
          active: Boolean(row.active),
          subscriptionsByStatus: statusesByPlan.get(planId) ?? {},
          ...coverage,
        };
      }),
      subscriptionStatusTotals: statusTotals,
      activeOverrides: numberValue(overrideRow?.total),
      usersWithoutCommercialAccess: numberValue(withoutAccessRow?.total),
      estimatedMonthlyRecurringRevenue: Array.from(
        revenueByCurrency.entries(),
        ([currency, amount]) => ({
          currency,
          amountMinor: Math.round(amount),
          estimated: true as const,
        })
      ),
      generatedAt: now,
    };
  }

  return {
    grantAdminOverride,
    revokeAdminOverride,
    searchUsers,
    getAdminAnalytics,
  };
}
