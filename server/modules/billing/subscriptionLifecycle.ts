import * as base from "./subscriptionLifecycleBase";
import type {
  BillingEarlyConversionConfirmation,
  BillingLifecycleFact,
  BillingLifecycleMutation,
  BillingLifecycleSnapshot,
  BillingProviderNeutralFinancialFact,
  BillingTrialIdentityType,
  BillingVerifiedPaymentInstrument,
} from "./subscriptionLifecycleTypes";
import type { BillingLifecycleRemediationReadModel } from "../../repositories/billingLifecycleRemediationReadModel";
import {
  enrichPastDueFact,
  guardFinancialFact,
  type BillingFinancialRemediationContext,
} from "./subscriptionLifecycleRemediation";

export {
  INDIVIDUAL_TRIAL_DAYS,
  PROFESSIONAL_TRIAL_DAYS,
  PROFESSIONAL_TRIAL_CAPACITY,
  PAST_DUE_GRACE_DAYS,
  RECOVERY_WINDOW_DAYS,
  buildTrialIdentityClaims,
  createTrialIdentityHasher,
} from "./subscriptionLifecycleBase";

const DAY_MS = 24 * 60 * 60 * 1000;
type BaseService = ReturnType<typeof base.createBillingSubscriptionLifecycleService>;
type BaseStartContractInput = Parameters<BaseService["startContract"]>[0];
type ServiceDeps = Parameters<typeof base.createBillingSubscriptionLifecycleService>[0] & {
  remediationReadModel?: BillingLifecycleRemediationReadModel;
};

export type BillingStartContractInput = BaseStartContractInput & {
  verifiedPaymentInstrument?: BillingVerifiedPaymentInstrument | null;
};

export type BillingConfirmEarlyConversionInput = {
  subscriptionId: string;
  actorUserId: number;
  confirmationKey: string;
  productCode: string;
  versionCode: string;
  billingCycle: "monthly" | "yearly" | "custom";
  currency: string;
  unitAmount: number;
  capacityLimit: number | null;
  firstChargeAt: Date;
};

function recoveryFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact
): BillingLifecycleFact {
  const competence = input.competenceKey ?? input.providerEventId;
  return {
    type: "subscription_recovered",
    version: 1,
    idempotencyKey: `${snapshot.subscriptionId}:subscription_recovered:${competence}:v1`,
    subscriptionId: snapshot.subscriptionId,
    payerUserId: snapshot.payerUserId,
    audience: snapshot.audience,
    productCode: snapshot.productCode,
    versionCode: snapshot.versionCode,
    billingCycle: snapshot.billingCycle,
    previousState: "suspended",
    newState: "active",
    occurredAt: input.occurredAt,
    actionAllowed: null,
    correlationId: input.correlationId,
    payload: {},
  };
}

function emptyFinancialContext(): BillingFinancialRemediationContext {
  return {
    delinquency: null,
    earlyConversionConfirmation: null,
    plan: null,
  };
}

function invalidateObsoleteTrialEnding(
  snapshot: BillingLifecycleSnapshot,
  mutation: BillingLifecycleMutation
): BillingLifecycleMutation {
  if (
    !snapshot.trialStartedAt ||
    !mutation.endTrialEntitlement ||
    mutation.invalidateFactTypes.includes("trial_ending")
  ) {
    return mutation;
  }
  return {
    ...mutation,
    invalidateFactTypes: [...mutation.invalidateFactTypes, "trial_ending"],
  };
}

export function reduceFinancialFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  context: BillingFinancialRemediationContext = emptyFinancialContext()
): BillingLifecycleMutation {
  const guarded = guardFinancialFact(snapshot, input, context);
  if (guarded) return invalidateObsoleteTrialEnding(snapshot, guarded);

  const mutation = enrichPastDueFact(base.reduceFinancialFact(snapshot, input), input);
  if (
    snapshot.state === "suspended" &&
    input.kind === "payment_confirmed" &&
    mutation.nextState === "active" &&
    !mutation.facts.some(item => item.type === "subscription_recovered")
  ) {
    mutation.facts = [...mutation.facts, recoveryFact(snapshot, input)];
  }
  return invalidateObsoleteTrialEnding(snapshot, mutation);
}

export function reduceLifecycleTick(
  snapshot: BillingLifecycleSnapshot,
  now: Date
): BillingLifecycleMutation {
  const effectiveSnapshot =
    snapshot.state === "past_due" || snapshot.state === "suspended"
      ? { ...snapshot, cancelAtPeriodEnd: false }
      : snapshot;
  return invalidateObsoleteTrialEnding(
    snapshot,
    base.reduceLifecycleTick(effectiveSnapshot, now)
  );
}

function assertVerifiedTrialCard(
  input: BillingStartContractInput,
  now: Date
) {
  const proof = input.verifiedPaymentInstrument;
  if (
    input.paymentMethod !== "credit_card" ||
    !proof ||
    proof.paymentMethod !== "credit_card" ||
    proof.payerUserId !== input.payerUserId ||
    proof.providerCode !== input.providerCode ||
    !proof.registrationId.trim() ||
    proof.verifiedAt.getTime() > now.getTime()
  ) {
    throw new Error("billing_trial_registered_card_required");
  }
}

function sameConfirmation(
  existing: BillingEarlyConversionConfirmation,
  input: BillingConfirmEarlyConversionInput
) {
  return (
    existing.confirmationKey === input.confirmationKey &&
    existing.productCode === input.productCode &&
    existing.versionCode === input.versionCode &&
    existing.billingCycle === input.billingCycle &&
    existing.currency === input.currency &&
    existing.unitAmount === input.unitAmount &&
    existing.capacityLimit === input.capacityLimit &&
    existing.firstChargeAt.getTime() === input.firstChargeAt.getTime()
  );
}

export function createBillingSubscriptionLifecycleService(deps: ServiceDeps) {
  const repository = {
    ...deps.repository,
    commitMutation(input: Parameters<ServiceDeps["repository"]["commitMutation"]>[0]) {
      return deps.repository.commitMutation({
        ...input,
        mutation: invalidateObsoleteTrialEnding(input.snapshot, input.mutation),
      });
    },
  };
  const baseline = base.createBillingSubscriptionLifecycleService({ ...deps, repository });
  const readModel = deps.remediationReadModel;
  const nowProvider = deps.now ?? (() => new Date());

  async function startContract(input: BillingStartContractInput) {
    const { verifiedPaymentInstrument: _proof, ...baseInput } = input;
    const now = nowProvider();
    const existing = await readModel?.loadContractIntent(input.contractKey);
    if (existing) {
      if (existing.payerUserId !== input.payerUserId) {
        throw new Error("billing_contract_key_conflict");
      }
      return baseline.startContract(baseInput);
    }

    if (input.paymentMethod === "pix_automatic" && input.trialChoice === "request") {
      return baseline.startContract(baseInput);
    }

    const transitionIsActive =
      !!input.transitionAccessUntil &&
      input.transitionAccessUntil.getTime() > now.getTime();

    if (
      input.trialChoice === "request" &&
      input.paymentMethod === "credit_card" &&
      transitionIsActive
    ) {
      const plan = await deps.repository.getPlan(input.versionCode, now);
      if (!plan) throw new Error("billing_plan_not_available");
      if (!plan.commercialPaymentMethods.includes(input.paymentMethod)) {
        throw new Error("billing_payment_method_not_allowed");
      }

      let couponReserved = false;
      if (input.couponCode) {
        if (!deps.couponCoordinator) throw new Error("billing_coupon_coordinator_unavailable");
        const reserved = await deps.couponCoordinator.reserve({
          userId: input.payerUserId,
          couponCode: input.couponCode,
          versionCode: input.versionCode,
          contractKey: input.contractKey,
        });
        if (!reserved.reserved) throw new Error(`billing_coupon_${reserved.reason}`);
        couponReserved = true;
      }

      try {
        const prepared = await deps.repository.prepareContract({
          contractKey: input.contractKey,
          providerCode: input.providerCode,
          payerUserId: input.payerUserId,
          plan,
          paymentMethod: input.paymentMethod,
          trialChoice: "request",
          trialStartedAt: null,
          trialEndsAt: null,
          firstChargeAt: new Date(input.transitionAccessUntil!.getTime() + DAY_MS),
          trialCapacityLimit: null,
          trialIdentities: [],
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
        if (prepared.ok && prepared.created) {
          await deps.repository.recordTrialEligibilityDecision({
            payerUserId: input.payerUserId,
            audience: plan.audience,
            versionCode: plan.versionCode,
            decision: "denied",
            reason: "trial_replaced_by_active_transition",
            identityTypes: [] as BillingTrialIdentityType[],
            correlationId: input.correlationId,
          });
        }
        return prepared;
      } catch (error) {
        if (couponReserved) {
          await deps.repository.cancelCouponReservation(input.contractKey).catch(() => undefined);
        }
        throw error;
      }
    }

    if (input.trialChoice === "request") {
      if (await readModel?.hasHistoricalTransitionAccess(input.payerUserId)) {
        const plan = await deps.repository.getPlan(input.versionCode, now);
        if (plan) {
          await deps.repository.recordTrialEligibilityDecision({
            payerUserId: input.payerUserId,
            audience: plan.audience,
            versionCode: plan.versionCode,
            decision: "denied",
            reason: "trial_replaced_by_transition_history",
            identityTypes: [] as BillingTrialIdentityType[],
            correlationId: input.correlationId,
          });
        }
        return { ok: false as const, reason: "trial_already_used" as const };
      }
      assertVerifiedTrialCard(input, now);
    }

    return baseline.startContract(baseInput);
  }

  async function confirmEarlyConversion(input: BillingConfirmEarlyConversionInput) {
    if (!readModel) throw new Error("billing_lifecycle_remediation_read_model_unavailable");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
      if (!snapshot) throw new Error("billing_subscription_not_found");
      if (
        snapshot.state !== "pending" ||
        snapshot.audience !== "professional" ||
        !snapshot.trialStartedAt ||
        !snapshot.trialEndsAt
      ) {
        throw new Error("billing_professional_trial_required");
      }
      if (snapshot.payerUserId !== input.actorUserId) {
        throw new Error("billing_early_conversion_payer_required");
      }
      if (!input.confirmationKey.trim()) {
        throw new Error("billing_early_conversion_confirmation_key_required");
      }
      const now = nowProvider();
      const plan = await readModel.loadContractPlan(input.subscriptionId);
      if (!plan) throw new Error("billing_plan_not_available");
      if (
        input.productCode !== snapshot.productCode ||
        input.versionCode !== snapshot.versionCode ||
        input.billingCycle !== snapshot.billingCycle ||
        input.productCode !== plan.productCode ||
        input.versionCode !== plan.versionCode ||
        input.billingCycle !== plan.billingCycle ||
        input.currency !== plan.currency ||
        input.unitAmount !== plan.unitAmount ||
        input.capacityLimit !== plan.capacityLimit ||
        input.firstChargeAt.getTime() < now.getTime() ||
        input.firstChargeAt.getTime() >= snapshot.trialEndsAt.getTime()
      ) {
        throw new Error("billing_early_conversion_terms_mismatch");
      }

      const existing = await readModel.loadEarlyConversionConfirmation(input.subscriptionId);
      if (existing && sameConfirmation(existing, input)) return "noop" as const;

      const mutation: BillingLifecycleMutation = {
        expectedRevision: snapshot.revision,
        nextState: snapshot.state,
        updates: {},
        facts: [],
        invalidateFactTypes: [],
        endTrialEntitlement: false,
        suspendedReadOnlyUntil: undefined,
        couponAction: "none",
        audit: {
          actorUserId: input.actorUserId,
          action: "early_conversion_confirmed",
          reason: "Professional trial early conversion terms explicitly confirmed by payer.",
          metadata: {
            confirmationKey: input.confirmationKey,
            confirmedAt: now.toISOString(),
            productCode: input.productCode,
            versionCode: input.versionCode,
            billingCycle: input.billingCycle,
            currency: input.currency,
            unitAmount: input.unitAmount,
            capacityLimit: input.capacityLimit,
            firstChargeAt: input.firstChargeAt.toISOString(),
          },
        },
      };
      const result = await repository.commitMutation({ snapshot, mutation });
      if (result === "conflict") continue;
      return result;
    }
    throw new Error("billing_lifecycle_concurrent_update");
  }

  async function applyFinancialFact(input: BillingProviderNeutralFinancialFact) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
      if (!snapshot) throw new Error("billing_subscription_not_found");
      const context: BillingFinancialRemediationContext = {
        delinquency:
          snapshot.state === "past_due" || snapshot.state === "suspended"
            ? (await readModel?.loadDelinquency(input.subscriptionId)) ?? null
            : null,
        earlyConversionConfirmation:
          input.chargePurpose === "early_conversion"
            ? (await readModel?.loadEarlyConversionConfirmation(input.subscriptionId)) ?? null
            : null,
        plan:
          input.chargePurpose === "early_conversion"
            ? (await readModel?.loadContractPlan(input.subscriptionId)) ?? null
            : null,
      };
      const mutation = reduceFinancialFact(snapshot, input, context);
      const result = await repository.commitMutation({
        snapshot,
        mutation,
        financialFact: input,
      });
      if (result === "conflict") continue;
      return { result, state: mutation.nextState };
    }
    throw new Error("billing_lifecycle_concurrent_update");
  }

  async function tickSubscription(
    subscriptionId: string,
    now = nowProvider()
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(subscriptionId);
      if (!snapshot) return "missing" as const;
      const mutation = reduceLifecycleTick(snapshot, now);
      if (!mutation.facts.length && mutation.nextState === snapshot.state) {
        return "noop" as const;
      }
      const result = await repository.commitMutation({ snapshot, mutation });
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

  return {
    ...baseline,
    startContract,
    confirmEarlyConversion,
    applyFinancialFact,
    tickSubscription,
    processDue,
  };
}
