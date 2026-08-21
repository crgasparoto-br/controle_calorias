import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { normalizeCommercialPaymentMethods } from "../modules/billing/catalogPolicy";
import type {
  BillingContractIntent,
  BillingLifecycleFact,
  BillingLifecycleMutation,
  BillingLifecycleRepository,
  BillingLifecycleSnapshot,
  BillingPlanForLifecycle,
  BillingPrepareContractInput,
  BillingPrepareContractResult,
  BillingProviderNeutralFinancialFact,
} from "../modules/billing/subscriptionLifecycleTypes";
import {
  dateOrNull,
  isDuplicateEntryError,
  numberValue,
  requireDb,
  resultRows,
  stringArray,
  type BillingRepositoryDeps,
  type SqlExecutor,
} from "./billingRepositorySupport";

function mapPlan(row: Record<string, unknown>): BillingPlanForLifecycle {
  return {
    id: String(row.id),
    productCode: String(row.productCode),
    versionCode: String(row.versionCode),
    audience: row.audience as BillingPlanForLifecycle["audience"],
    billingCycle: row.billingCycle as BillingPlanForLifecycle["billingCycle"],
    currency: String(row.currency),
    unitAmount: numberValue(row.unitAmount),
    capacityLimit: row.capacityLimit == null ? null : numberValue(row.capacityLimit),
    entitlements: stringArray(row.entitlementsJson),
    commercialPaymentMethods: normalizeCommercialPaymentMethods(
      stringArray(row.commercialPaymentMethodsJson)
    ),
  };
}

async function loadPlan(
  executor: SqlExecutor,
  versionCode: string,
  at: Date,
  lock = false
): Promise<BillingPlanForLifecycle | null> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const [row] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT p.id, p.versionCode, p.audience, p.billingCycle, p.currency,
        p.unitAmount, p.capacityLimit, p.entitlementsJson,
        p.commercialPaymentMethodsJson, pr.code AS productCode
      FROM billingPlans p
      INNER JOIN billingProducts pr ON pr.id = p.productId
      WHERE p.versionCode = ${versionCode}
        AND p.status = 'active'
        AND p.active = true
        AND pr.state = 'active'
        AND p.effectiveFrom <= ${at}
        AND (p.effectiveUntil IS NULL OR p.effectiveUntil > ${at})
      LIMIT 1${suffix}
    `)
  );
  return row ? mapPlan(row) : null;
}

function mapIntent(row: Record<string, unknown>): BillingContractIntent {
  return {
    id: String(row.intentId ?? row.id),
    contractKey: String(row.contractKey),
    subscriptionId: String(row.subscriptionId),
    payerUserId: numberValue(row.payerUserId),
    planId: String(row.planId),
    paymentMethod: row.paymentMethod as BillingContractIntent["paymentMethod"],
    trialChoice: row.trialChoice as BillingContractIntent["trialChoice"],
    trialWaivedAt: dateOrNull(row.trialWaivedAt),
    couponContractKey:
      row.couponContractKey == null ? null : String(row.couponContractKey),
    state: row.intentState as BillingContractIntent["state"],
  };
}

async function loadSnapshot(
  executor: SqlExecutor,
  subscriptionId: string,
  lock = false
): Promise<BillingLifecycleSnapshot | null> {
  const suffix = lock ? sql` FOR UPDATE` : sql``;
  const [row] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT s.id AS subscriptionId, s.payerUserId, s.planId,
        s.currentPeriodStart, s.currentPeriodEnd, s.cancelAtPeriodEnd,
        l.audience, l.state, l.revision, l.trialStartedAt, l.trialEndsAt,
        l.firstChargeAt, l.trialCapacityLimit, l.graceStartedAt, l.graceEndsAt,
        l.suspendedAt, l.recoveryEndsAt, l.lastAuthoritativeOccurredAt,
        l.lastConfirmedCompetenceKey, l.reconciliationRequired,
        p.versionCode, p.billingCycle, pr.code AS productCode,
        i.couponContractKey
      FROM billingSubscriptionLifecycle l
      INNER JOIN billingSubscriptions s ON s.id = l.subscriptionId
      INNER JOIN billingPlans p ON p.id = s.planId
      INNER JOIN billingProducts pr ON pr.id = p.productId
      LEFT JOIN billingContractIntents i ON i.subscriptionId = s.id
      WHERE s.id = ${subscriptionId}
      LIMIT 1${suffix}
    `)
  );
  if (!row) return null;
  const emittedFactKeys = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT idempotencyKey
      FROM billingSubscriptionFacts
      WHERE subscriptionId = ${subscriptionId}
      ORDER BY createdAt ASC
    `)
  ).map(item => String(item.idempotencyKey));
  return {
    subscriptionId: String(row.subscriptionId),
    payerUserId: numberValue(row.payerUserId),
    planId: String(row.planId),
    productCode: String(row.productCode),
    versionCode: String(row.versionCode),
    audience: row.audience as BillingLifecycleSnapshot["audience"],
    billingCycle: row.billingCycle as BillingLifecycleSnapshot["billingCycle"],
    state: row.state as BillingLifecycleSnapshot["state"],
    revision: numberValue(row.revision),
    currentPeriodStart: dateOrNull(row.currentPeriodStart),
    currentPeriodEnd: dateOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
    trialStartedAt: dateOrNull(row.trialStartedAt),
    trialEndsAt: dateOrNull(row.trialEndsAt),
    firstChargeAt: dateOrNull(row.firstChargeAt),
    trialCapacityLimit:
      row.trialCapacityLimit == null ? null : numberValue(row.trialCapacityLimit),
    graceStartedAt: dateOrNull(row.graceStartedAt),
    graceEndsAt: dateOrNull(row.graceEndsAt),
    suspendedAt: dateOrNull(row.suspendedAt),
    recoveryEndsAt: dateOrNull(row.recoveryEndsAt),
    lastAuthoritativeOccurredAt: dateOrNull(row.lastAuthoritativeOccurredAt),
    lastConfirmedCompetenceKey:
      row.lastConfirmedCompetenceKey == null
        ? null
        : String(row.lastConfirmedCompetenceKey),
    reconciliationRequired: Boolean(row.reconciliationRequired),
    couponContractKey:
      row.couponContractKey == null ? null : String(row.couponContractKey),
    emittedFactKeys,
  };
}

async function insertFact(executor: SqlExecutor, input: BillingLifecycleFact) {
  const id = crypto.randomUUID();
  await executor.execute(sql`
    INSERT IGNORE INTO billingSubscriptionFacts (
      id, subscriptionId, payerUserId, factType, factVersion, idempotencyKey,
      correlationId, audience, productCode, versionCode, billingCycle,
      previousState, newState, actionAllowed, effectiveAt, payloadJson, createdAt
    ) VALUES (
      ${id}, ${input.subscriptionId}, ${input.payerUserId}, ${input.type},
      ${input.version}, ${input.idempotencyKey}, ${input.correlationId},
      ${input.audience}, ${input.productCode}, ${input.versionCode},
      ${input.billingCycle}, ${input.previousState}, ${input.newState},
      ${input.actionAllowed}, ${input.occurredAt},
      ${JSON.stringify(input.payload)}, NOW()
    )
  `);
  return id;
}

async function insertTrialAudit(
  executor: SqlExecutor,
  input: {
    payerUserId: number;
    audience: BillingLifecycleSnapshot["audience"];
    versionCode: string;
    decision: "allowed" | "denied" | "review_required";
    reason: string;
    identityTypes: string[];
    correlationId: string;
  }
) {
  await executor.execute(sql`
    INSERT INTO billingTrialEligibilityAuditEvents (
      id, payerUserId, audience, versionCode, decision, reason,
      identityTypesJson, correlationId, createdAt
    ) VALUES (
      ${crypto.randomUUID()}, ${input.payerUserId}, ${input.audience},
      ${input.versionCode}, ${input.decision}, ${input.reason},
      ${JSON.stringify(Array.from(new Set(input.identityTypes)).sort())},
      ${input.correlationId}, NOW()
    )
  `);
}

function initialFact(
  input: BillingPrepareContractInput,
  subscriptionId: string,
  type: "contract_pending" | "trial_started",
  suffix: string,
  payload: BillingLifecycleFact["payload"],
  actionAllowed: string | null
): BillingLifecycleFact {
  return {
    type,
    version: 1,
    idempotencyKey: `${subscriptionId}:${type}:${suffix}:v1`,
    subscriptionId,
    payerUserId: input.payerUserId,
    audience: input.plan.audience,
    productCode: input.plan.productCode,
    versionCode: input.plan.versionCode,
    billingCycle: input.plan.billingCycle,
    previousState: "pending",
    newState: "pending",
    occurredAt: input.preparedAt,
    actionAllowed,
    correlationId: input.correlationId,
    payload,
  };
}

function mergeSnapshot(
  snapshot: BillingLifecycleSnapshot,
  mutation: BillingLifecycleMutation
): BillingLifecycleSnapshot {
  return {
    ...snapshot,
    ...mutation.updates,
    state: mutation.nextState,
    revision: snapshot.revision + 1,
  };
}

function compatibilityStatus(state: BillingLifecycleSnapshot["state"]) {
  if (state === "suspended") return "past_due" as const;
  return state;
}

export function createBillingSubscriptionLifecycleRepository(
  deps: BillingRepositoryDeps
): BillingLifecycleRepository {
  async function getPlan(versionCode: string, at: Date) {
    const db = await requireDb(deps.getDb);
    return loadPlan(db, versionCode, at);
  }

  async function recordTrialEligibilityDecision(input: {
    payerUserId: number;
    audience: BillingLifecycleSnapshot["audience"];
    versionCode: string;
    decision: "allowed" | "denied" | "review_required";
    reason: string;
    identityTypes: Array<"user" | "cpf" | "cnpj" | "phone">;
    correlationId: string;
  }) {
    const db = await requireDb(deps.getDb);
    await db.transaction(tx => insertTrialAudit(tx, input));
  }

  async function prepareContract(
    input: BillingPrepareContractInput
  ): Promise<BillingPrepareContractResult> {
    const db = await requireDb(deps.getDb);
    try {
      return await db.transaction(async tx => {
        const [user] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`SELECT id FROM users WHERE id = ${input.payerUserId} LIMIT 1 FOR UPDATE`)
        );
        if (!user) throw new Error("billing_payer_not_found");

        const plan = await loadPlan(tx, input.plan.versionCode, input.preparedAt, true);
        if (!plan || plan.id !== input.plan.id) throw new Error("billing_plan_not_available");
        if (!plan.commercialPaymentMethods.includes(input.paymentMethod)) {
          throw new Error("billing_payment_method_not_allowed");
        }

        const [byKey] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT id AS intentId, contractKey, subscriptionId, payerUserId, planId,
              paymentMethod, trialChoice, trialWaivedAt, couponContractKey,
              state AS intentState
            FROM billingContractIntents
            WHERE contractKey = ${input.contractKey}
            LIMIT 1 FOR UPDATE
          `)
        );
        if (byKey) {
          let intent = mapIntent(byKey);
          let snapshot = await loadSnapshot(tx, intent.subscriptionId, true);
          if (!snapshot) throw new Error("billing_subscription_not_found");
          if (intent.state === "pending") {
            if (input.paymentMethod === "pix_automatic" && input.trialChoice !== "waive") {
              throw new Error("pix_automatic_requires_explicit_trial_waiver");
            }
            if (
              intent.couponContractKey &&
              input.couponContractKey &&
              intent.couponContractKey !== input.couponContractKey
            ) {
              throw new Error("billing_coupon_contract_key_conflict");
            }
            const waiveExistingTrial =
              input.paymentMethod === "pix_automatic" && !!snapshot.trialStartedAt;
            await tx.execute(sql`
              UPDATE billingContractIntents
              SET paymentMethod = ${input.paymentMethod},
                trialChoice = ${waiveExistingTrial ? "waive" : intent.trialChoice},
                trialWaivedAt = ${waiveExistingTrial || input.trialChoice === "waive" ? input.preparedAt : intent.trialWaivedAt},
                couponContractKey = ${intent.couponContractKey ?? input.couponContractKey},
                updatedAt = NOW()
              WHERE id = ${intent.id}
            `);
            if (waiveExistingTrial) {
              await tx.execute(sql`
                UPDATE billingSubscriptionLifecycle
                SET trialStartedAt = NULL, trialEndsAt = NULL, firstChargeAt = NULL,
                  trialCapacityLimit = NULL, revision = revision + 1, updatedAt = NOW()
                WHERE subscriptionId = ${intent.subscriptionId}
              `);
              await tx.execute(sql`
                UPDATE billingEntitlements
                SET state = 'ended', activeGrantKey = NULL, endedAt = NOW(), updatedAt = NOW()
                WHERE sourceType = 'trial' AND sourceId = ${intent.subscriptionId}
                  AND state = 'active'
              `);
            }
            const [updatedIntent] = resultRows<Record<string, unknown>>(
              await tx.execute(sql`
                SELECT id AS intentId, contractKey, subscriptionId, payerUserId,
                  planId, paymentMethod, trialChoice, trialWaivedAt,
                  couponContractKey, state AS intentState
                FROM billingContractIntents WHERE id = ${intent.id} LIMIT 1
              `)
            );
            intent = mapIntent(updatedIntent);
            snapshot = (await loadSnapshot(tx, intent.subscriptionId, true)) ?? snapshot;
          }
          return { ok: true, created: false, intent, snapshot };
        }

        const [existing] = resultRows<Record<string, unknown>>(
          await tx.execute(sql`
            SELECT i.id AS intentId, i.contractKey, i.subscriptionId, i.payerUserId,
              i.planId, i.paymentMethod, i.trialChoice, i.trialWaivedAt,
              i.couponContractKey, i.state AS intentState
            FROM billingContractIntents i
            INNER JOIN billingPlans p ON p.id = i.planId
            INNER JOIN billingProducts pr ON pr.id = p.productId
            WHERE i.payerUserId = ${input.payerUserId}
              AND pr.code = ${input.plan.productCode}
              AND i.state IN ('pending', 'confirmed')
            ORDER BY i.updatedAt DESC
            LIMIT 1 FOR UPDATE
          `)
        );
        if (existing) {
          const intent = mapIntent(existing);
          const snapshot = await loadSnapshot(tx, intent.subscriptionId, true);
          if (!snapshot) throw new Error("billing_subscription_not_found");
          return { ok: true, created: false, intent, snapshot };
        }

        for (const identity of input.trialIdentities) {
          const [claimed] = resultRows<Record<string, unknown>>(
            await tx.execute(sql`
              SELECT id
              FROM billingTrialIdentityClaims
              WHERE audience = ${input.plan.audience}
                AND identityType = ${identity.type}
                AND identityHash = ${identity.hash}
              LIMIT 1 FOR UPDATE
            `)
          );
          if (claimed) {
            await insertTrialAudit(tx, {
              payerUserId: input.payerUserId,
              audience: input.plan.audience,
              versionCode: input.plan.versionCode,
              decision: "review_required",
              reason: "trial_identity_already_claimed",
              identityTypes: input.trialIdentities.map(item => item.type),
              correlationId: input.correlationId,
            });
            return { ok: false, reason: "trial_already_used" };
          }
        }

        const subscriptionId = crypto.randomUUID();
        const intentId = crypto.randomUUID();
        const activeHolderPlanKey = `lifecycle:${input.payerUserId}:${input.plan.productCode}`;
        await tx.execute(sql`
          INSERT INTO billingSubscriptions (
            id, provider, payerUserId, planId, status, activeHolderPlanKey,
            cancelAtPeriodEnd, createdAt, updatedAt
          ) VALUES (
            ${subscriptionId}, ${input.providerCode}, ${input.payerUserId},
            ${input.plan.id}, 'pending', ${activeHolderPlanKey}, false, NOW(), NOW()
          )
        `);
        await tx.execute(sql`
          INSERT INTO billingSubscriptionLifecycle (
            subscriptionId, audience, state, revision, trialStartedAt, trialEndsAt,
            firstChargeAt, trialCapacityLimit, reconciliationRequired, createdAt, updatedAt
          ) VALUES (
            ${subscriptionId}, ${input.plan.audience}, 'pending', 0,
            ${input.trialStartedAt}, ${input.trialEndsAt}, ${input.firstChargeAt},
            ${input.trialCapacityLimit}, false, NOW(), NOW()
          )
        `);
        await tx.execute(sql`
          INSERT INTO billingContractIntents (
            id, contractKey, subscriptionId, payerUserId, planId, provider,
            paymentMethod, trialChoice, trialWaivedAt, couponContractKey, state,
            createdAt, updatedAt
          ) VALUES (
            ${intentId}, ${input.contractKey}, ${subscriptionId}, ${input.payerUserId},
            ${input.plan.id}, ${input.providerCode}, ${input.paymentMethod},
            ${input.trialChoice},
            ${input.trialChoice === "waive" ? input.preparedAt : null},
            ${input.couponContractKey}, 'pending', NOW(), NOW()
          )
        `);

        for (const identity of input.trialIdentities) {
          await tx.execute(sql`
            INSERT INTO billingTrialIdentityClaims (
              id, subscriptionId, audience, identityType, identityHash, claimedAt
            ) VALUES (
              ${crypto.randomUUID()}, ${subscriptionId}, ${input.plan.audience},
              ${identity.type}, ${identity.hash}, ${input.preparedAt}
            )
          `);
        }

        if (input.trialStartedAt && input.trialEndsAt) {
          await tx.execute(sql`
            INSERT INTO billingEntitlements (
              id, beneficiaryUserId, sourceType, sourceId, planId, state,
              activeGrantKey, entitlementsJson, validFrom, validUntil, createdAt, updatedAt
            ) VALUES (
              ${crypto.randomUUID()}, ${input.payerUserId}, 'trial', ${subscriptionId},
              ${input.plan.id}, 'active', ${`trial:${subscriptionId}`},
              ${JSON.stringify(input.plan.entitlements)}, ${input.trialStartedAt},
              ${input.trialEndsAt}, NOW(), NOW()
            )
          `);
          await insertTrialAudit(tx, {
            payerUserId: input.payerUserId,
            audience: input.plan.audience,
            versionCode: input.plan.versionCode,
            decision: "allowed",
            reason: "trial_identity_claims_reserved",
            identityTypes: input.trialIdentities.map(item => item.type),
            correlationId: input.correlationId,
          });
        }

        await insertFact(
          tx,
          initialFact(
            input,
            subscriptionId,
            "contract_pending",
            input.contractKey,
            { trialWaived: input.trialChoice === "waive" },
            "complete_payment"
          )
        );
        if (input.trialStartedAt && input.trialEndsAt) {
          await insertFact(
            tx,
            initialFact(
              input,
              subscriptionId,
              "trial_started",
              input.trialStartedAt.toISOString(),
              {
                trialEndsAt: input.trialEndsAt.toISOString(),
                firstChargeAt: input.firstChargeAt?.toISOString() ?? null,
                trialCapacityLimit: input.trialCapacityLimit,
              },
              "manage_subscription"
            )
          );
        }

        const snapshot = await loadSnapshot(tx, subscriptionId, true);
        if (!snapshot) throw new Error("billing_subscription_not_found");
        const intent: BillingContractIntent = {
          id: intentId,
          contractKey: input.contractKey,
          subscriptionId,
          payerUserId: input.payerUserId,
          planId: input.plan.id,
          paymentMethod: input.paymentMethod,
          trialChoice: input.trialChoice,
          trialWaivedAt: input.trialChoice === "waive" ? input.preparedAt : null,
          couponContractKey: input.couponContractKey,
          state: "pending",
        };
        return { ok: true, created: true, intent, snapshot };
      });
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const existingDb = await requireDb(deps.getDb);
      const [existing] = resultRows<Record<string, unknown>>(
        await existingDb.execute(sql`
          SELECT id AS intentId, contractKey, subscriptionId, payerUserId, planId,
            paymentMethod, trialChoice, trialWaivedAt, couponContractKey,
            state AS intentState
          FROM billingContractIntents
          WHERE contractKey = ${input.contractKey}
          LIMIT 1
        `)
      );
      if (existing) {
        const intent = mapIntent(existing);
        const snapshot = await loadSnapshot(existingDb, intent.subscriptionId);
        if (!snapshot) throw error;
        return { ok: true, created: false, intent, snapshot };
      }
      await recordTrialEligibilityDecision({
        payerUserId: input.payerUserId,
        audience: input.plan.audience,
        versionCode: input.plan.versionCode,
        decision: "review_required",
        reason: "trial_identity_concurrent_collision",
        identityTypes: input.trialIdentities.map(item => item.type),
        correlationId: input.correlationId,
      });
      return { ok: false, reason: "trial_identity_conflict" };
    }
  }

  async function loadLifecycle(subscriptionId: string) {
    const db = await requireDb(deps.getDb);
    return loadSnapshot(db, subscriptionId);
  }

  async function commitMutation(input: {
    snapshot: BillingLifecycleSnapshot;
    mutation: BillingLifecycleMutation;
    financialFact?: BillingProviderNeutralFinancialFact;
  }) {
    const db = await requireDb(deps.getDb);
    try {
      return await db.transaction(async tx => {
        const current = await loadSnapshot(tx, input.snapshot.subscriptionId, true);
        if (!current) throw new Error("billing_subscription_not_found");
        if (
          current.revision !== input.mutation.expectedRevision ||
          current.state !== input.snapshot.state
        ) {
          return "conflict" as const;
        }

        if (input.mutation.audit?.requireAdmin) {
          if (!input.mutation.audit.actorUserId) {
            throw new Error("billing_admin_actor_required");
          }
          const [adminActor] = resultRows<Record<string, unknown>>(
            await tx.execute(sql`
              SELECT role FROM users
              WHERE id = ${input.mutation.audit.actorUserId}
              LIMIT 1 FOR UPDATE
            `)
          );
          if (!adminActor || String(adminActor.role) !== "admin") {
            throw new Error("billing_admin_authorization_changed");
          }
        }

        if (input.financialFact) {
          const [existingEvent] = resultRows<Record<string, unknown>>(
            await tx.execute(sql`
              SELECT id FROM billingProviderEvents
              WHERE provider = ${input.financialFact.providerCode}
                AND providerEventId = ${input.financialFact.providerEventId}
              LIMIT 1 FOR UPDATE
            `)
          );
          if (existingEvent) return "duplicate" as const;
          const eventStatus =
            input.mutation.nextState !== current.state ||
            Object.keys(input.mutation.updates).length > 0 ||
            input.mutation.facts.length > 0 ||
            input.mutation.invalidateFactTypes.length > 0 ||
            input.mutation.endTrialEntitlement ||
            input.mutation.suspendedReadOnlyUntil !== undefined ||
            input.mutation.couponAction !== "none" ||
            !!input.mutation.audit
              ? "processed"
              : "ignored";
          await tx.execute(sql`
            INSERT INTO billingProviderEvents (
              id, provider, providerEventId, eventType, status, subscriptionId,
              occurredAt, processedAt, payloadJson, createdAt, updatedAt
            ) VALUES (
              ${crypto.randomUUID()}, ${input.financialFact.providerCode},
              ${input.financialFact.providerEventId}, ${`lifecycle:${input.financialFact.kind}`},
              ${eventStatus}, ${current.subscriptionId}, ${input.financialFact.occurredAt},
              NOW(), ${JSON.stringify({
                competenceKey: input.financialFact.competenceKey ?? null,
                chargePurpose: input.financialFact.chargePurpose ?? null,
                correlationId: input.financialFact.correlationId,
              })}, NOW(), NOW()
            )
          `);
        }

        const next = mergeSnapshot(current, input.mutation);
        const reconciliationReason = next.reconciliationRequired
          ? "late_or_inconsistent_financial_confirmation"
          : null;
        await tx.execute(sql`
          UPDATE billingSubscriptionLifecycle
          SET state = ${next.state}, revision = ${next.revision},
            trialStartedAt = ${next.trialStartedAt}, trialEndsAt = ${next.trialEndsAt},
            firstChargeAt = ${next.firstChargeAt}, trialCapacityLimit = ${next.trialCapacityLimit},
            graceStartedAt = ${next.graceStartedAt}, graceEndsAt = ${next.graceEndsAt},
            suspendedAt = ${next.suspendedAt}, recoveryEndsAt = ${next.recoveryEndsAt},
            lastAuthoritativeOccurredAt = ${next.lastAuthoritativeOccurredAt},
            lastConfirmedCompetenceKey = ${next.lastConfirmedCompetenceKey},
            reconciliationRequired = ${next.reconciliationRequired},
            reconciliationReason = ${reconciliationReason}, updatedAt = NOW()
          WHERE subscriptionId = ${current.subscriptionId}
            AND revision = ${current.revision}
        `);

        const compatibility = compatibilityStatus(next.state);
        await tx.execute(sql`
          UPDATE billingSubscriptions
          SET status = ${compatibility}, currentPeriodStart = ${next.currentPeriodStart},
            currentPeriodEnd = ${next.currentPeriodEnd},
            cancelAtPeriodEnd = ${next.cancelAtPeriodEnd},
            activeHolderPlanKey = ${next.state === "expired" ? null : `lifecycle:${next.payerUserId}:${next.productCode}`},
            endedAt = ${next.state === "expired" ? new Date() : null}, updatedAt = NOW()
          WHERE id = ${current.subscriptionId}
        `);

        if (next.state === "active") {
          await tx.execute(sql`
            UPDATE billingContractIntents
            SET state = 'confirmed', updatedAt = NOW()
            WHERE subscriptionId = ${current.subscriptionId} AND state = 'pending'
          `);
        } else if (next.state === "expired") {
          await tx.execute(sql`
            UPDATE billingContractIntents
            SET state = 'expired', updatedAt = NOW()
            WHERE subscriptionId = ${current.subscriptionId}
          `);
        }

        if (input.mutation.endTrialEntitlement) {
          await tx.execute(sql`
            UPDATE billingEntitlements
            SET state = 'ended', activeGrantKey = NULL, endedAt = NOW(), updatedAt = NOW()
            WHERE sourceType = 'trial' AND sourceId = ${current.subscriptionId}
              AND state = 'active'
          `);
        }

        if (input.mutation.suspendedReadOnlyUntil !== undefined) {
          if (input.mutation.suspendedReadOnlyUntil === null) {
            await tx.execute(sql`
              UPDATE billingEntitlements
              SET state = 'ended', activeGrantKey = NULL, endedAt = NOW(), updatedAt = NOW()
              WHERE sourceType = 'read_only'
                AND sourceId = ${`suspension:${current.subscriptionId}`}
                AND state = 'active'
            `);
          } else {
            const [existingReadOnly] = resultRows<Record<string, unknown>>(
              await tx.execute(sql`
                SELECT id FROM billingEntitlements
                WHERE sourceType = 'read_only'
                  AND sourceId = ${`suspension:${current.subscriptionId}`}
                  AND state = 'active'
                LIMIT 1 FOR UPDATE
              `)
            );
            if (!existingReadOnly) {
              await tx.execute(sql`
                INSERT INTO billingEntitlements (
                  id, beneficiaryUserId, sourceType, sourceId, planId, state,
                  activeGrantKey, entitlementsJson, validFrom, validUntil, createdAt, updatedAt
                ) VALUES (
                  ${crypto.randomUUID()}, ${current.payerUserId}, 'read_only',
                  ${`suspension:${current.subscriptionId}`}, ${current.planId}, 'active',
                  ${`read-only:${current.subscriptionId}`},
                  ${JSON.stringify(["system_access", "web_access", "reports"])},
                  NOW(), ${input.mutation.suspendedReadOnlyUntil}, NOW(), NOW()
                )
              `);
            }
          }
        }

        if (current.couponContractKey && input.mutation.couponAction !== "none") {
          const couponState = input.mutation.couponAction === "confirm" ? "confirmed" : "canceled";
          await tx.execute(sql`
            UPDATE billingCouponRedemptions
            SET state = ${couponState},
              confirmedAt = ${couponState === "confirmed" ? new Date() : null},
              canceledAt = ${couponState === "canceled" ? new Date() : null},
              updatedAt = NOW()
            WHERE contractKey = ${current.couponContractKey}
              AND state = 'reserved'
          `);
        }

        const newFactIds: string[] = [];
        for (const lifecycleFact of input.mutation.facts) {
          newFactIds.push(await insertFact(tx, lifecycleFact));
        }
        for (const factType of input.mutation.invalidateFactTypes) {
          await tx.execute(sql`
            UPDATE billingSubscriptionFacts
            SET invalidatedAt = NOW(), invalidatedByFactId = ${newFactIds[0] ?? null}
            WHERE subscriptionId = ${current.subscriptionId}
              AND factType = ${factType}
              AND invalidatedAt IS NULL
          `);
        }

        if (input.mutation.audit) {
          await tx.execute(sql`
            INSERT INTO billingSubscriptionLifecycleAuditEvents (
              id, subscriptionId, actorUserId, action, reason, metadataJson,
              occurredAt, createdAt
            ) VALUES (
              ${crypto.randomUUID()}, ${current.subscriptionId},
              ${input.mutation.audit.actorUserId ?? null}, ${input.mutation.audit.action},
              ${input.mutation.audit.reason},
              ${input.mutation.audit.metadata ? JSON.stringify(input.mutation.audit.metadata) : null},
              NOW(), NOW()
            )
          `);
        }

        return "applied" as const;
      });
    } catch (error) {
      if (input.financialFact && isDuplicateEntryError(error)) return "duplicate" as const;
      throw error;
    }
  }

  async function listDueSubscriptionIds(now: Date, limit: number) {
    const db = await requireDb(deps.getDb);
    const rows = resultRows<Record<string, unknown>>(
      await db.execute(sql`
        SELECT l.subscriptionId
        FROM billingSubscriptionLifecycle l
        INNER JOIN billingSubscriptions s ON s.id = l.subscriptionId
        WHERE
          (l.state = 'pending' AND l.trialEndsAt IS NOT NULL
            AND DATE_SUB(l.trialEndsAt, INTERVAL 1 DAY) <= ${now})
          OR (l.state = 'past_due' AND l.graceStartedAt IS NOT NULL)
          OR (l.state = 'suspended' AND l.recoveryEndsAt IS NOT NULL
            AND l.recoveryEndsAt <= ${now})
          OR (s.cancelAtPeriodEnd = true AND s.currentPeriodEnd IS NOT NULL
            AND s.currentPeriodEnd <= ${now})
        ORDER BY COALESCE(l.graceEndsAt, l.recoveryEndsAt, l.trialEndsAt, s.currentPeriodEnd) ASC
        LIMIT ${limit}
      `)
    );
    return rows.map(row => String(row.subscriptionId));
  }

  async function cancelCouponReservation(contractKey: string) {
    const db = await requireDb(deps.getDb);
    await db.transaction(async tx => {
      await tx.execute(sql`
        UPDATE billingCouponRedemptions
        SET state = 'canceled', canceledAt = NOW(), updatedAt = NOW()
        WHERE contractKey = ${contractKey} AND state = 'reserved'
      `);
    });
  }

  return {
    getPlan,
    prepareContract,
    loadLifecycle,
    commitMutation,
    listDueSubscriptionIds,
    cancelCouponReservation,
    recordTrialEligibilityDecision,
  };
}
