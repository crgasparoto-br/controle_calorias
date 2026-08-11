import crypto from "node:crypto";
import type { BillingPaymentMethod } from "./catalogPolicy";
import type {
  BillingCouponCoordinator,
  BillingLifecycleFact,
  BillingLifecycleFactType,
  BillingLifecycleMutation,
  BillingImmediateTerminationReason,
  BillingLifecycleRepository,
  BillingLifecycleSnapshot,
  BillingPlanForLifecycle,
  BillingProviderNeutralFinancialFact,
  BillingTrialChoice,
  HashedTrialIdentity,
  TrialIdentityInput,
} from "./subscriptionLifecycleTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
export const INDIVIDUAL_TRIAL_DAYS = 7;
export const PROFESSIONAL_TRIAL_DAYS = 14;
export const PROFESSIONAL_TRIAL_CAPACITY = 5;
export const PAST_DUE_GRACE_DAYS = 7;
export const RECOVERY_WINDOW_DAYS = 30;
const PAST_DUE_NOTICE_DAYS = [0, 2, 5, 7] as const;

function addDays(value: Date, days: number) {
  return new Date(value.getTime() + days * DAY_MS);
}

function normalizeDigits(value: string | null | undefined) {
  return (value ?? "").replace(/\D/g, "");
}

export function createTrialIdentityHasher(secret: string) {
  if (secret.length < 32) {
    throw new Error("Billing trial identity hashing requires a secret with at least 32 characters.");
  }
  return (type: string, value: string) =>
    crypto.createHmac("sha256", secret).update(`${type}:${value}`).digest("hex");
}

export function buildTrialIdentityClaims(
  audience: BillingPlanForLifecycle["audience"],
  input: TrialIdentityInput,
  hash: (type: string, value: string) => string
): HashedTrialIdentity[] {
  const phone = normalizeDigits(input.phone);
  if (phone.length < 10 || phone.length > 13) {
    throw new Error("trial_identity_phone_required");
  }
  const cpf = normalizeDigits(input.cpf);
  const cnpj = normalizeDigits(input.cnpj);
  if (audience === "individual" && cpf.length !== 11) {
    throw new Error("trial_identity_document_required");
  }
  if (audience === "professional" && cpf.length !== 11 && cnpj.length !== 14) {
    throw new Error("trial_identity_document_required");
  }

  const claims: Array<[HashedTrialIdentity["type"], string]> = [
    ["user", String(input.userId)],
    ["phone", phone],
  ];
  if (cpf.length === 11) claims.push(["cpf", cpf]);
  if (cnpj.length === 14) claims.push(["cnpj", cnpj]);
  return claims.map(([type, value]) => ({ type, hash: hash(type, value) }));
}

function fact(
  snapshot: BillingLifecycleSnapshot,
  type: BillingLifecycleFactType,
  at: Date,
  nextState: BillingLifecycleSnapshot["state"],
  correlationId: string,
  suffix: string,
  payload: BillingLifecycleFact["payload"] = {},
  actionAllowed: string | null = null
): BillingLifecycleFact {
  return {
    type,
    version: 1,
    idempotencyKey: `${snapshot.subscriptionId}:${type}:${suffix}:v1`,
    subscriptionId: snapshot.subscriptionId,
    payerUserId: snapshot.payerUserId,
    audience: snapshot.audience,
    productCode: snapshot.productCode,
    versionCode: snapshot.versionCode,
    billingCycle: snapshot.billingCycle,
    previousState: snapshot.state,
    newState: nextState,
    occurredAt: at,
    actionAllowed,
    correlationId,
    payload,
  };
}

function hasFact(snapshot: BillingLifecycleSnapshot, candidate: BillingLifecycleFact) {
  return snapshot.emittedFactKeys.includes(candidate.idempotencyKey);
}

function appendFact(snapshot: BillingLifecycleSnapshot, target: BillingLifecycleFact[], candidate: BillingLifecycleFact) {
  if (!hasFact(snapshot, candidate) && !target.some(item => item.idempotencyKey === candidate.idempotencyKey)) target.push(candidate);
}

function noChange(snapshot: BillingLifecycleSnapshot): BillingLifecycleMutation {
  return {
    expectedRevision: snapshot.revision,
    nextState: snapshot.state,
    updates: {},
    facts: [],
    invalidateFactTypes: [],
    endTrialEntitlement: false,
    suspendedReadOnlyUntil: undefined,
    couponAction: "none",
  };
}

function financialOccurredAtUpdate(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact
) {
  if (
    snapshot.lastAuthoritativeOccurredAt &&
    input.occurredAt.getTime() < snapshot.lastAuthoritativeOccurredAt.getTime()
  ) {
    return false;
  }
  return true;
}

export function reduceFinancialFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact
): BillingLifecycleMutation {
  if (input.kind === "authorization_confirmed") return noChange(snapshot);
  if (!financialOccurredAtUpdate(snapshot, input)) return noChange(snapshot);

  const correlation = input.correlationId;
  const competence = input.competenceKey ?? input.providerEventId;
  const baseUpdates: BillingLifecycleMutation["updates"] = {
    lastAuthoritativeOccurredAt: input.occurredAt,
  };

  if (input.kind === "payment_confirmed") {
    if (
      snapshot.state === "pending" &&
      snapshot.firstChargeAt &&
      input.occurredAt.getTime() < snapshot.firstChargeAt.getTime() &&
      input.chargePurpose !== "early_conversion"
    ) {
      return {
        ...noChange(snapshot),
        updates: { ...baseUpdates, reconciliationRequired: true },
        facts: [
          fact(
            snapshot,
            "financial_reconciliation_required",
            input.occurredAt,
            "pending",
            correlation,
            competence,
            { reason: "payment_before_first_charge_at" },
            "contact_support"
          ),
        ],
        audit: {
          action: "financial_reconciliation_required",
          reason: "Payment confirmation arrived before the contract first-charge boundary.",
          metadata: { competenceKey: competence },
        },
      };
    }
    if (snapshot.state === "expired") {
      return {
        ...noChange(snapshot),
        updates: { ...baseUpdates, reconciliationRequired: true },
        facts: [
          fact(snapshot, "late_payment_reconciliation_required", input.occurredAt, "expired", correlation, competence, {}, "contact_support"),
        ],
        audit: {
          action: "late_payment_reconciliation_required",
          reason: "Authoritative payment arrived after subscription expiration.",
          metadata: { competenceKey: competence },
        },
      };
    }
    if (
      snapshot.state === "active" &&
      snapshot.lastConfirmedCompetenceKey === competence
    ) {
      return noChange(snapshot);
    }
    if (
      snapshot.state === "suspended" &&
      snapshot.recoveryEndsAt &&
      input.occurredAt.getTime() >= snapshot.recoveryEndsAt.getTime()
    ) {
      return {
        ...noChange(snapshot),
        updates: { ...baseUpdates, reconciliationRequired: true },
        facts: [
          fact(snapshot, "late_payment_reconciliation_required", input.occurredAt, snapshot.state, correlation, competence, {}, "contact_support"),
        ],
      };
    }

    const wasSuspended = snapshot.state === "suspended";
    const wasPastDue = snapshot.state === "past_due";
    const wasPending = snapshot.state === "pending";
    const firstActivation =
      !snapshot.lastConfirmedCompetenceKey && (wasPending || wasPastDue || wasSuspended);
    const type: BillingLifecycleFactType = firstActivation
      ? "contract_confirmed"
      : wasSuspended
        ? "subscription_recovered"
        : "renewal_confirmed";
    const facts = [
      fact(snapshot, type, input.occurredAt, "active", correlation, competence),
    ];
    if (wasSuspended && snapshot.audience === "professional") {
      facts.push(
        fact(snapshot, "coverage_restore_requested", input.occurredAt, "active", correlation, competence)
      );
    }
    return {
      expectedRevision: snapshot.revision,
      nextState: "active",
      updates: {
        ...baseUpdates,
        currentPeriodStart: input.currentPeriodStart ?? snapshot.currentPeriodStart,
        currentPeriodEnd: input.currentPeriodEnd ?? snapshot.currentPeriodEnd,
        graceStartedAt: null,
        graceEndsAt: null,
        suspendedAt: null,
        recoveryEndsAt: null,
        lastConfirmedCompetenceKey: competence,
        reconciliationRequired: false,
      },
      facts,
      invalidateFactTypes:
        wasPastDue || wasSuspended
          ? [
              "past_due_notice_day_0",
              "past_due_notice_day_2",
              "past_due_notice_day_5",
              "past_due_notice_day_7",
            ]
          : [],
      endTrialEntitlement: wasPending && !!snapshot.trialStartedAt,
      suspendedReadOnlyUntil: wasSuspended ? null : undefined,
      couponAction:
        snapshot.couponContractKey && (wasPending || wasPastDue || wasSuspended)
          ? "confirm"
          : "none",
    };
  }

  if (input.kind === "chargeback_confirmed") {
    return {
      expectedRevision: snapshot.revision,
      nextState: "expired",
      updates: {
        ...baseUpdates,
        recoveryEndsAt: null,
        reconciliationRequired: false,
      },
      facts: [
        fact(snapshot, "administrative_termination", input.occurredAt, "expired", correlation, competence, { reason: "chargeback" }, "contact_support"),
      ],
      invalidateFactTypes: [
        "past_due_notice_day_0",
        "past_due_notice_day_2",
        "past_due_notice_day_5",
        "past_due_notice_day_7",
      ],
      endTrialEntitlement: true,
      suspendedReadOnlyUntil: null,
      couponAction: snapshot.state === "pending" ? "cancel" : "none",
      audit: { action: "administrative_termination", reason: "Confirmed chargeback." },
    };
  }

  if (
    snapshot.state === "active" &&
    (input.kind === "payment_failed" || input.kind === "payment_refused")
  ) {
    if (snapshot.lastConfirmedCompetenceKey === competence) return noChange(snapshot);
    const graceEndsAt = addDays(input.occurredAt, PAST_DUE_GRACE_DAYS);
    return {
      expectedRevision: snapshot.revision,
      nextState: "past_due",
      updates: {
        ...baseUpdates,
        graceStartedAt: input.occurredAt,
        graceEndsAt,
      },
      facts: [
        fact(snapshot, "past_due_entered", input.occurredAt, "past_due", correlation, competence, { graceEndsAt: graceEndsAt.toISOString() }, "update_payment"),
        fact(snapshot, "past_due_notice_day_0", input.occurredAt, "past_due", correlation, `${competence}:0`, { graceEndsAt: graceEndsAt.toISOString() }, "update_payment"),
      ],
      invalidateFactTypes: [],
      endTrialEntitlement: false,
      suspendedReadOnlyUntil: undefined,
      couponAction: "none",
    };
  }

  if (
    snapshot.state === "pending" &&
    (input.kind === "payment_refused" || input.kind === "payment_failed")
  ) {
    const firstChargeDue =
      !!snapshot.trialStartedAt &&
      !!snapshot.firstChargeAt &&
      input.occurredAt.getTime() >= snapshot.firstChargeAt.getTime();
    if (firstChargeDue) {
      const graceEndsAt = addDays(input.occurredAt, PAST_DUE_GRACE_DAYS);
      return {
        expectedRevision: snapshot.revision,
        nextState: "past_due",
        updates: {
          ...baseUpdates,
          graceStartedAt: input.occurredAt,
          graceEndsAt,
        },
        facts: [
          fact(snapshot, "contract_refused", input.occurredAt, "past_due", correlation, competence, {}, "retry_payment"),
          fact(snapshot, "past_due_entered", input.occurredAt, "past_due", correlation, competence, { graceEndsAt: graceEndsAt.toISOString() }, "update_payment"),
          fact(snapshot, "past_due_notice_day_0", input.occurredAt, "past_due", correlation, `${competence}:0`, { graceEndsAt: graceEndsAt.toISOString() }, "update_payment"),
        ],
        invalidateFactTypes: [],
        endTrialEntitlement: true,
        suspendedReadOnlyUntil: undefined,
        couponAction: "none",
      };
    }
    return {
      ...noChange(snapshot),
      updates: baseUpdates,
      facts: [
        fact(snapshot, "contract_refused", input.occurredAt, "pending", correlation, competence, {}, "retry_payment"),
      ],
    };
  }

  if (snapshot.state === "pending" && input.kind === "attempt_expired") {
    return {
      ...noChange(snapshot),
      updates: baseUpdates,
      facts: [
        fact(snapshot, "contract_expired", input.occurredAt, "pending", correlation, competence, {}, "retry_payment"),
      ],
    };
  }

  return { ...noChange(snapshot), updates: baseUpdates };
}

export function reduceLifecycleTick(
  snapshot: BillingLifecycleSnapshot,
  now: Date
): BillingLifecycleMutation {
  const correlation = `clock:${now.toISOString().slice(0, 10)}`;
  const mutation = noChange(snapshot);

  if (snapshot.state === "pending" && snapshot.trialStartedAt && snapshot.trialEndsAt) {
    const endingAt = addDays(snapshot.trialEndsAt, -1);
    if (now.getTime() >= endingAt.getTime() && now.getTime() < snapshot.trialEndsAt.getTime()) {
      appendFact(
        snapshot,
        mutation.facts,
        fact(snapshot, "trial_ending", endingAt, "pending", correlation, snapshot.trialEndsAt.toISOString(), { trialEndsAt: snapshot.trialEndsAt.toISOString() }, "manage_subscription")
      );
    }
    if (snapshot.cancelAtPeriodEnd && now.getTime() >= snapshot.trialEndsAt.getTime()) {
      return {
        ...mutation,
        nextState: "expired",
        updates: { cancelAtPeriodEnd: false },
        facts: [
          ...mutation.facts,
          fact(snapshot, "cancellation_effective", snapshot.trialEndsAt, "expired", correlation, "trial", {}, "new_subscription"),
          fact(snapshot, "subscription_expired", snapshot.trialEndsAt, "expired", correlation, "trial"),
        ],
        endTrialEntitlement: true,
        couponAction: "cancel",
      };
    }
  }

  if (
    snapshot.cancelAtPeriodEnd &&
    snapshot.currentPeriodEnd &&
    now.getTime() >= snapshot.currentPeriodEnd.getTime()
  ) {
    return {
      ...mutation,
      nextState: "expired",
      updates: { cancelAtPeriodEnd: false },
      facts: [
        fact(snapshot, "cancellation_effective", snapshot.currentPeriodEnd, "expired", correlation, "period-end", {}, "new_subscription"),
        fact(snapshot, "subscription_expired", snapshot.currentPeriodEnd, "expired", correlation, "period-end"),
      ],
      endTrialEntitlement: true,
      suspendedReadOnlyUntil: null,
    };
  }

  if (snapshot.state === "past_due" && snapshot.graceStartedAt && snapshot.graceEndsAt) {
    for (const day of PAST_DUE_NOTICE_DAYS.slice(1)) {
      const dueAt = addDays(snapshot.graceStartedAt, day);
      if (now.getTime() >= dueAt.getTime()) {
        appendFact(
          snapshot,
          mutation.facts,
          fact(snapshot, `past_due_notice_day_${day}` as BillingLifecycleFactType, dueAt, "past_due", correlation, `${snapshot.graceStartedAt.toISOString()}:${day}`, { graceEndsAt: snapshot.graceEndsAt.toISOString() }, "update_payment")
        );
      }
    }
    if (now.getTime() >= snapshot.graceEndsAt.getTime()) {
      const recoveryEndsAt = addDays(snapshot.graceEndsAt, RECOVERY_WINDOW_DAYS);
      const facts = [
        ...mutation.facts,
        fact(snapshot, "subscription_suspended", snapshot.graceEndsAt, "suspended", correlation, "suspend", { recoveryEndsAt: recoveryEndsAt.toISOString() }, "update_payment"),
      ];
      if (snapshot.audience === "professional") {
        facts.push(
          fact(snapshot, "coverage_pause_requested", snapshot.graceEndsAt, "suspended", correlation, "coverage-pause", { reservationsPreserved: true })
        );
      }
      return {
        ...mutation,
        nextState: "suspended",
        updates: {
          suspendedAt: snapshot.graceEndsAt,
          recoveryEndsAt,
        },
        facts,
        suspendedReadOnlyUntil: recoveryEndsAt,
      };
    }
    return mutation;
  }

  if (
    snapshot.state === "suspended" &&
    snapshot.recoveryEndsAt &&
    now.getTime() >= snapshot.recoveryEndsAt.getTime()
  ) {
    return {
      ...mutation,
      nextState: "expired",
      updates: {},
      facts: [
        fact(snapshot, "subscription_expired", snapshot.recoveryEndsAt, "expired", correlation, "recovery-window", {}, "new_subscription"),
      ],
      suspendedReadOnlyUntil: null,
    };
  }

  return mutation;
}

function assertPaymentMethod(plan: BillingPlanForLifecycle, method: BillingPaymentMethod) {
  if (!plan.commercialPaymentMethods.includes(method)) {
    throw new Error("billing_payment_method_not_allowed");
  }
}

function trialDates(
  plan: BillingPlanForLifecycle,
  choice: BillingTrialChoice,
  now: Date,
  transitionAccessUntil?: Date | null
) {
  const transitionUntil =
    transitionAccessUntil && transitionAccessUntil.getTime() > now.getTime()
      ? transitionAccessUntil
      : null;
  if (choice !== "request") {
    return {
      startedAt: null,
      endsAt: null,
      firstChargeAt: transitionUntil ? addDays(transitionUntil, 1) : now,
      capacity: null,
    };
  }
  const days =
    plan.audience === "professional"
      ? PROFESSIONAL_TRIAL_DAYS
      : INDIVIDUAL_TRIAL_DAYS;
  const endsAt = addDays(now, days);
  const protectedUntil =
    transitionUntil && transitionUntil.getTime() > endsAt.getTime()
      ? transitionUntil
      : endsAt;
  return {
    startedAt: now,
    endsAt,
    firstChargeAt: addDays(protectedUntil, 1),
    capacity:
      plan.audience === "professional" ? PROFESSIONAL_TRIAL_CAPACITY : null,
  };
}

export function createBillingSubscriptionLifecycleService(deps: {
  repository: BillingLifecycleRepository;
  couponCoordinator?: BillingCouponCoordinator;
  hashTrialIdentity: (type: string, value: string) => string;
  now?: () => Date;
}) {
  const nowProvider = deps.now ?? (() => new Date());

  async function startContract(input: {
    contractKey: string;
    providerCode: string;
    payerUserId: number;
    versionCode: string;
    paymentMethod: BillingPaymentMethod;
    trialChoice: BillingTrialChoice;
    identity?: TrialIdentityInput;
    couponCode?: string | null;
    correlationId: string;
    transitionAccessUntil?: Date | null;
  }) {
    const now = nowProvider();
    const plan = await deps.repository.getPlan(input.versionCode, now);
    if (!plan) throw new Error("billing_plan_not_available");
    assertPaymentMethod(plan, input.paymentMethod);
    if (input.paymentMethod === "pix_automatic" && input.trialChoice !== "waive") {
      throw new Error("pix_automatic_requires_explicit_trial_waiver");
    }
    if (input.paymentMethod === "credit_card" && input.trialChoice === "request" && !input.identity) {
      await deps.repository.recordTrialEligibilityDecision({
        payerUserId: input.payerUserId,
        audience: plan.audience,
        versionCode: plan.versionCode,
        decision: "review_required",
        reason: "trial_identity_required",
        identityTypes: ["user"],
        correlationId: input.correlationId,
      });
      throw new Error("trial_identity_required");
    }

    let trialIdentities: HashedTrialIdentity[] = [];
    if (input.trialChoice === "request" && input.identity) {
      try {
        trialIdentities = buildTrialIdentityClaims(
          plan.audience,
          input.identity,
          deps.hashTrialIdentity
        );
      } catch (error) {
        await deps.repository.recordTrialEligibilityDecision({
          payerUserId: input.payerUserId,
          audience: plan.audience,
          versionCode: plan.versionCode,
          decision: "review_required",
          reason: error instanceof Error ? error.message : "trial_identity_invalid",
          identityTypes: ["user"],
          correlationId: input.correlationId,
        });
        throw error;
      }
    }

    let couponReserved = false;
    if (input.couponCode) {
      if (!deps.couponCoordinator) throw new Error("billing_coupon_coordinator_unavailable");
      const result = await deps.couponCoordinator.reserve({
        userId: input.payerUserId,
        couponCode: input.couponCode,
        versionCode: input.versionCode,
        contractKey: input.contractKey,
      });
      if (!result.reserved) throw new Error(`billing_coupon_${result.reason}`);
      couponReserved = true;
    }

    const trial = trialDates(
      plan,
      input.trialChoice,
      now,
      input.transitionAccessUntil
    );
    try {
      const prepared = await deps.repository.prepareContract({
        contractKey: input.contractKey,
        providerCode: input.providerCode,
        payerUserId: input.payerUserId,
        plan,
        paymentMethod: input.paymentMethod,
        trialChoice: input.trialChoice,
        trialStartedAt: trial.startedAt,
        trialEndsAt: trial.endsAt,
        firstChargeAt: trial.firstChargeAt,
        trialCapacityLimit: trial.capacity,
        trialIdentities,
        couponContractKey: input.couponCode ? input.contractKey : null,
        correlationId: input.correlationId,
        preparedAt: now,
      });
      if (!prepared.ok && couponReserved) {
        await deps.repository.cancelCouponReservation(input.contractKey);
      }
      if (
        prepared.ok &&
        prepared.intent.contractKey !== input.contractKey &&
        couponReserved
      ) {
        await deps.repository.cancelCouponReservation(input.contractKey);
      }
      return prepared;
    } catch (error) {
      if (couponReserved) {
        await deps.repository.cancelCouponReservation(input.contractKey).catch(() => undefined);
      }
      throw error;
    }
  }

  async function applyFinancialFact(input: BillingProviderNeutralFinancialFact) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
      if (!snapshot) throw new Error("billing_subscription_not_found");
      const mutation = reduceFinancialFact(snapshot, input);
      const result = await deps.repository.commitMutation({ snapshot, mutation, financialFact: input });
      if (result === "conflict") continue;
      return { result, state: mutation.nextState };
    }
    throw new Error("billing_lifecycle_concurrent_update");
  }

  async function tickSubscription(subscriptionId: string, now = nowProvider()) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(subscriptionId);
      if (!snapshot) return "missing" as const;
      const mutation = reduceLifecycleTick(snapshot, now);
      if (!mutation.facts.length && mutation.nextState === snapshot.state) return "noop" as const;
      const result = await deps.repository.commitMutation({ snapshot, mutation });
      if (result === "conflict") continue;
      return result;
    }
    throw new Error("billing_lifecycle_concurrent_update");
  }

  async function processDue(limit = 100) {
    const now = nowProvider();
    const ids = await deps.repository.listDueSubscriptionIds(now, limit);
    for (const id of ids) await tickSubscription(id, now);
    return ids.length;
  }

  async function requestCancellation(subscriptionId: string, correlationId: string) {
    const snapshot = await deps.repository.loadLifecycle(subscriptionId);
    if (!snapshot) throw new Error("billing_subscription_not_found");
    if (snapshot.state === "expired") return "noop" as const;
    if (snapshot.cancelAtPeriodEnd) return "noop" as const;
    const now = nowProvider();

    if (
      snapshot.state === "pending" &&
      !snapshot.trialEndsAt &&
      !snapshot.currentPeriodEnd
    ) {
      const mutation: BillingLifecycleMutation = {
        ...noChange(snapshot),
        nextState: "expired",
        facts: [
          fact(snapshot, "cancellation_requested", now, "expired", correlationId, "request", {}, null),
          fact(snapshot, "cancellation_effective", now, "expired", correlationId, "pending-attempt", {}, "new_subscription"),
          fact(snapshot, "subscription_expired", now, "expired", correlationId, "pending-attempt", {}, "new_subscription"),
        ],
        couponAction: "cancel",
        audit: {
          action: "pending_contract_canceled",
          reason: "Subscriber abandoned an unconfirmed contract attempt.",
        },
      };
      return deps.repository.commitMutation({ snapshot, mutation });
    }

    const mutation: BillingLifecycleMutation = {
      ...noChange(snapshot),
      updates: { cancelAtPeriodEnd: true },
      facts: [
        fact(snapshot, "cancellation_requested", now, snapshot.state, correlationId, "request", {}, "reactivate"),
      ],
      audit: { action: "cancellation_requested", reason: "Subscriber disabled automatic renewal." },
    };
    return deps.repository.commitMutation({ snapshot, mutation });
  }

  async function reactivateCancellation(subscriptionId: string, correlationId: string) {
    const snapshot = await deps.repository.loadLifecycle(subscriptionId);
    if (!snapshot) throw new Error("billing_subscription_not_found");
    if (!snapshot.cancelAtPeriodEnd || snapshot.state === "expired") return "noop" as const;
    const now = nowProvider();
    const mutation: BillingLifecycleMutation = {
      ...noChange(snapshot),
      updates: { cancelAtPeriodEnd: false },
      facts: [
        fact(snapshot, "cancellation_reactivated", now, snapshot.state, correlationId, "reactivate", {}, "manage_subscription"),
      ],
      audit: { action: "cancellation_reactivated", reason: "Subscriber re-enabled renewal before period end." },
    };
    return deps.repository.commitMutation({ snapshot, mutation });
  }

  async function extendGrace(input: {
    subscriptionId: string;
    actorUserId: number;
    until: Date;
    reason: string;
    correlationId: string;
  }) {
    const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
    if (!snapshot || snapshot.state !== "past_due") throw new Error("billing_past_due_subscription_required");
    const now = nowProvider();
    if (input.until.getTime() <= now.getTime()) throw new Error("billing_grace_extension_must_be_future");
    const mutation: BillingLifecycleMutation = {
      ...noChange(snapshot),
      updates: { graceEndsAt: input.until },
      facts: [],
      audit: {
        actorUserId: input.actorUserId,
        requireAdmin: true,
        action: "grace_extended",
        reason: input.reason,
        metadata: { previousGraceEndsAt: snapshot.graceEndsAt?.toISOString() ?? null, newGraceEndsAt: input.until.toISOString(), correlationId: input.correlationId },
      },
    };
    return deps.repository.commitMutation({ snapshot, mutation });
  }

  async function terminateImmediately(input: {
    subscriptionId: string;
    actorUserId: number;
    reason: BillingImmediateTerminationReason;
    correlationId: string;
  }) {
    const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
    if (!snapshot) throw new Error("billing_subscription_not_found");
    if (snapshot.state === "expired") return "noop" as const;
    const now = nowProvider();
    const mutation: BillingLifecycleMutation = {
      ...noChange(snapshot),
      nextState: "expired",
      updates: {
        cancelAtPeriodEnd: false,
        graceStartedAt: null,
        graceEndsAt: null,
        recoveryEndsAt: null,
      },
      facts: [
        fact(
          snapshot,
          "administrative_termination",
          now,
          "expired",
          input.correlationId,
          input.reason,
          { reason: input.reason },
          "contact_support"
        ),
        fact(
          snapshot,
          "subscription_expired",
          now,
          "expired",
          input.correlationId,
          `administrative:${input.reason}`,
          {},
          "new_subscription"
        ),
      ],
      invalidateFactTypes: [
        "past_due_notice_day_0",
        "past_due_notice_day_2",
        "past_due_notice_day_5",
        "past_due_notice_day_7",
      ],
      endTrialEntitlement: true,
      suspendedReadOnlyUntil: null,
      couponAction: snapshot.state === "pending" ? "cancel" : "none",
      audit: {
        actorUserId: input.actorUserId,
        requireAdmin: true,
        action: "administrative_termination",
        reason: input.reason,
        metadata: { correlationId: input.correlationId },
      },
    };
    return deps.repository.commitMutation({ snapshot, mutation });
  }

  return {
    startContract,
    applyFinancialFact,
    tickSubscription,
    processDue,
    requestCancellation,
    reactivateCancellation,
    extendGrace,
    terminateImmediately,
  };
}
