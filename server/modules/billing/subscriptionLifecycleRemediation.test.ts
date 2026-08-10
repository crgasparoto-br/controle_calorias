import { describe, expect, it } from "vitest";
import {
  createBillingSubscriptionLifecycleService,
  createTrialIdentityHasher,
  reduceFinancialFact,
} from "./subscriptionLifecycle";
import type {
  BillingContractIntent,
  BillingEarlyConversionConfirmation,
  BillingLifecycleMutation,
  BillingLifecycleRepository,
  BillingLifecycleSnapshot,
  BillingPlanForLifecycle,
  BillingPrepareContractInput,
  BillingPrepareContractResult,
} from "./subscriptionLifecycleTypes";
import type { BillingLifecycleRemediationReadModel } from "../../repositories/billingLifecycleRemediationReadModel";

const DAY_MS = 24 * 60 * 60 * 1000;
const base = new Date("2030-01-01T12:00:00.000Z");
const plusDays = (days: number) => new Date(base.getTime() + days * DAY_MS);

const individualPlan: BillingPlanForLifecycle = {
  id: "plan-individual",
  productCode: "individual",
  versionCode: "individual-v1",
  audience: "individual",
  billingCycle: "monthly",
  currency: "BRL",
  unitAmount: 3990,
  capacityLimit: null,
  entitlements: ["system_access", "web_access"],
  commercialPaymentMethods: ["credit_card", "pix_automatic"],
};
const professionalPlan: BillingPlanForLifecycle = {
  ...individualPlan,
  id: "plan-professional",
  productCode: "professional",
  versionCode: "professional-v1",
  audience: "professional",
  unitAmount: 8990,
  capacityLimit: 30,
};

function snapshot(overrides: Partial<BillingLifecycleSnapshot> = {}): BillingLifecycleSnapshot {
  return {
    subscriptionId: "sub-1",
    payerUserId: 1,
    planId: individualPlan.id,
    productCode: individualPlan.productCode,
    versionCode: individualPlan.versionCode,
    audience: "individual",
    billingCycle: "monthly",
    state: "active",
    revision: 1,
    currentPeriodStart: plusDays(60),
    currentPeriodEnd: plusDays(90),
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    trialEndsAt: null,
    firstChargeAt: null,
    trialCapacityLimit: null,
    graceStartedAt: null,
    graceEndsAt: null,
    suspendedAt: null,
    recoveryEndsAt: null,
    lastAuthoritativeOccurredAt: plusDays(61),
    lastConfirmedCompetenceKey: "2030-03",
    reconciliationRequired: false,
    couponContractKey: null,
    emittedFactKeys: [],
    ...overrides,
  };
}

class MemoryReadModel implements BillingLifecycleRemediationReadModel {
  intents = new Map<string, { payerUserId: number; trialChoice: "request" | "waive" }>();
  historicalTransitions = new Set<number>();
  confirmations = new Map<string, BillingEarlyConversionConfirmation>();
  contractPlans = new Map<string, BillingPlanForLifecycle>();

  async loadContractIntent(contractKey: string) {
    return this.intents.get(contractKey) ?? null;
  }
  async hasHistoricalTransitionAccess(userId: number) {
    return this.historicalTransitions.has(userId);
  }
  async loadDelinquency() {
    return null;
  }
  async loadEarlyConversionConfirmation(subscriptionId: string) {
    return this.confirmations.get(subscriptionId) ?? null;
  }
  async loadContractPlan(subscriptionId: string) {
    return this.contractPlans.get(subscriptionId) ?? null;
  }
}

class MemoryRepository implements BillingLifecycleRepository {
  plans = new Map([
    [individualPlan.versionCode, individualPlan],
    [professionalPlan.versionCode, professionalPlan],
  ]);
  snapshots = new Map<string, BillingLifecycleSnapshot>();
  intents = new Map<string, BillingContractIntent>();
  trialClaims: BillingPrepareContractInput["trialIdentities"] = [];
  serial = 0;

  constructor(private readonly readModel: MemoryReadModel) {}

  async getPlan(versionCode: string) {
    return this.plans.get(versionCode) ?? null;
  }

  async prepareContract(input: BillingPrepareContractInput): Promise<BillingPrepareContractResult> {
    const prior = this.intents.get(input.contractKey);
    if (prior) {
      return {
        ok: true,
        created: false,
        intent: prior,
        snapshot: this.snapshots.get(prior.subscriptionId)!,
      };
    }
    const subscriptionId = `sub-${++this.serial}`;
    const current = snapshot({
      subscriptionId,
      payerUserId: input.payerUserId,
      planId: input.plan.id,
      productCode: input.plan.productCode,
      versionCode: input.plan.versionCode,
      audience: input.plan.audience,
      billingCycle: input.plan.billingCycle,
      state: "pending",
      revision: 0,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      trialStartedAt: input.trialStartedAt,
      trialEndsAt: input.trialEndsAt,
      firstChargeAt: input.firstChargeAt,
      trialCapacityLimit: input.trialCapacityLimit,
      lastAuthoritativeOccurredAt: null,
      lastConfirmedCompetenceKey: null,
      emittedFactKeys: [],
    });
    const intent: BillingContractIntent = {
      id: `intent-${this.serial}`,
      contractKey: input.contractKey,
      subscriptionId,
      payerUserId: input.payerUserId,
      planId: input.plan.id,
      paymentMethod: input.paymentMethod,
      trialChoice: input.trialChoice,
      trialWaivedAt: null,
      couponContractKey: input.couponContractKey,
      state: "pending",
    };
    this.trialClaims.push(...input.trialIdentities);
    this.snapshots.set(subscriptionId, current);
    this.intents.set(input.contractKey, intent);
    this.readModel.intents.set(input.contractKey, {
      payerUserId: input.payerUserId,
      trialChoice: input.trialChoice,
    });
    this.readModel.contractPlans.set(subscriptionId, input.plan);
    return { ok: true, created: true, intent, snapshot: current };
  }

  async loadLifecycle(subscriptionId: string) {
    return this.snapshots.get(subscriptionId) ?? null;
  }

  async commitMutation(input: {
    snapshot: BillingLifecycleSnapshot;
    mutation: BillingLifecycleMutation;
  }) {
    const current = this.snapshots.get(input.snapshot.subscriptionId);
    if (!current || current.revision !== input.mutation.expectedRevision) return "conflict" as const;
    if (input.mutation.audit?.action === "early_conversion_confirmed") {
      const metadata = input.mutation.audit.metadata!;
      this.readModel.confirmations.set(current.subscriptionId, {
        confirmationKey: String(metadata.confirmationKey),
        confirmedAt: new Date(String(metadata.confirmedAt)),
        productCode: String(metadata.productCode),
        versionCode: String(metadata.versionCode),
        billingCycle: metadata.billingCycle as "monthly",
        currency: String(metadata.currency),
        unitAmount: Number(metadata.unitAmount),
        capacityLimit: metadata.capacityLimit == null ? null : Number(metadata.capacityLimit),
        firstChargeAt: new Date(String(metadata.firstChargeAt)),
      });
    }
    this.snapshots.set(current.subscriptionId, {
      ...current,
      ...input.mutation.updates,
      state: input.mutation.nextState,
      revision: current.revision + 1,
      emittedFactKeys: [
        ...current.emittedFactKeys,
        ...input.mutation.facts.map(item => item.idempotencyKey),
      ],
    });
    return "applied" as const;
  }

  async listDueSubscriptionIds() { return []; }
  async cancelCouponReservation() {}
  async recordTrialEligibilityDecision() {}
}

function service() {
  const readModel = new MemoryReadModel();
  const repository = new MemoryRepository(readModel);
  return {
    readModel,
    repository,
    lifecycle: createBillingSubscriptionLifecycleService({
      repository,
      remediationReadModel: readModel,
      hashTrialIdentity: createTrialIdentityHasher("01234567890123456789012345678901"),
      now: () => base,
    }),
  };
}

const verifiedCard = {
  payerUserId: 2,
  providerCode: "fake-provider",
  paymentMethod: "credit_card" as const,
  registrationId: "registered-card",
  verifiedAt: base,
};

describe("subscription lifecycle audit remediations", () => {
  it("makes active migration replace trial and keeps historical migration ineligible", async () => {
    const { lifecycle, readModel, repository } = service();
    readModel.historicalTransitions.add(1);
    const prepared = await lifecycle.startContract({
      contractKey: "migration",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      transitionAccessUntil: plusDays(30),
      correlationId: "migration",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.trialStartedAt).toBeNull();
    expect(prepared.snapshot.trialEndsAt).toBeNull();
    expect(prepared.snapshot.firstChargeAt).toEqual(plusDays(31));
    expect(repository.trialClaims).toHaveLength(0);

    const later = await lifecycle.startContract({
      contractKey: "later-trial",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      verifiedPaymentInstrument: { ...verifiedCard, payerUserId: 1 },
      identity: { userId: 1, cpf: "12345678901", phone: "11999999999" },
      correlationId: "later-trial",
    });
    expect(later).toEqual({ ok: false, reason: "trial_already_used" });
  });

  it("requires backend-verified registered card proof for actual trial", async () => {
    const { lifecycle } = service();
    await expect(lifecycle.startContract({
      contractKey: "missing-card-proof",
      providerCode: "fake-provider",
      payerUserId: 2,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      identity: { userId: 2, cpf: "12345678901", phone: "11999999999" },
      correlationId: "missing-card-proof",
    })).rejects.toThrow("billing_trial_registered_card_required");
  });

  it("ignores old competence failures and old payments instead of regressing current state", () => {
    const oldFailure = reduceFinancialFact(snapshot(), {
      providerCode: "fake-provider",
      providerEventId: "old-failure",
      subscriptionId: "sub-1",
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(70),
      competenceKey: "2030-02",
      currentPeriodStart: plusDays(30),
      currentPeriodEnd: plusDays(60),
      correlationId: "old-failure",
    });
    expect(oldFailure.nextState).toBe("active");
    expect(oldFailure.facts).toHaveLength(0);

    const oldPayment = reduceFinancialFact(snapshot({
      state: "past_due",
      lastConfirmedCompetenceKey: "2030-02",
      graceStartedAt: plusDays(60),
      graceEndsAt: plusDays(67),
      emittedFactKeys: ["sub-1:past_due_entered:2030-03:v1"],
    }), {
      providerCode: "fake-provider",
      providerEventId: "old-payment",
      subscriptionId: "sub-1",
      kind: "payment_confirmed",
      chargePurpose: "renewal",
      occurredAt: plusDays(62),
      competenceKey: "2030-02",
      currentPeriodStart: plusDays(30),
      currentPeriodEnd: plusDays(60),
      correlationId: "old-payment",
    });
    expect(oldPayment.nextState).toBe("past_due");
    expect(oldPayment.facts).toHaveLength(0);
  });

  it("keeps early conversion pending until exact payer-confirmed commercial terms exist", async () => {
    const { lifecycle, repository } = service();
    const prepared = await lifecycle.startContract({
      contractKey: "professional-trial",
      providerCode: "fake-provider",
      payerUserId: 3,
      versionCode: professionalPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      verifiedPaymentInstrument: { ...verifiedCard, payerUserId: 3 },
      identity: { userId: 3, cnpj: "12345678000199", phone: "11988888888" },
      correlationId: "professional-trial",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;

    const unconfirmed = await lifecycle.applyFinancialFact({
      providerCode: "fake-provider",
      providerEventId: "early-unconfirmed",
      subscriptionId: prepared.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "early_conversion",
      occurredAt: plusDays(2),
      competenceKey: "first-paid",
      currentPeriodStart: plusDays(2),
      currentPeriodEnd: plusDays(32),
      commercialConfirmationKey: "confirm-1",
      correlationId: "early-unconfirmed",
    });
    expect(unconfirmed.state).toBe("pending");

    // Existing contracts keep their immutable version terms even if the catalog version
    // later stops accepting new contracts.
    repository.plans.delete(professionalPlan.versionCode);

    await lifecycle.confirmEarlyConversion({
      subscriptionId: prepared.snapshot.subscriptionId,
      actorUserId: 3,
      confirmationKey: "confirm-1",
      productCode: professionalPlan.productCode,
      versionCode: professionalPlan.versionCode,
      billingCycle: professionalPlan.billingCycle,
      currency: professionalPlan.currency,
      unitAmount: professionalPlan.unitAmount,
      capacityLimit: professionalPlan.capacityLimit,
      firstChargeAt: plusDays(2),
    });

    const confirmed = await lifecycle.applyFinancialFact({
      providerCode: "fake-provider",
      providerEventId: "early-confirmed",
      subscriptionId: prepared.snapshot.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "early_conversion",
      occurredAt: plusDays(2),
      competenceKey: "first-paid",
      currentPeriodStart: plusDays(2),
      currentPeriodEnd: plusDays(32),
      commercialConfirmationKey: "confirm-1",
      correlationId: "early-confirmed",
    });
    expect(confirmed.state).toBe("active");
  });
});
