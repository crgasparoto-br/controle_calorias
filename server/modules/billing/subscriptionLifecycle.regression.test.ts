import { describe, expect, it } from "vitest";
import {
  reduceFinancialFact,
  reduceLifecycleTick,
} from "./subscriptionLifecycle";
import type { BillingLifecycleSnapshot } from "./subscriptionLifecycleTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const base = new Date("2026-08-09T12:00:00.000Z");
const plusDays = (days: number) => new Date(base.getTime() + days * DAY_MS);

function snapshot(
  overrides: Partial<BillingLifecycleSnapshot> = {}
): BillingLifecycleSnapshot {
  return {
    subscriptionId: "sub-regression",
    payerUserId: 1,
    planId: "plan-1",
    productCode: "individual",
    versionCode: "individual-monthly-v1",
    audience: "individual",
    billingCycle: "monthly",
    state: "active",
    revision: 3,
    currentPeriodStart: base,
    currentPeriodEnd: plusDays(30),
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

describe("subscription lifecycle regressions", () => {
  it("emits recovery even when the suspended subscription never had a prior paid competence", () => {
    const suspended = snapshot({
      state: "suspended",
      currentPeriodStart: null,
      currentPeriodEnd: null,
      suspendedAt: plusDays(15),
      recoveryEndsAt: plusDays(45),
      lastConfirmedCompetenceKey: null,
    });

    const mutation = reduceFinancialFact(suspended, {
      providerCode: "fake-provider",
      providerEventId: "recovery-first-payment",
      subscriptionId: suspended.subscriptionId,
      kind: "payment_confirmed",
      chargePurpose: "recovery",
      occurredAt: plusDays(20),
      competenceKey: "2026-08",
      currentPeriodStart: plusDays(20),
      currentPeriodEnd: plusDays(50),
      correlationId: "recovery-first-payment",
    });

    expect(mutation.nextState).toBe("active");
    expect(mutation.facts.map(item => item.type)).toEqual(
      expect.arrayContaining(["contract_confirmed", "subscription_recovered"])
    );
  });

  it("does not let a scheduled cancellation truncate an active past-due grace window", () => {
    const pastDue = snapshot({
      state: "past_due",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: plusDays(30),
      graceStartedAt: plusDays(30),
      graceEndsAt: plusDays(37),
      lastAuthoritativeOccurredAt: plusDays(30),
    });

    const mutation = reduceLifecycleTick(pastDue, plusDays(32));

    expect(mutation.nextState).toBe("past_due");
    expect(mutation.updates.cancelAtPeriodEnd).toBeUndefined();
    expect(mutation.facts.map(item => item.type)).toContain(
      "past_due_notice_day_2"
    );
    expect(mutation.facts.map(item => item.type)).not.toContain(
      "cancellation_effective"
    );
  });
});
