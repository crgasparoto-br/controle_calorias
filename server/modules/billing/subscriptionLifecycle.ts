import * as base from "./subscriptionLifecycleBase";
import type {
  BillingLifecycleFact,
  BillingLifecycleMutation,
  BillingLifecycleSnapshot,
  BillingProviderNeutralFinancialFact,
} from "./subscriptionLifecycleTypes";

export {
  INDIVIDUAL_TRIAL_DAYS,
  PROFESSIONAL_TRIAL_DAYS,
  PROFESSIONAL_TRIAL_CAPACITY,
  PAST_DUE_GRACE_DAYS,
  RECOVERY_WINDOW_DAYS,
  buildTrialIdentityClaims,
  createTrialIdentityHasher,
} from "./subscriptionLifecycleBase";

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

export function reduceFinancialFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact
): BillingLifecycleMutation {
  const mutation = base.reduceFinancialFact(snapshot, input);
  if (
    snapshot.state === "suspended" &&
    input.kind === "payment_confirmed" &&
    mutation.nextState === "active" &&
    !mutation.facts.some(item => item.type === "subscription_recovered")
  ) {
    mutation.facts = [...mutation.facts, recoveryFact(snapshot, input)];
  }
  return mutation;
}

export function reduceLifecycleTick(
  snapshot: BillingLifecycleSnapshot,
  now: Date
): BillingLifecycleMutation {
  const effectiveSnapshot =
    snapshot.state === "past_due" || snapshot.state === "suspended"
      ? { ...snapshot, cancelAtPeriodEnd: false }
      : snapshot;
  return base.reduceLifecycleTick(effectiveSnapshot, now);
}

export function createBillingSubscriptionLifecycleService(
  deps: Parameters<typeof base.createBillingSubscriptionLifecycleService>[0]
) {
  const baseline = base.createBillingSubscriptionLifecycleService(deps);

  async function applyFinancialFact(input: BillingProviderNeutralFinancialFact) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(input.subscriptionId);
      if (!snapshot) throw new Error("billing_subscription_not_found");
      const mutation = reduceFinancialFact(snapshot, input);
      const result = await deps.repository.commitMutation({
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
    now = deps.now?.() ?? new Date()
  ) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const snapshot = await deps.repository.loadLifecycle(subscriptionId);
      if (!snapshot) return "missing" as const;
      const mutation = reduceLifecycleTick(snapshot, now);
      if (!mutation.facts.length && mutation.nextState === snapshot.state) {
        return "noop" as const;
      }
      const result = await deps.repository.commitMutation({ snapshot, mutation });
      if (result === "conflict") continue;
      return result;
    }
    throw new Error("billing_lifecycle_concurrent_update");
  }

  async function processDue(limit = 100) {
    const now = deps.now?.() ?? new Date();
    const ids = await deps.repository.listDueSubscriptionIds(now, limit);
    for (const id of ids) await tickSubscription(id, now);
    return ids.length;
  }

  return {
    ...baseline,
    applyFinancialFact,
    tickSubscription,
    processDue,
  };
}
