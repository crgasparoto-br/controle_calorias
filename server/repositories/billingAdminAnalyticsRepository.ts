import { sql } from "drizzle-orm";
import type { BillingAdminAnalytics } from "../modules/billing/types";
import {
  numberValue,
  requireDb,
  resultRows,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

export function createBillingAdminAnalyticsRepository(
  deps: BillingRepositoryDeps
) {
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
          SELECT 1
          FROM billingSubscriptions s
          WHERE s.payerUserId = u.id
            AND s.status = 'active'
            AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
            AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM billingEntitlements e
          INNER JOIN billingCapacityAllocations c
            ON c.coverageKey = e.sourceId
            AND c.state IN ('reserved', 'active')
          INNER JOIN billingSubscriptions s
            ON s.id = c.subscriptionId
            AND s.status = 'active'
            AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
            AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now})
          INNER JOIN professionalPatientAuthorizations a
            ON a.id = c.authorizationId
            AND a.status = 'approved'
          WHERE e.beneficiaryUserId = u.id
            AND e.sourceType = 'professional_coverage'
            AND e.state = 'active'
            AND e.validFrom <= ${now}
            AND (e.validUntil IS NULL OR e.validUntil > ${now})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM billingEntitlements e
          WHERE e.beneficiaryUserId = u.id
            AND e.sourceType IN ('trial', 'free_access')
            AND e.state = 'active'
            AND e.validFrom <= ${now}
            AND (e.validUntil IS NULL OR e.validUntil > ${now})
        )
        AND NOT EXISTS (
          SELECT 1
          FROM billingAdminOverrides o
          WHERE o.userId = u.id
            AND o.state = 'active'
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
          AND (s.currentPeriodStart IS NULL OR s.currentPeriodStart <= ${now})
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

  return { getAdminAnalytics };
}
