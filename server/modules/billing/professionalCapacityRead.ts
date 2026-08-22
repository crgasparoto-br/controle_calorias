import { sql } from "drizzle-orm";
import { getDb } from "../../db";
import {
  numberValue,
  requireDb,
  resultRows,
} from "../../repositories/billingRepositorySupport";
import {
  PROFESSIONAL_CAPACITY_EXTENSION_DAYS,
  PROFESSIONAL_CAPACITY_GRANDFATHER_DAYS,
  professionalCapacityState,
  professionalCapacityWarningMilestones,
} from "./professionalCoveragePolicy";

function jsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function optionalDate(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function getProfessionalCapacityWebSnapshot(input: {
  subscriptionId: string;
  payerUserId: number;
  now?: Date;
}) {
  const db = await requireDb(getDb);
  const [row] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT s.id AS subscriptionId, s.payerUserId,
        CASE WHEN l.state = 'pending' THEN l.trialCapacityLimit ELSE p.capacityLimit END AS contractedLimit,
        (
          SELECT COUNT(*)
          FROM billingCapacityAllocations c
          WHERE c.subscriptionId = s.id
            AND c.state IN ('reserved', 'active')
        ) AS occupancy
      FROM billingSubscriptions s
      INNER JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
      INNER JOIN billingPlans p ON p.id = s.planId
      WHERE s.id = ${input.subscriptionId}
        AND s.payerUserId = ${input.payerUserId}
        AND p.audience = 'professional'
      LIMIT 1
    `)
  );
  if (!row || row.contractedLimit == null) return null;

  const contractedLimit = numberValue(row.contractedLimit);
  const occupancy = numberValue(row.occupancy);
  const [started] = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT payloadJson, effectiveAt, createdAt
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${input.subscriptionId}
        AND factType = 'professional_capacity_grandfathered_started'
      ORDER BY createdAt DESC
      LIMIT 1
    `)
  );

  let grandfatheredAt: Date | null = null;
  let temporaryLimit: number | null = null;
  let temporaryEndsAt: Date | null = null;
  let windowKey: string | null = null;
  let resolved = false;
  let extensionApplied = false;
  let commercialAnalysisRequired = false;

  if (started) {
    const payload = jsonObject(started.payloadJson);
    grandfatheredAt = optionalDate(started.effectiveAt);
    temporaryEndsAt = optionalDate(payload.endsAt);
    temporaryLimit = Number.isFinite(Number(payload.temporaryLimit))
      ? Number(payload.temporaryLimit)
      : null;
    windowKey = typeof payload.windowKey === "string" ? payload.windowKey : null;

    if (windowKey) {
      const [resolvedRow] = resultRows<Record<string, unknown>>(
        await db.execute(sql`
          SELECT id
          FROM billingSubscriptionFacts
          WHERE subscriptionId = ${input.subscriptionId}
            AND factType = 'professional_capacity_grandfathered_resolved'
            AND idempotencyKey = ${`${windowKey}:resolved:v1`}
          LIMIT 1
        `)
      );
      resolved = !!resolvedRow;

      const extensionPrefix = `${windowKey}:extension:`;
      const [extension] = resultRows<Record<string, unknown>>(
        await db.execute(sql`
          SELECT payloadJson
          FROM billingSubscriptionFacts
          WHERE subscriptionId = ${input.subscriptionId}
            AND factType = 'professional_capacity_extension_granted'
            AND SUBSTRING(idempotencyKey, 1, ${extensionPrefix.length}) = ${extensionPrefix}
          ORDER BY createdAt DESC
          LIMIT 1
        `)
      );
      if (extension) {
        extensionApplied = true;
        const extensionPayload = jsonObject(extension.payloadJson);
        temporaryEndsAt = optionalDate(extensionPayload.endsAt) ?? temporaryEndsAt;
        if (Number.isFinite(Number(extensionPayload.temporaryLimit))) {
          temporaryLimit = Number(extensionPayload.temporaryLimit);
        }
      }

      const [rangeReview] = resultRows<Record<string, unknown>>(
        await db.execute(sql`
          SELECT id
          FROM billingSubscriptionFacts
          WHERE subscriptionId = ${input.subscriptionId}
            AND factType = 'professional_capacity_admin_alert_opened'
            AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.windowKey')) = ${windowKey}
            AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.kind')) = 'catalog_range_review_required'
          ORDER BY createdAt DESC
          LIMIT 1
        `)
      );
      commercialAnalysisRequired = !!rangeReview;
    }
  }

  const now = input.now ?? new Date();
  const state =
    resolved && occupancy <= contractedLimit
      ? "grandfathered_resolved"
      : professionalCapacityState({
          occupancy,
          contractedLimit,
          grandfatheredAt,
          endsAt: temporaryEndsAt,
          now,
        });
  const warningMilestones =
    grandfatheredAt && temporaryEndsAt && !resolved
      ? professionalCapacityWarningMilestones({
          startedAt: grandfatheredAt,
          endsAt: temporaryEndsAt,
        }).map(item => ({
          key: item.key,
          dueAt: item.dueAt,
          daysRemaining: item.daysRemaining,
          reached: item.dueAt.getTime() <= now.getTime(),
        }))
      : [];

  return {
    state,
    contractedLimit,
    occupancy,
    available: Math.max(0, contractedLimit - occupancy),
    excess: Math.max(0, occupancy - contractedLimit),
    temporaryLimit,
    temporaryEndsAt,
    temporaryWindowKind: grandfatheredAt
      ? extensionApplied
        ? ("extension" as const)
        : ("initial" as const)
      : null,
    temporaryWindowDays: grandfatheredAt
      ? extensionApplied
        ? PROFESSIONAL_CAPACITY_EXTENSION_DAYS
        : PROFESSIONAL_CAPACITY_GRANDFATHER_DAYS
      : null,
    warningMilestones,
    commercialAnalysisRequired,
    newCoverageBlocked:
      occupancy >= contractedLimit || state === "grandfathered_expired",
  };
}