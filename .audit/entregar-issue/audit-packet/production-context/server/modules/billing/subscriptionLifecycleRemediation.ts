import type {
  BillingEarlyConversionConfirmation,
  BillingLifecycleFact,
  BillingLifecycleMutation,
  BillingLifecycleSnapshot,
  BillingPlanForLifecycle,
  BillingProviderNeutralFinancialFact,
} from "./subscriptionLifecycleTypes";
import type { BillingDelinquencyContext } from "../../repositories/billingLifecycleRemediationReadModel";

export type BillingFinancialRemediationContext = {
  delinquency: BillingDelinquencyContext | null;
  earlyConversionConfirmation: BillingEarlyConversionConfirmation | null;
  plan: BillingPlanForLifecycle | null;
};

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

function remediationFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  reason: string
): BillingLifecycleFact {
  const competence = input.competenceKey ?? input.providerEventId;
  return {
    type: "financial_reconciliation_required",
    version: 1,
    idempotencyKey: `${snapshot.subscriptionId}:financial_reconciliation_required:${competence}:${reason}:v1`,
    subscriptionId: snapshot.subscriptionId,
    payerUserId: snapshot.payerUserId,
    audience: snapshot.audience,
    productCode: snapshot.productCode,
    versionCode: snapshot.versionCode,
    billingCycle: snapshot.billingCycle,
    previousState: snapshot.state,
    newState: snapshot.state,
    occurredAt: input.occurredAt,
    actionAllowed: "contact_support",
    correlationId: input.correlationId,
    payload: { reason },
  };
}

function reconciliation(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  reason: string
): BillingLifecycleMutation {
  return {
    ...noChange(snapshot),
    updates: { reconciliationRequired: true },
    facts: [remediationFact(snapshot, input, reason)],
    audit: {
      action: "financial_reconciliation_required",
      reason,
      metadata: {
        competenceKey: input.competenceKey ?? null,
        providerEventId: input.providerEventId,
      },
    },
  };
}

function ignore(snapshot: BillingLifecycleSnapshot) {
  return noChange(snapshot);
}

function comparePeriodStart(incoming: Date | null | undefined, current: Date | null) {
  if (!incoming || !current) return null;
  return Math.sign(incoming.getTime() - current.getTime());
}

function guardActiveCompetence(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact
): BillingLifecycleMutation | null {
  if (snapshot.state !== "active") return null;
  if (
    input.kind !== "payment_confirmed" &&
    input.kind !== "payment_failed" &&
    input.kind !== "payment_refused"
  ) {
    return null;
  }
  if (!input.competenceKey || !snapshot.lastConfirmedCompetenceKey) {
    return input.kind === "payment_confirmed" && !snapshot.lastConfirmedCompetenceKey
      ? null
      : reconciliation(snapshot, input, "competence_order_not_demonstrable");
  }
  if (input.competenceKey === snapshot.lastConfirmedCompetenceKey) return null;

  const periodOrder = comparePeriodStart(input.currentPeriodStart, snapshot.currentPeriodStart);
  if (periodOrder === -1) return ignore(snapshot);
  if (periodOrder === 1) return null;
  if (
    !input.currentPeriodStart &&
    snapshot.currentPeriodEnd &&
    input.kind !== "payment_confirmed" &&
    input.occurredAt.getTime() === snapshot.currentPeriodEnd.getTime()
  ) {
    return null;
  }
  return reconciliation(snapshot, input, "competence_order_ambiguous");
}

function delinquencyFromSnapshot(
  snapshot: BillingLifecycleSnapshot
): BillingDelinquencyContext | null {
  const prefix = `${snapshot.subscriptionId}:past_due_entered:`;
  const suffix = ":v1";
  const key = [...snapshot.emittedFactKeys]
    .reverse()
    .find(item => item.startsWith(prefix) && item.endsWith(suffix));
  if (!key) return null;
  return {
    competenceKey: key.slice(prefix.length, -suffix.length) || null,
    periodStart: null,
  };
}

function guardDelinquentPayment(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  delinquency: BillingDelinquencyContext | null
): BillingLifecycleMutation | null {
  if (
    (snapshot.state !== "past_due" && snapshot.state !== "suspended") ||
    input.kind !== "payment_confirmed"
  ) {
    return null;
  }
  const effectiveDelinquency = delinquency ?? delinquencyFromSnapshot(snapshot);
  if (
    !snapshot.lastConfirmedCompetenceKey &&
    input.chargePurpose === "initial" &&
    snapshot.firstChargeAt &&
    input.occurredAt.getTime() >= snapshot.firstChargeAt.getTime()
  ) {
    return null;
  }
  if (!effectiveDelinquency?.competenceKey || !input.competenceKey) {
    return reconciliation(snapshot, input, "delinquent_competence_not_demonstrable");
  }
  if (input.competenceKey === effectiveDelinquency.competenceKey) return null;
  if (
    snapshot.lastConfirmedCompetenceKey &&
    input.competenceKey === snapshot.lastConfirmedCompetenceKey
  ) {
    return ignore(snapshot);
  }
  const periodOrder = comparePeriodStart(input.currentPeriodStart, effectiveDelinquency.periodStart);
  if (periodOrder === -1) return ignore(snapshot);
  return reconciliation(snapshot, input, "payment_does_not_match_delinquent_competence");
}

function guardEarlyConversion(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  confirmation: BillingEarlyConversionConfirmation | null,
  plan: BillingPlanForLifecycle | null
): BillingLifecycleMutation | null {
  if (input.chargePurpose !== "early_conversion") return null;
  if (
    snapshot.state !== "pending" ||
    snapshot.audience !== "professional" ||
    !snapshot.trialStartedAt ||
    !snapshot.trialEndsAt
  ) {
    return reconciliation(snapshot, input, "early_conversion_requires_professional_trial");
  }
  if (!confirmation || !plan) {
    return reconciliation(snapshot, input, "early_conversion_confirmation_missing");
  }
  if (
    !input.commercialConfirmationKey ||
    input.commercialConfirmationKey !== confirmation.confirmationKey ||
    confirmation.productCode !== snapshot.productCode ||
    confirmation.versionCode !== snapshot.versionCode ||
    confirmation.billingCycle !== snapshot.billingCycle ||
    confirmation.productCode !== plan.productCode ||
    confirmation.versionCode !== plan.versionCode ||
    confirmation.billingCycle !== plan.billingCycle ||
    confirmation.currency !== plan.currency ||
    confirmation.unitAmount !== plan.unitAmount ||
    confirmation.capacityLimit !== plan.capacityLimit
  ) {
    return reconciliation(snapshot, input, "early_conversion_terms_mismatch");
  }
  if (
    input.occurredAt.getTime() < confirmation.confirmedAt.getTime() ||
    input.occurredAt.getTime() < confirmation.firstChargeAt.getTime()
  ) {
    return reconciliation(snapshot, input, "early_conversion_before_explicit_confirmation");
  }
  return null;
}

export function guardFinancialFact(
  snapshot: BillingLifecycleSnapshot,
  input: BillingProviderNeutralFinancialFact,
  context: BillingFinancialRemediationContext
): BillingLifecycleMutation | null {
  if (
    snapshot.lastAuthoritativeOccurredAt &&
    input.occurredAt.getTime() < snapshot.lastAuthoritativeOccurredAt.getTime()
  ) {
    return null;
  }
  return (
    guardEarlyConversion(
      snapshot,
      input,
      context.earlyConversionConfirmation,
      context.plan
    ) ??
    guardDelinquentPayment(snapshot, input, context.delinquency) ??
    guardActiveCompetence(snapshot, input)
  );
}

export function enrichPastDueFact(
  mutation: BillingLifecycleMutation,
  input: BillingProviderNeutralFinancialFact
) {
  if (mutation.nextState !== "past_due") return mutation;
  mutation.facts = mutation.facts.map(item =>
    item.type === "past_due_entered"
      ? {
          ...item,
          payload: {
            ...item.payload,
            competenceKey: input.competenceKey ?? null,
            currentPeriodStart: input.currentPeriodStart?.toISOString() ?? null,
            currentPeriodEnd: input.currentPeriodEnd?.toISOString() ?? null,
          },
        }
      : item
  );
  return mutation;
}
