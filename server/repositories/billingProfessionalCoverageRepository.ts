import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import {
  canGrantProfessionalCoverageTransition,
  dueProfessionalCapacityAlertEvents,
  dueProfessionalCapacityWarnings,
  professionalCapacityExtensionEndsAt,
  professionalCapacityGrandfatherEndsAt,
  professionalCapacityState,
  professionalCoverageTransitionEndsAt,
  type ProfessionalCapacityState,
} from "../modules/billing/professionalCoveragePolicy";
import {
  isDuplicateEntryError,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
} from "./billingRepositorySupport";

type SqlExecutor = {
  execute(query: any): Promise<any>;
};

type CoverageContext = {
  subscriptionId: string;
  professionalUserId: number;
  audience: "individual" | "professional";
  planId: string;
  productCode: string;
  versionCode: string;
  billingCycle: "monthly" | "yearly" | "custom";
  lifecycleState: "pending" | "active" | "past_due" | "suspended" | "expired";
  contractedLimit: number;
  occupancy: number;
  highestPublicCapacity: number | null;
};

type CapacityWindow = {
  windowKey: string;
  startedAt: Date;
  endsAt: Date;
  temporaryLimit: number;
};

type CapacityAlertHistory = {
  hasExistingAlert: boolean;
  eventKeys: Set<string>;
};

export type ProfessionalCoverageLifecycleFact = {
  id: string;
  subscriptionId: string;
  factType: string;
  occurredAt: Date;
};

export type ProfessionalCapacitySnapshot = CoverageContext & {
  state: ProfessionalCapacityState;
  grandfatheredAt: Date | null;
  temporaryLimit: number | null;
  temporaryEndsAt: Date | null;
};

function dateValue(value: unknown) {
  if (value instanceof Date) return value;
  return new Date(String(value));
}

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

function safeText(value: unknown, max = 500) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

async function appendCoverageFact(
  tx: SqlExecutor,
  input: {
    context: CoverageContext;
    factType: string;
    idempotencyKey: string;
    correlationId: string;
    occurredAt: Date;
    actionAllowed?: string | null;
    payload?: Record<string, unknown>;
  }
) {
  const id = crypto.randomUUID();
  try {
    await tx.execute(sql`
      INSERT INTO billingSubscriptionFacts (
        id, subscriptionId, payerUserId, factType, factVersion,
        idempotencyKey, correlationId, audience, productCode, versionCode,
        billingCycle, previousState, newState, actionAllowed, effectiveAt,
        payloadJson, createdAt
      ) VALUES (
        ${id}, ${input.context.subscriptionId},
        ${input.context.professionalUserId}, ${input.factType}, 1,
        ${input.idempotencyKey}, ${input.correlationId}, ${input.context.audience},
        ${input.context.productCode}, ${input.context.versionCode},
        ${input.context.billingCycle}, ${input.context.lifecycleState},
        ${input.context.lifecycleState}, ${input.actionAllowed ?? null},
        ${input.occurredAt}, ${JSON.stringify(input.payload ?? {})}, NOW()
      )
    `);
    return { id, created: true };
  } catch (error) {
    if (!isDuplicateEntryError(error)) throw error;
    const [existing] = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id
        FROM billingSubscriptionFacts
        WHERE idempotencyKey = ${input.idempotencyKey}
        LIMIT 1
      `)
    );
    if (!existing) throw error;
    return { id: String(existing.id), created: false };
  }
}

async function loadCoverageContext(
  tx: SqlExecutor,
  subscriptionId: string
): Promise<CoverageContext | null> {
  const [row] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT s.id AS subscriptionId, s.payerUserId AS professionalUserId,
        s.planId, p.capacityLimit, p.versionCode, p.billingCycle,
        product.code AS productCode, l.state AS lifecycleState,
        CASE WHEN l.state = 'pending' THEN l.trialCapacityLimit ELSE p.capacityLimit END AS effectiveCapacityLimit,
        (
          SELECT COUNT(*)
          FROM billingCapacityAllocations c
          WHERE c.subscriptionId = s.id
            AND c.state IN ('reserved', 'active')
        ) AS occupancy,
        (
          SELECT MAX(publicPlan.capacityLimit)
          FROM billingPlans publicPlan
          WHERE publicPlan.audience = 'professional'
            AND publicPlan.active = true
            AND publicPlan.status = 'active'
            AND publicPlan.effectiveFrom <= NOW()
            AND (publicPlan.effectiveUntil IS NULL OR publicPlan.effectiveUntil > NOW())
        ) AS highestPublicCapacity
      FROM billingSubscriptions s
      INNER JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
      INNER JOIN billingPlans p ON p.id = s.planId
      INNER JOIN billingProducts product ON product.id = p.productId
      WHERE s.id = ${subscriptionId}
        AND p.audience = 'professional'
      LIMIT 1
      FOR UPDATE
    `)
  );
  if (!row || row.effectiveCapacityLimit == null) return null;
  return {
    subscriptionId: String(row.subscriptionId),
    professionalUserId: numberValue(row.professionalUserId),
    audience: "professional",
    planId: String(row.planId),
    productCode: String(row.productCode),
    versionCode: String(row.versionCode),
    billingCycle: String(row.billingCycle) as CoverageContext["billingCycle"],
    lifecycleState: String(row.lifecycleState) as CoverageContext["lifecycleState"],
    contractedLimit: numberValue(row.effectiveCapacityLimit),
    occupancy: numberValue(row.occupancy),
    highestPublicCapacity:
      row.highestPublicCapacity == null
        ? null
        : numberValue(row.highestPublicCapacity),
  };
}

async function loadCapacityWindow(
  tx: SqlExecutor,
  subscriptionId: string
): Promise<CapacityWindow | null> {
  // The root event is the durable identity of the current aggregate. Never
  // reconstruct it from a bounded mixed page of child events: a long-lived
  // window may legitimately accumulate more extensions than any page size.
  const [latestStarted] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT payloadJson, effectiveAt
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${subscriptionId}
        AND factType = 'professional_capacity_grandfathered_started'
      ORDER BY createdAt DESC
      LIMIT 1
    `)
  );
  if (!latestStarted) return null;
  const startPayload = jsonObject(latestStarted.payloadJson);
  const windowKey = safeText(startPayload.windowKey, 191);
  const baseEndsAt = safeText(startPayload.endsAt, 64);
  const temporaryLimit = Number(startPayload.temporaryLimit);
  if (!windowKey || !baseEndsAt || !Number.isFinite(temporaryLimit)) return null;

  const resolvedKey = `${windowKey}:resolved:v1`;
  const [resolved] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT id
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${subscriptionId}
        AND factType = 'professional_capacity_grandfathered_resolved'
        AND idempotencyKey = ${resolvedKey}
      LIMIT 1
    `)
  );
  if (resolved) return null;

  const extensionPrefix = `${windowKey}:extension:`;
  const [latestExtension] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT payloadJson
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${subscriptionId}
        AND factType = 'professional_capacity_extension_granted'
        AND SUBSTRING(idempotencyKey, 1, ${extensionPrefix.length}) = ${extensionPrefix}
      ORDER BY createdAt DESC
      LIMIT 1
    `)
  );

  let endsAt = new Date(baseEndsAt);
  if (Number.isNaN(endsAt.getTime())) return null;
  if (latestExtension) {
    const payload = jsonObject(latestExtension.payloadJson);
    const candidate = safeText(payload.endsAt, 64);
    if (!candidate) return null;
    const value = new Date(candidate);
    if (Number.isNaN(value.getTime())) return null;
    if (value.getTime() > endsAt.getTime()) endsAt = value;
  }
  return {
    windowKey,
    startedAt: dateValue(latestStarted.effectiveAt),
    endsAt,
    temporaryLimit,
  };
}

async function loadCapacityAlertHistory(
  tx: SqlExecutor,
  subscriptionId: string,
  windowKey: string
): Promise<CapacityAlertHistory> {
  const rows = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT payloadJson
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${subscriptionId}
        AND factType = 'professional_capacity_admin_alert_opened'
      ORDER BY createdAt ASC
      LIMIT 100
    `)
  );
  const matchingPayloads = rows
    .map(row => jsonObject(row.payloadJson))
    .filter(payload => payload.windowKey === windowKey);
  const eventKeys = new Set<string>();
  for (const payload of matchingPayloads) {
    const eventKey = safeText(payload.alertEventKey, 191);
    if (eventKey) eventKeys.add(eventKey);

    const kind = safeText(payload.kind, 120);
    if (kind === "catalog_range_review_required") {
      const highestPublicCapacity = Number(payload.highestPublicCapacity);
      if (Number.isFinite(highestPublicCapacity)) {
        eventKeys.add(
          `catalog_range_review_required:${highestPublicCapacity}`
        );
      }
    }
    if (payload.temporaryState === "grandfathered_expired") {
      const expiredAt = safeText(payload.expiredAt, 64);
      if (expiredAt) eventKeys.add(`grandfathering_expired:${expiredAt}`);
    }
  }
  return {
    hasExistingAlert: matchingPayloads.length > 0,
    eventKeys,
  };
}

async function hasOtherProfessionalCoverage(
  tx: SqlExecutor,
  patientUserId: number,
  excludedCoverageKey: string,
  now: Date
) {
  const [row] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT c.id
      FROM billingCapacityAllocations c
      INNER JOIN billingEntitlements e
        ON e.sourceType = 'professional_coverage'
        AND e.sourceId = c.coverageKey
        AND e.state = 'active'
        AND e.validFrom <= ${now}
        AND (e.validUntil IS NULL OR e.validUntil > ${now})
      INNER JOIN professionalPatientAuthorizations a
        ON a.id = c.authorizationId AND a.status = 'approved'
      INNER JOIN professionalPatientTrackings t
        ON t.authorizationId = a.id AND t.status IN ('active', 'paused')
      INNER JOIN billingSubscriptionLifecycle l
        ON l.subscriptionId = c.subscriptionId
      INNER JOIN billingSubscriptions s ON s.id = c.subscriptionId
      WHERE c.patientUserId = ${patientUserId}
        AND c.coverageKey <> ${excludedCoverageKey}
        AND c.state IN ('reserved', 'active')
        AND (
          (l.state = 'active'
            AND (s.currentPeriodEnd IS NULL OR s.currentPeriodEnd > ${now}))
          OR (l.state = 'past_due' AND l.graceEndsAt > ${now})
          OR (l.state = 'pending' AND l.trialEndsAt > ${now})
        )
      LIMIT 1
    `)
  );
  return !!row;
}

async function grantPatientTransition(
  tx: SqlExecutor,
  input: {
    patientUserId: number;
    causeKey: string;
    coverageKey: string;
    now: Date;
    entitlements: string[];
  }
) {
  await tx.execute(sql`SELECT id FROM users WHERE id = ${input.patientUserId} FOR UPDATE`);
  if (
    await hasOtherProfessionalCoverage(
      tx,
      input.patientUserId,
      input.coverageKey,
      input.now
    )
  ) {
    return { granted: false as const, reason: "other_professional_coverage" as const };
  }
  const [last] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT validFrom
      FROM billingEntitlements
      WHERE beneficiaryUserId = ${input.patientUserId}
        AND sourceType = 'transition'
        AND sourceId LIKE 'professional-coverage-loss:%'
      ORDER BY validFrom DESC
      LIMIT 1
    `)
  );
  const lastGrantedAt = last?.validFrom ? dateValue(last.validFrom) : null;
  if (
    !canGrantProfessionalCoverageTransition({
      now: input.now,
      lastGrantedAt,
    })
  ) {
    return { granted: false as const, reason: "cooldown" as const };
  }
  const causeHash = crypto
    .createHash("sha256")
    .update(input.causeKey)
    .digest("hex")
    .slice(0, 40);
  const sourceId = `professional-coverage-loss:${causeHash}`;
  const [existing] = resultRows<Record<string, unknown>>(
    await tx.execute(sql`
      SELECT id
      FROM billingEntitlements
      WHERE beneficiaryUserId = ${input.patientUserId}
        AND sourceType = 'transition'
        AND sourceId = ${sourceId}
      LIMIT 1
    `)
  );
  if (existing) return { granted: false as const, reason: "duplicate" as const };

  const transitionId = crypto.randomUUID();
  const readOnlyId = crypto.randomUUID();
  const transitionEndsAt = professionalCoverageTransitionEndsAt(input.now);
  await tx.execute(sql`
    INSERT INTO billingEntitlements (
      id, beneficiaryUserId, sourceType, sourceId, state,
      entitlementsJson, validFrom, validUntil, createdAt, updatedAt
    ) VALUES (
      ${transitionId}, ${input.patientUserId}, 'transition', ${sourceId}, 'active',
      ${JSON.stringify(input.entitlements)}, ${input.now}, ${transitionEndsAt}, NOW(), NOW()
    )
  `);
  await tx.execute(sql`
    INSERT INTO billingEntitlements (
      id, beneficiaryUserId, sourceType, sourceId, state,
      entitlementsJson, validFrom, validUntil, createdAt, updatedAt
    ) VALUES (
      ${readOnlyId}, ${input.patientUserId}, 'read_only',
      ${`professional-coverage-read-only:${causeHash}`}, 'active',
      ${JSON.stringify(["system_access", "read_only", "export_data", "manage_account"])},
      ${transitionEndsAt}, NULL, NOW(), NOW()
    )
  `);
  return { granted: true as const, transitionEndsAt };
}

export function createBillingProfessionalCoverageRepository(
  deps: BillingRepositoryDeps
) {
  async function reconcileProfessionalCapacity(
    subscriptionId: string,
    now = new Date()
  ): Promise<ProfessionalCapacitySnapshot | null> {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const context = await loadCoverageContext(tx, subscriptionId);
      if (!context) return null;
      let window = await loadCapacityWindow(tx, subscriptionId);

      if (context.occupancy <= context.contractedLimit) {
        if (window) {
          await appendCoverageFact(tx, {
            context,
            factType: "professional_capacity_grandfathered_resolved",
            idempotencyKey: `${window.windowKey}:resolved:v1`,
            correlationId: `professional-capacity:${subscriptionId}`,
            occurredAt: now,
            payload: {
              windowKey: window.windowKey,
              contractedLimit: context.contractedLimit,
              occupancy: context.occupancy,
              resolvedAt: now.toISOString(),
            },
          });
          return {
            ...context,
            state: "grandfathered_resolved",
            grandfatheredAt: window.startedAt,
            temporaryLimit: window.temporaryLimit,
            temporaryEndsAt: window.endsAt,
          };
        }
        return {
          ...context,
          state: "within_capacity",
          grandfatheredAt: null,
          temporaryLimit: null,
          temporaryEndsAt: null,
        };
      }

      if (!window) {
        const startedAt = now;
        const endsAt = professionalCapacityGrandfatherEndsAt(startedAt);
        const windowKey = `professional-capacity:${subscriptionId}:${context.versionCode}:${context.contractedLimit}:${startedAt.toISOString()}`;
        window = {
          windowKey,
          startedAt,
          endsAt,
          temporaryLimit: context.occupancy,
        };
        await appendCoverageFact(tx, {
          context,
          factType: "professional_capacity_grandfathered_started",
          idempotencyKey: `${windowKey}:started:v1`,
          correlationId: `professional-capacity:${subscriptionId}`,
          occurredAt: startedAt,
          actionAllowed: "resolve_capacity",
          payload: {
            windowKey,
            contractedLimit: context.contractedLimit,
            initialOccupancy: context.occupancy,
            temporaryLimit: context.occupancy,
            startedAt: startedAt.toISOString(),
            endsAt: endsAt.toISOString(),
            reason: "portfolio_above_contracted_capacity",
            migrationSource: "issue_894_policy_reconciliation",
          },
        });
      }

      const dueWarnings = dueProfessionalCapacityWarnings({
        startedAt: window.startedAt,
        endsAt: window.endsAt,
        now,
        emittedKeys: [],
      });
      for (const warning of dueWarnings) {
        await appendCoverageFact(tx, {
          context,
          factType: "professional_capacity_warning",
          idempotencyKey: `${window.windowKey}:warning:${warning.key}:${warning.dueAt.toISOString()}:v1`,
          correlationId: `professional-capacity:${subscriptionId}`,
          occurredAt: warning.dueAt,
          actionAllowed: "resolve_capacity",
          payload: {
            windowKey: window.windowKey,
            milestone: warning.key,
            daysRemaining: warning.daysRemaining,
            contractedLimit: context.contractedLimit,
            occupancy: context.occupancy,
            excess: context.occupancy - context.contractedLimit,
            temporaryEndsAt: window.endsAt.toISOString(),
            newCoverageBlocked: true,
            alternatives: ["natural_endings", "upgrade", "admin_extension"],
          },
        });
      }

      const state = professionalCapacityState({
        occupancy: context.occupancy,
        contractedLimit: context.contractedLimit,
        grandfatheredAt: window.startedAt,
        endsAt: window.endsAt,
        now,
      });

      const alertHistory = await loadCapacityAlertHistory(
        tx,
        subscriptionId,
        window.windowKey
      );
      const alertEvents = dueProfessionalCapacityAlertEvents({
        occupancy: context.occupancy,
        contractedLimit: context.contractedLimit,
        highestPublicCapacity: context.highestPublicCapacity,
        capacityState: state,
        windowEndsAt: window.endsAt,
        hasExistingAlert: alertHistory.hasExistingAlert,
        existingEventKeys: alertHistory.eventKeys,
      });
      for (const alertEvent of alertEvents) {
        const occurredAt =
          alertEvent.trigger === "initial_exceeded_capacity"
            ? window.startedAt
            : alertEvent.trigger === "grandfathering_expired"
              ? window.endsAt
              : now;
        const idempotencyKey =
          alertEvent.trigger === "initial_exceeded_capacity"
            ? `${window.windowKey}:admin-alert:v1`
            : `professional-capacity-alert:${crypto
                .createHash("sha256")
                .update(`${window.windowKey}:${alertEvent.eventKey}`)
                .digest("hex")
                .slice(0, 40)}:v1`;
        await appendCoverageFact(tx, {
          context,
          factType: "professional_capacity_admin_alert_opened",
          idempotencyKey,
          correlationId: `professional-capacity:${subscriptionId}`,
          occurredAt,
          actionAllowed: "admin_review",
          payload: {
            windowKey: window.windowKey,
            professionalUserId: context.professionalUserId,
            planId: context.planId,
            versionCode: context.versionCode,
            contractedLimit: context.contractedLimit,
            occupancy: context.occupancy,
            excess: context.occupancy - context.contractedLimit,
            highestPublicCapacity: context.highestPublicCapacity,
            kind: alertEvent.kind,
            priority: alertEvent.priority,
            temporaryState: state,
            temporaryEndsAt: window.endsAt.toISOString(),
            alertTrigger: alertEvent.trigger,
            alertEventKey: alertEvent.eventKey,
            ...(alertEvent.trigger === "grandfathering_expired"
              ? { expiredAt: window.endsAt.toISOString() }
              : {}),
          },
        });
      }

      if (state === "grandfathered_expired") {
        await appendCoverageFact(tx, {
          context,
          factType: "professional_capacity_grandfathered_expired",
          idempotencyKey: `${window.windowKey}:expired:${window.endsAt.toISOString()}:v1`,
          correlationId: `professional-capacity:${subscriptionId}`,
          occurredAt: window.endsAt,
          actionAllowed: "admin_review",
          payload: {
            windowKey: window.windowKey,
            contractedLimit: context.contractedLimit,
            occupancy: context.occupancy,
            excess: context.occupancy - context.contractedLimit,
            expiredAt: window.endsAt.toISOString(),
            newCoverageBlocked: true,
            commercialReviewPending: true,
          },
        });
      }
      return {
        ...context,
        state,
        grandfatheredAt: window.startedAt,
        temporaryLimit: window.temporaryLimit,
        temporaryEndsAt: window.endsAt,
      };
    });
  }

  async function grantCapacityExtension(input: {
    subscriptionId: string;
    actorUserId: number;
    decisionId: string;
    reason: string;
    analysisStatus: string;
    now?: Date;
  }) {
    const db = await requireDb(deps.getDb);
    const now = input.now ?? new Date();
    return db.transaction(async tx => {
      const [admin] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id FROM users
          WHERE id = ${input.actorUserId} AND role = 'admin'
          LIMIT 1 FOR UPDATE
        `)
      );
      if (!admin) throw new Error("billing_admin_required");
      const decisionId = safeText(input.decisionId, 191);
      const reason = safeText(input.reason, 500);
      const analysisStatus = safeText(input.analysisStatus, 120);
      if (!decisionId) {
        throw new Error("billing_capacity_extension_decision_required");
      }
      if (!reason || !analysisStatus) {
        throw new Error("billing_capacity_extension_reason_required");
      }

      // Lock the subscription before resolving the command identity so two
      // actors delivering the same decision concurrently cannot both derive a
      // different post-effect horizon before the duplicate is visible.
      const context = await loadCoverageContext(tx, input.subscriptionId);
      if (!context) throw new Error("billing_capacity_grandfathering_required");
      const decisionHash = crypto
        .createHash("sha256")
        .update(`${input.subscriptionId}:${decisionId}`)
        .digest("hex")
        .slice(0, 40);
      const decisionCorrelationId = `professional-capacity-extension-decision:${decisionHash}`;
      const [existingDecision] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT payloadJson
          FROM billingSubscriptionFacts
          WHERE subscriptionId = ${input.subscriptionId}
            AND factType = 'professional_capacity_extension_granted'
            AND correlationId = ${decisionCorrelationId}
          LIMIT 1
        `)
      );
      if (existingDecision) {
        const payload = jsonObject(existingDecision.payloadJson);
        const persistedDecisionId = safeText(payload.decisionId, 191);
        const persistedReason = safeText(payload.reason, 500);
        const persistedAnalysisStatus = safeText(payload.analysisStatus, 120);
        const persistedActorUserId = Number(payload.actorUserId);
        if (
          persistedDecisionId !== decisionId ||
          persistedReason !== reason ||
          persistedAnalysisStatus !== analysisStatus ||
          persistedActorUserId !== input.actorUserId
        ) {
          throw new Error("billing_capacity_extension_decision_conflict");
        }
        const persistedStartsAt = safeText(payload.startsAt, 64);
        const persistedEndsAt = safeText(payload.endsAt, 64);
        const persistedTemporaryLimit = Number(payload.temporaryLimit);
        if (
          !persistedStartsAt ||
          !persistedEndsAt ||
          !Number.isFinite(persistedTemporaryLimit)
        ) {
          throw new Error("billing_capacity_extension_record_invalid");
        }
        const startsAt = new Date(persistedStartsAt);
        const endsAt = new Date(persistedEndsAt);
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
          throw new Error("billing_capacity_extension_record_invalid");
        }
        return {
          startsAt,
          endsAt,
          temporaryLimit: persistedTemporaryLimit,
        };
      }

      const window = await loadCapacityWindow(tx, input.subscriptionId);
      if (!window || context.occupancy <= context.contractedLimit) {
        throw new Error("billing_capacity_grandfathering_required");
      }
      const startsAt =
        window.endsAt.getTime() > now.getTime() ? window.endsAt : now;
      const endsAt = professionalCapacityExtensionEndsAt(startsAt);
      const key = `${window.windowKey}:extension:${decisionHash}:v2`;
      await appendCoverageFact(tx, {
        context,
        factType: "professional_capacity_extension_granted",
        idempotencyKey: key,
        correlationId: decisionCorrelationId,
        occurredAt: now,
        actionAllowed: "resolve_capacity",
        payload: {
          windowKey: window.windowKey,
          decisionId,
          actorUserId: input.actorUserId,
          reason,
          analysisStatus,
          temporaryLimit: window.temporaryLimit,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
        },
      });
      return { startsAt, endsAt, temporaryLimit: window.temporaryLimit };
    });
  }

  async function listProfessionalCapacityReconciliationIds(limit = 100) {
    const db = await requireDb(deps.getDb);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT s.id
        FROM billingSubscriptions s
        INNER JOIN billingSubscriptionLifecycle l ON l.subscriptionId = s.id
        INNER JOIN billingPlans p ON p.id = s.planId
        WHERE p.audience = 'professional'
          AND l.state IN ('pending', 'active', 'past_due')
          AND (
            EXISTS (
              SELECT 1 FROM billingCapacityAllocations c
              WHERE c.subscriptionId = s.id AND c.state IN ('reserved', 'active')
              GROUP BY c.subscriptionId
              HAVING COUNT(*) > CASE WHEN l.state = 'pending' THEN l.trialCapacityLimit ELSE p.capacityLimit END
            )
            OR EXISTS (
              SELECT 1 FROM billingSubscriptionFacts f
              WHERE f.subscriptionId = s.id
                AND f.factType = 'professional_capacity_grandfathered_started'
            )
          )
        ORDER BY s.updatedAt ASC
        LIMIT ${Math.max(1, Math.min(limit, 500))}
      `)
    );
    return rows.map(row => String(row.id));
  }

  async function listPendingLifecycleFacts(limit = 100) {
    const db = await requireDb(deps.getDb);
    return resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT f.id, f.subscriptionId, f.factType, f.effectiveAt
        FROM billingSubscriptionFacts f
        WHERE f.audience = 'professional'
          AND f.factType IN (
            'coverage_pause_requested',
            'coverage_restore_requested',
            'subscription_expired',
            'cancellation_effective',
            'administrative_termination',
            'contract_confirmed',
            'subscription_recovered'
          )
          AND NOT EXISTS (
            SELECT 1 FROM billingSubscriptionFacts receipt
            WHERE receipt.idempotencyKey = CONCAT('professional-coverage-applied:', f.id, ':v1')
          )
        ORDER BY f.createdAt ASC
        LIMIT ${Math.max(1, Math.min(limit, 500))}
      `)
    ).map(row => ({
      id: String(row.id),
      subscriptionId: String(row.subscriptionId),
      factType: String(row.factType),
      occurredAt: dateValue(row.effectiveAt),
    })) as ProfessionalCoverageLifecycleFact[];
  }

  async function applyLifecycleFact(fact: ProfessionalCoverageLifecycleFact) {
    const db = await requireDb(deps.getDb);
    return db.transaction(async tx => {
      const context = await loadCoverageContext(tx, fact.subscriptionId);
      if (!context) return "missing" as const;
      const receiptKey = `professional-coverage-applied:${fact.id}:v1`;
      const [existingReceipt] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT id FROM billingSubscriptionFacts
          WHERE idempotencyKey = ${receiptKey}
          LIMIT 1
        `)
      );
      if (existingReceipt) return "duplicate" as const;

      let released = 0;
      let transitions = 0;
      if (
        fact.factType === "subscription_expired" ||
        fact.factType === "cancellation_effective" ||
        fact.factType === "administrative_termination"
      ) {
        const allocations = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT c.id, c.patientUserId, c.coverageKey, e.entitlementsJson
            FROM billingCapacityAllocations c
            LEFT JOIN billingEntitlements e
              ON e.sourceType = 'professional_coverage'
              AND e.sourceId = c.coverageKey
            WHERE c.subscriptionId = ${fact.subscriptionId}
              AND c.state IN ('reserved', 'active')
            FOR UPDATE
          `)
        );
        for (const allocation of allocations) {
          const coverageKey = String(allocation.coverageKey);
          const patientUserId = numberValue(allocation.patientUserId);
          await tx.execute(sql`
            UPDATE billingCapacityAllocations
            SET state = 'released', releasedAt = ${fact.occurredAt},
              releaseReason = 'professional_commercial_origin_ended', updatedAt = NOW()
            WHERE id = ${String(allocation.id)}
              AND state IN ('reserved', 'active')
          `);
          await tx.execute(sql`
            UPDATE billingEntitlements
            SET state = 'ended', activeGrantKey = NULL,
              endedAt = ${fact.occurredAt}, updatedAt = NOW()
            WHERE sourceType = 'professional_coverage'
              AND sourceId = ${coverageKey}
              AND state = 'active'
          `);
          released += 1;
          const transition = await grantPatientTransition(tx, {
            patientUserId,
            causeKey: `${fact.id}:${coverageKey}`,
            coverageKey,
            now: fact.occurredAt,
            entitlements: stringArray(allocation.entitlementsJson),
          });
          if (transition.granted) transitions += 1;
        }
      }

      await appendCoverageFact(tx, {
        context,
        factType: "professional_coverage_fact_applied",
        idempotencyKey: receiptKey,
        correlationId: `professional-coverage:${fact.id}`,
        occurredAt: fact.occurredAt,
        payload: {
          sourceFactId: fact.id,
          sourceFactType: fact.factType,
          releasedAllocations: released,
          grantedTransitions: transitions,
          reservationsPreserved:
            fact.factType === "coverage_pause_requested" ||
            fact.factType === "coverage_restore_requested",
        },
      });
      return "applied" as const;
    });
  }

  async function grantTransitionAfterClinicalLoss(input: {
    patientUserId: number;
    coverageKey: string;
    causeKey: string;
    now?: Date;
  }) {
    const db = await requireDb(deps.getDb);
    const now = input.now ?? new Date();
    return db.transaction(async tx => {
      const [coverage] = resultRows<Record<string, unknown>>(
        await tx.execute(sql`
          SELECT entitlementsJson
          FROM billingEntitlements
          WHERE beneficiaryUserId = ${input.patientUserId}
            AND sourceType = 'professional_coverage'
            AND sourceId = ${input.coverageKey}
          ORDER BY createdAt DESC
          LIMIT 1
        `)
      );
      return grantPatientTransition(tx, {
        patientUserId: input.patientUserId,
        causeKey: input.causeKey,
        coverageKey: input.coverageKey,
        now,
        entitlements: stringArray(coverage?.entitlementsJson),
      });
    });
  }

  async function recordIndividualRenewalSync(input: {
    patientUserId: number;
    coverageKey: string;
    status: "requested" | "confirmed" | "pending" | "kept_by_user";
    errorCode?: string | null;
    now?: Date;
  }) {
    const db = await requireDb(deps.getDb);
    const now = input.now ?? new Date();
    const [row] = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT own.id AS subscriptionId, own.provider, own.payerUserId,
          ownPlan.id AS planId, ownPlan.versionCode, ownPlan.billingCycle,
          product.code AS productCode, ownLifecycle.state AS lifecycleState,
          ownPlan.capacityLimit
        FROM billingSubscriptions own
        INNER JOIN billingSubscriptionLifecycle ownLifecycle
          ON ownLifecycle.subscriptionId = own.id
        INNER JOIN billingPlans ownPlan ON ownPlan.id = own.planId
        INNER JOIN billingProducts product ON product.id = ownPlan.productId
        WHERE own.payerUserId = ${input.patientUserId}
          AND ownPlan.audience = 'individual'
          AND ownLifecycle.state IN ('pending', 'active', 'past_due')
        ORDER BY own.updatedAt DESC
        LIMIT 1
      `)
    );
    if (!row) return null;
    const context: CoverageContext = {
      subscriptionId: String(row.subscriptionId),
      professionalUserId: numberValue(row.payerUserId),
      audience: "individual",
      planId: String(row.planId),
      productCode: String(row.productCode),
      versionCode: String(row.versionCode),
      billingCycle: String(row.billingCycle) as CoverageContext["billingCycle"],
      lifecycleState: String(row.lifecycleState) as CoverageContext["lifecycleState"],
      contractedLimit: 0,
      occupancy: 0,
      highestPublicCapacity: null,
    };
    const factType = `professional_coverage_individual_renewal_${input.status}`;
    const idempotencyKey = `${input.coverageKey}:individual-renewal:${context.subscriptionId}:${input.status}:v1`;
    await appendCoverageFact(db, {
      context,
      factType,
      idempotencyKey,
      correlationId: `professional-coverage:${input.coverageKey}`,
      occurredAt: now,
      actionAllowed:
        input.status === "pending" || input.status === "requested"
          ? "sync_cancellation"
          : null,
      payload: {
        coverageKey: input.coverageKey,
        individualSubscriptionId: context.subscriptionId,
        provider: String(row.provider),
        status: input.status,
        errorCode: safeText(input.errorCode, 120),
      },
    });
    return {
      subscriptionId: context.subscriptionId,
      provider: String(row.provider),
      payerUserId: input.patientUserId,
    };
  }

  return {
    reconcileProfessionalCapacity,
    grantCapacityExtension,
    listProfessionalCapacityReconciliationIds,
    listPendingLifecycleFacts,
    applyLifecycleFact,
    grantTransitionAfterClinicalLoss,
    recordIndividualRenewalSync,
  };
}
