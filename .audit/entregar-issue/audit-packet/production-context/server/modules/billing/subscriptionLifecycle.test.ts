import { describe, expect, it } from "vitest";
import {
  createBillingSubscriptionLifecycleService,
  createTrialIdentityHasher,
  reduceFinancialFact,
  reduceLifecycleTick,
} from "./subscriptionLifecycle";
import type {
  BillingContractIntent,
  BillingLifecycleFact,
  BillingLifecycleMutation,
  BillingLifecycleRepository,
  BillingLifecycleSnapshot,
  BillingPlanForLifecycle,
  BillingPrepareContractInput,
  BillingPrepareContractResult,
} from "./subscriptionLifecycleTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const base = new Date("2026-08-09T12:00:00.000Z");
const plusDays = (days: number) => new Date(base.getTime() + days * DAY_MS);

function snapshot(
  overrides: Partial<BillingLifecycleSnapshot> = {}
): BillingLifecycleSnapshot {
  return {
    subscriptionId: "sub-1",
    payerUserId: 1,
    planId: "plan-1",
    productCode: "individual",
    versionCode: "individual-monthly-v1",
    audience: "individual",
    billingCycle: "monthly",
    state: "pending",
    revision: 0,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    trialEndsAt: null,
    firstChargeAt: null,
    trialCapacityLimit: null,
    graceStartedAt: null,
    graceEndsAt: null,
    suspendedAt: null,
    recoveryEndsAt: null,
    lastAuthoritativeOccurredAt: null,
    lastConfirmedCompetenceKey: null,
    reconciliationRequired: false,
    couponContractKey: null,
    emittedFactKeys: [],
    ...overrides,
  };
}

const individualPlan: BillingPlanForLifecycle = {
  id: "plan-1",
  productCode: "individual",
  versionCode: "individual-monthly-v1",
  audience: "individual",
  billingCycle: "monthly",
  currency: "BRL",
  unitAmount: 3990,
  capacityLimit: null,
  entitlements: ["system_access", "web_access"],
  commercialPaymentMethods: ["credit_card", "pix_automatic"],
};

class MemoryRepository implements BillingLifecycleRepository {
  plans = new Map([[individualPlan.versionCode, individualPlan]]);
  snapshots = new Map<string, BillingLifecycleSnapshot>();
  intents = new Map<string, BillingContractIntent>();
  facts: BillingLifecycleFact[] = [];
  financialEvents = new Set<string>();
  trialClaims = new Set<string>();
  canceledCoupons: string[] = [];
  trialDecisions: string[] = [];
  serial = 1;

  async getPlan(versionCode: string) {
    return this.plans.get(versionCode) ?? null;
  }

  async prepareContract(
    input: BillingPrepareContractInput
  ): Promise<BillingPrepareContractResult> {
    const existing = this.intents.get(input.contractKey);
    if (existing) {
      return {
        ok: true,
        created: false,
        intent: existing,
        snapshot: this.snapshots.get(existing.subscriptionId)!,
      };
    }
    for (const identity of input.trialIdentities) {
      const key = `${input.plan.audience}:${identity.type}:${identity.hash}`;
      if (this.trialClaims.has(key)) {
        return { ok: false, reason: "trial_already_used" };
      }
    }
    const subscriptionId = `sub-${this.serial++}`;
    for (const identity of input.trialIdentities) {
      this.trialClaims.add(
        `${input.plan.audience}:${identity.type}:${identity.hash}`
      );
    }
    const intent: BillingContractIntent = {
      id: `intent-${this.serial}`,
      contractKey: input.contractKey,
      subscriptionId,
      payerUserId: input.payerUserId,
      planId: input.plan.id,
      paymentMethod: input.paymentMethod,
      trialChoice: input.trialChoice,
      trialWaivedAt:
        input.trialChoice === "waive" ? input.preparedAt : null,
      couponContractKey: input.couponContractKey,
      state: "pending",
    };
    const current = snapshot({
      subscriptionId,
      payerUserId: input.payerUserId,
      trialStartedAt: input.trialStartedAt,
      trialEndsAt: input.trialEndsAt,
      firstChargeAt: input.firstChargeAt,
      trialCapacityLimit: input.trialCapacityLimit,
      couponContractKey: input.couponContractKey,
    });
    this.intents.set(input.contractKey, intent);
    this.snapshots.set(subscriptionId, current);
    return { ok: true, created: true, intent, snapshot: current };
  }

  async loadLifecycle(subscriptionId: string) {
    return this.snapshots.get(subscriptionId) ?? null;
  }

  async commitMutation(input: {
    snapshot: BillingLifecycleSnapshot;
    mutation: BillingLifecycleMutation;
    financialFact?: { providerEventId: string };
  }) {
    const current = this.snapshots.get(input.snapshot.subscriptionId);
    if (!current || current.revision !== input.mutation.expectedRevision) {
      return "conflict" as const;
    }
    if (input.financialFact) {
      if (this.financialEvents.has(input.financialFact.providerEventId)) {
        return "duplicate" as const;
      }
      this.financialEvents.add(input.financialFact.providerEventId);
    }
    for (const fact of input.mutation.facts) {
      if (!current.emittedFactKeys.includes(fact.idempotencyKey)) {
        this.facts.push(fact);
      }
    }
    this.snapshots.set(current.subscriptionId, {
      ...current,
      ...input.mutation.updates,
      state: input.mutation.nextState,
      revision: current.revision + 1,
      emittedFactKeys: Array.from(
        new Set([
          ...current.emittedFactKeys,
          ...input.mutation.facts.map(item => item.idempotencyKey),
        ])
      ),
    });
    return "applied" as const;
  }

  async listDueSubscriptionIds() {
    return [...this.snapshots.keys()];
  }

  async cancelCouponReservation(contractKey: string) {
    this.canceledCoupons.push(contractKey);
  }

  async recordTrialEligibilityDecision(input: { reason: string }) {
    this.trialDecisions.push(input.reason);
  }
}

function service(repository = new MemoryRepository()) {
  return {
    repository,
    lifecycle: createBillingSubscriptionLifecycleService({
      repository,
      now: () => base,
      hashTrialIdentity: createTrialIdentityHasher(
        "01234567890123456789012345678901"
      ),
      couponCoordinator: {
        reserve: async () => ({ reserved: true as const }),
      },
    }),
  };
}

describe("billing subscription lifecycle", () => {
  it("requires an explicit Pix trial waiver and never grants a Pix trial", async () => {
    const { lifecycle } = service();
    await expect(
      lifecycle.startContract({
        contractKey: "pix-with-trial",
        providerCode: "fake-provider",
        payerUserId: 1,
        versionCode: individualPlan.versionCode,
        paymentMethod: "pix_automatic",
        trialChoice: "request",
        identity: { userId: 1, cpf: "12345678901", phone: "11999999999" },
        correlationId: "pix-with-trial",
      })
    ).rejects.toThrow("pix_automatic_requires_explicit_trial_waiver");

    const prepared = await lifecycle.startContract({
      contractKey: "pix-waived",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "pix_automatic",
      trialChoice: "waive",
      correlationId: "pix-waived",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    expect(prepared.snapshot.trialStartedAt).toBeNull();
    expect(prepared.snapshot.firstChargeAt).toEqual(base);
    expect(prepared.intent.trialWaivedAt).toEqual(base);
  });

  it("blocks trial replay by stable hashed identity", async () => {
    const { lifecycle } = service();
    const first = await lifecycle.startContract({
      contractKey: "first-trial",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      verifiedPaymentInstrument: {
        payerUserId: 1,
        providerCode: "fake-provider",
        paymentMethod: "credit_card",
        registrationId: "registered-card",
        verifiedAt: base,
      },
      identity: {
        userId: 1,
        cpf: "123.456.789-01",
        phone: "+55 (11) 99999-9999",
      },
      correlationId: "first-trial",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.snapshot.trialEndsAt).toEqual(plusDays(7));
    expect(first.snapshot.firstChargeAt).toEqual(plusDays(8));

    const second = await lifecycle.startContract({
      contractKey: "second-account",
      providerCode: "fake-provider",
      payerUserId: 2,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "request",
      verifiedPaymentInstrument: {
        payerUserId: 2,
        providerCode: "fake-provider",
        paymentMethod: "credit_card",
        registrationId: "registered-card",
        verifiedAt: base,
      },
      identity: {
        userId: 2,
        cpf: "12345678901",
        phone: "11988888888",
      },
      correlationId: "second-account",
    });
    expect(second).toEqual({ ok: false, reason: "trial_already_used" });
  });

  it("is idempotent, ignores stale failures and moves through grace, suspension and recovery", async () => {
    const current = snapshot({
      state: "active",
      revision: 2,
      currentPeriodStart: plusDays(8),
      currentPeriodEnd: plusDays(38),
      lastAuthoritativeOccurredAt: plusDays(8),
      lastConfirmedCompetenceKey: "2026-08",
    });
    const stale = reduceFinancialFact(current, {
      providerCode: "fake-provider",
      providerEventId: "stale-failure",
      subscriptionId: current.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(7),
      competenceKey: "2026-09",
      correlationId: "stale-failure",
    });
    expect(stale.nextState).toBe("active");
    expect(stale.facts).toHaveLength(0);

    const failed = reduceFinancialFact(current, {
      providerCode: "fake-provider",
      providerEventId: "renewal-failed",
      subscriptionId: current.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "renewal",
      occurredAt: plusDays(38),
      competenceKey: "2026-09",
      correlationId: "renewal-failed",
    });
    expect(failed.nextState).toBe("past_due");
    expect(failed.facts.map(item => item.type)).toContain("past_due_notice_day_0");

    const pastDue = snapshot({
      ...current,
      state: "past_due",
      revision: 3,
      graceStartedAt: plusDays(38),
      graceEndsAt: plusDays(45),
      lastAuthoritativeOccurredAt: plusDays(38),
      emittedFactKeys: failed.facts.map(item => item.idempotencyKey),
    });
    const suspended = reduceLifecycleTick(pastDue, plusDays(45));
    expect(suspended.nextState).toBe("suspended");
    expect(suspended.facts.map(item => item.type)).toEqual(
      expect.arrayContaining([
        "past_due_notice_day_2",
        "past_due_notice_day_5",
        "past_due_notice_day_7",
        "subscription_suspended",
      ])
    );

    const recovered = reduceFinancialFact(
      snapshot({
        ...pastDue,
        state: "suspended",
        revision: 4,
        suspendedAt: plusDays(45),
        recoveryEndsAt: plusDays(75),
      }),
      {
        providerCode: "fake-provider",
        providerEventId: "recovered",
        subscriptionId: current.subscriptionId,
        kind: "payment_confirmed",
        chargePurpose: "recovery",
        occurredAt: plusDays(50),
        competenceKey: "2026-09",
        currentPeriodStart: plusDays(50),
        currentPeriodEnd: plusDays(80),
        correlationId: "recovered",
      }
    );
    expect(recovered.nextState).toBe("active");
    expect(recovered.facts.map(item => item.type)).toContain(
      "subscription_recovered"
    );
  });

  it("expires after the recovery window and never auto-reactivates from a late payment", () => {
    const suspended = snapshot({
      state: "suspended",
      suspendedAt: plusDays(45),
      recoveryEndsAt: plusDays(75),
    });
    const expired = reduceLifecycleTick(suspended, plusDays(75));
    expect(expired.nextState).toBe("expired");

    const late = reduceFinancialFact(
      snapshot({ ...suspended, state: "expired" }),
      {
        providerCode: "fake-provider",
        providerEventId: "late-payment",
        subscriptionId: suspended.subscriptionId,
        kind: "payment_confirmed",
        chargePurpose: "recovery",
        occurredAt: plusDays(76),
        competenceKey: "2026-09",
        correlationId: "late-payment",
      }
    );
    expect(late.nextState).toBe("expired");
    expect(late.updates.reconciliationRequired).toBe(true);
    expect(late.facts[0]?.type).toBe("late_payment_reconciliation_required");
  });

  it("keeps provider and communication facts provider-neutral and privacy-minimized", () => {
    const professional = snapshot({
      audience: "professional",
      productCode: "professional",
      state: "past_due",
      graceStartedAt: plusDays(38),
      graceEndsAt: plusDays(45),
    });
    const transition = reduceLifecycleTick(professional, plusDays(45));
    expect(transition.facts.map(item => item.type)).toContain(
      "coverage_pause_requested"
    );
    const serialized = JSON.stringify(transition.facts).toLowerCase();
    expect(serialized).not.toContain("asaas");
    expect(serialized).not.toContain("credit_card");
    expect(serialized).not.toContain("pix_automatic");
    expect(serialized).not.toMatch(/amount|card_number|cvv/);
  });

  it("moves an unpaid first post-trial charge into grace without consuming the coupon", () => {
    const trial = snapshot({
      state: "pending",
      trialStartedAt: base,
      trialEndsAt: plusDays(7),
      firstChargeAt: plusDays(8),
      couponContractKey: "contract-with-coupon",
    });
    const failed = reduceFinancialFact(trial, {
      providerCode: "fake-provider",
      providerEventId: "first-charge-failed",
      subscriptionId: trial.subscriptionId,
      kind: "payment_failed",
      chargePurpose: "initial",
      occurredAt: plusDays(8),
      competenceKey: "2026-08",
      correlationId: "first-charge-failed",
    });
    expect(failed.nextState).toBe("past_due");
    expect(failed.couponAction).toBe("none");
    expect(failed.endTrialEntitlement).toBe(true);
    expect(failed.facts.map(item => item.type)).toEqual(
      expect.arrayContaining([
        "contract_refused",
        "past_due_entered",
        "past_due_notice_day_0",
      ])
    );

    const recovered = reduceFinancialFact(
      snapshot({
        ...trial,
        state: "past_due",
        graceStartedAt: plusDays(8),
        graceEndsAt: plusDays(15),
      }),
      {
        providerCode: "fake-provider",
        providerEventId: "first-charge-retry-ok",
        subscriptionId: trial.subscriptionId,
        kind: "payment_confirmed",
        chargePurpose: "initial",
        occurredAt: plusDays(9),
        competenceKey: "2026-08",
        correlationId: "first-charge-retry-ok",
      }
    );
    expect(recovered.nextState).toBe("active");
    expect(recovered.facts[0]?.type).toBe("contract_confirmed");
    expect(recovered.couponAction).toBe("confirm");
  });

  it("cancels an unconfirmed no-trial attempt immediately and supports strict admin termination", async () => {
    const { lifecycle, repository } = service();
    const prepared = await lifecycle.startContract({
      contractKey: "waived-attempt",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "waive",
      correlationId: "waived-attempt",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    await lifecycle.requestCancellation(
      prepared.snapshot.subscriptionId,
      "cancel-unconfirmed"
    );
    expect(
      repository.snapshots.get(prepared.snapshot.subscriptionId)?.state
    ).toBe("expired");

    const active = snapshot({
      subscriptionId: "admin-termination",
      state: "active",
      revision: 4,
    });
    repository.snapshots.set(active.subscriptionId, active);
    await lifecycle.terminateImmediately({
      subscriptionId: active.subscriptionId,
      actorUserId: 99,
      reason: "security_risk",
      correlationId: "admin-stop",
    });
    expect(repository.snapshots.get(active.subscriptionId)?.state).toBe(
      "expired"
    );
    expect(repository.facts.map(item => item.type)).toContain(
      "administrative_termination"
    );
  });

  it("accepts provider-neutral facts from a deterministic fake provider", async () => {
    const { lifecycle } = service();
    const prepared = await lifecycle.startContract({
      contractKey: "fake-provider-contract",
      providerCode: "fake-provider",
      payerUserId: 1,
      versionCode: individualPlan.versionCode,
      paymentMethod: "credit_card",
      trialChoice: "waive",
      correlationId: "fake-provider-contract",
    });
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) return;
    const subscriptionId = prepared.snapshot.subscriptionId;

    class FakeProvider {
      sequence = 0;
      confirm(at: Date) {
        this.sequence += 1;
        return {
          providerCode: "fake-provider",
          providerEventId: `fake-confirm-${this.sequence}`,
          subscriptionId,
          kind: "payment_confirmed" as const,
          chargePurpose: "initial" as const,
          occurredAt: at,
          competenceKey: "2026-08",
          currentPeriodStart: at,
          currentPeriodEnd: plusDays(30),
          correlationId: `fake-confirm-${this.sequence}`,
        };
      }
    }

    const fake = new FakeProvider();
    const result = await lifecycle.applyFinancialFact(fake.confirm(base));
    expect(result.state).toBe("active");
  });
});
