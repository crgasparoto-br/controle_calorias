import { describe, expect, it } from "vitest";
import {
  createBillingSubscriptionLifecycleService,
  reduceLifecycleTick,
} from "./subscriptionLifecycle";
import type {
  BillingLifecycleMutation,
  BillingLifecycleRepository,
  BillingLifecycleSnapshot,
} from "./subscriptionLifecycleTypes";

const DAY_MS = 24 * 60 * 60 * 1000;
const base = new Date("2030-01-01T12:00:00.000Z");
const plusDays = (days: number) => new Date(base.getTime() + days * DAY_MS);

function snapshot(
  overrides: Partial<BillingLifecycleSnapshot> = {}
): BillingLifecycleSnapshot {
  return {
    subscriptionId: "sub-audit-remediation",
    payerUserId: 1,
    planId: "plan-individual",
    productCode: "individual",
    versionCode: "individual-v1",
    audience: "individual",
    billingCycle: "monthly",
    state: "past_due",
    revision: 4,
    currentPeriodStart: base,
    currentPeriodEnd: plusDays(30),
    cancelAtPeriodEnd: false,
    trialStartedAt: null,
    trialEndsAt: null,
    firstChargeAt: null,
    trialCapacityLimit: null,
    graceStartedAt: base,
    graceEndsAt: plusDays(7),
    suspendedAt: null,
    recoveryEndsAt: null,
    lastAuthoritativeOccurredAt: base,
    lastConfirmedCompetenceKey: null,
    reconciliationRequired: false,
    couponContractKey: "coupon-contract",
    emittedFactKeys: [],
    ...overrides,
  };
}

class AuditRepository implements BillingLifecycleRepository {
  current: BillingLifecycleSnapshot;
  lastMutation: BillingLifecycleMutation | null = null;

  constructor(initial: BillingLifecycleSnapshot) {
    this.current = initial;
  }

  async getPlan() {
    return null;
  }

  async prepareContract(): Promise<never> {
    throw new Error("not used");
  }

  async loadLifecycle(subscriptionId: string) {
    return subscriptionId === this.current.subscriptionId ? this.current : null;
  }

  async commitMutation(input: {
    snapshot: BillingLifecycleSnapshot;
    mutation: BillingLifecycleMutation;
  }) {
    if (
      input.snapshot.subscriptionId !== this.current.subscriptionId ||
      input.mutation.expectedRevision !== this.current.revision
    ) {
      return "conflict" as const;
    }
    this.lastMutation = input.mutation;
    this.current = {
      ...this.current,
      ...input.mutation.updates,
      state: input.mutation.nextState,
      revision: this.current.revision + 1,
      emittedFactKeys: Array.from(
        new Set([
          ...this.current.emittedFactKeys,
          ...input.mutation.facts.map(item => item.idempotencyKey),
        ])
      ),
    };
    return "applied" as const;
  }

  async listDueSubscriptionIds() {
    return [];
  }

  async cancelCouponReservation() {}

  async recordTrialEligibilityDecision() {}
}

function service(initial: BillingLifecycleSnapshot) {
  const repository = new AuditRepository(initial);
  const lifecycle = createBillingSubscriptionLifecycleService({
    repository,
    now: () => base,
    hashTrialIdentity: (type, value) => `${type}:${value}`,
  });
  return { repository, lifecycle };
}

describe("subscription lifecycle audit remediations", () => {
  it("releases a still-reserved coupon when an unpaid subscription expires after recovery", () => {
    const suspended = snapshot({
      state: "suspended",
      graceStartedAt: plusDays(-7),
      graceEndsAt: base,
      suspendedAt: base,
      recoveryEndsAt: plusDays(30),
      couponContractKey: "unconfirmed-coupon-contract",
    });

    const mutation = reduceLifecycleTick(suspended, plusDays(30));

    expect(mutation.nextState).toBe("expired");
    expect(mutation.couponAction).toBe("cancel");
  });

  it("also releases a still-reserved coupon on administrative termination after first-charge failure", async () => {
    const { repository, lifecycle } = service(
      snapshot({
        state: "past_due",
        couponContractKey: "unconfirmed-admin-stop",
      })
    );

    await lifecycle.terminateImmediately({
      subscriptionId: repository.current.subscriptionId,
      actorUserId: 99,
      reason: "operational_error",
      correlationId: "admin-stop-unconfirmed",
    });

    expect(repository.current.state).toBe("expired");
    expect(repository.lastMutation?.couponAction).toBe("cancel");
  });

  it("rejects an administrative grace date that would shorten the current window", async () => {
    const { repository, lifecycle } = service(snapshot());

    await expect(
      lifecycle.extendGrace({
        subscriptionId: repository.current.subscriptionId,
        actorUserId: 99,
        until: plusDays(2),
        reason: "should not shorten",
        correlationId: "shorten-grace",
      })
    ).rejects.toThrow("billing_grace_extension_must_extend_current_window");

    await expect(
      lifecycle.extendGrace({
        subscriptionId: repository.current.subscriptionId,
        actorUserId: 99,
        until: plusDays(7),
        reason: "should increase, not keep the same end",
        correlationId: "same-grace",
      })
    ).rejects.toThrow("billing_grace_extension_must_extend_current_window");

    expect(repository.lastMutation).toBeNull();
    expect(repository.current.graceEndsAt).toEqual(plusDays(7));
  });

  it("still permits a real extension and records the previous and new boundaries", async () => {
    const { repository, lifecycle } = service(snapshot());

    await expect(
      lifecycle.extendGrace({
        subscriptionId: repository.current.subscriptionId,
        actorUserId: 99,
        until: plusDays(10),
        reason: "manual extension",
        correlationId: "extend-grace",
      })
    ).resolves.toBe("applied");

    expect(repository.current.graceEndsAt).toEqual(plusDays(10));
    expect(repository.lastMutation?.audit?.action).toBe("grace_extended");
    expect(repository.lastMutation?.audit?.metadata).toMatchObject({
      previousGraceEndsAt: plusDays(7).toISOString(),
      newGraceEndsAt: plusDays(10).toISOString(),
    });
  });
});
