import { describe, expect, it, vi } from "vitest";
import type { BillingStartContractInput } from "../subscriptionLifecycle";
import type {
  BillingLifecycleSnapshot,
  BillingPrepareContractResult,
  BillingProviderNeutralFinancialFact,
} from "../subscriptionLifecycleTypes";
import type { AsaasCreditCardSchedule } from "./creditCardSchedule";
import { createAsaasLifecycleHooks } from "./lifecycleHooks";
import type {
  AsaasOperation,
  AsaasOperationKind,
  AsaasOperationStore,
} from "./operationStore";

function operation(overrides: Partial<AsaasOperation> = {}): AsaasOperation {
  return {
    id: "op-1",
    kind: "checkout",
    operationKey: "contract-1:checkout",
    state: "created",
    subscriptionId: "sub-1",
    externalId: "chk-1",
    externalReference: "contract-1",
    customerReference: "cus-1",
    authorizationReference: null,
    publicReference: null,
    payerUserId: 7,
    planCode: "professional-monthly-v1",
    paymentMethod: "credit_card",
    trialChoice: "request",
    couponCode: null,
    billingCycle: "monthly",
    correlationId: "attempt-1",
    amountMinor: 7990,
    unitAmountMinor: 7990,
    discountDurationCharges: null,
    transitionAccessUntil: null,
    dueDate: null,
    updatedAt: new Date("2026-08-11T12:00:00.000Z"),
    ...overrides,
  };
}

function store(input: {
  get?: AsaasOperation | null;
  byExternalId?: AsaasOperation | null;
} = {}): AsaasOperationStore {
  return {
    async get() {
      return input.get ?? null;
    },
    async prepare() {
      throw new Error("not used");
    },
    async markCreated() {},
    async bindSubscription() {},
    async markOutcomeUnknown() {},
    async resetOutcomeUnknownToPrepared() {},
    async markFailed() {},
    async countCouponCharges() {
      return 0;
    },
    async findByExternalId(_kind: AsaasOperationKind, _externalId: string) {
      return input.byExternalId ?? null;
    },
    async findByPublicReference() {
      return null;
    },
    async listScheduledPixPayments() {
      return [];
    },
  };
}

function snapshot(): BillingLifecycleSnapshot {
  return {
    subscriptionId: "sub-1",
    payerUserId: 7,
    planId: "plan-1",
    productCode: "professional",
    versionCode: "professional-monthly-v1",
    audience: "professional",
    billingCycle: "monthly",
    state: "pending",
    revision: 1,
    currentPeriodStart: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    trialStartedAt: new Date("2026-08-11T12:00:00.000Z"),
    trialEndsAt: new Date("2026-08-25T12:00:00.000Z"),
    firstChargeAt: new Date("2026-08-26T12:00:00.000Z"),
    trialCapacityLimit: 5,
    graceStartedAt: null,
    graceEndsAt: null,
    suspendedAt: null,
    recoveryEndsAt: null,
    lastAuthoritativeOccurredAt: null,
    lastConfirmedCompetenceKey: null,
    reconciliationRequired: false,
    couponContractKey: null,
    emittedFactKeys: [],
  };
}

function startInput(): BillingStartContractInput {
  return {
    contractKey: "contract-1",
    providerCode: "asaas",
    payerUserId: 7,
    versionCode: "professional-monthly-v1",
    paymentMethod: "credit_card",
    trialChoice: "request",
    verifiedPaymentInstrument: {
      payerUserId: 7,
      providerCode: "asaas",
      paymentMethod: "credit_card",
      registrationId: "sub-remote-1",
      verifiedAt: new Date("2026-08-11T12:00:00.000Z"),
    },
    identity: { userId: 7, cnpj: "12345678000199", phone: "11999999999" },
    correlationId: "attempt-1",
  };
}

function startResult(): BillingPrepareContractResult {
  return {
    ok: true,
    created: true,
    intent: {
      id: "intent-1",
      contractKey: "contract-1",
      subscriptionId: "sub-1",
      payerUserId: 7,
      planId: "plan-1",
      paymentMethod: "credit_card",
      trialChoice: "request",
      trialWaivedAt: null,
      couponContractKey: null,
      state: "pending",
    },
    snapshot: snapshot(),
  };
}

describe("Asaas billing lifecycle hooks", () => {
  it("aligns a newly correlated trial to the provider-neutral firstChargeAt", async () => {
    const align = vi.fn(async () => ({ paymentId: "pay-1", nextDueDate: "2026-09-26" }));
    const hooks = createAsaasLifecycleHooks(() => ({
      store: store({ get: operation() }),
      creditCardSchedule: {
        alignCreditCardSubscriptionSchedule: align,
      } as AsaasCreditCardSchedule,
    }));

    await hooks.afterStartContract?.(startInput(), startResult());

    expect(align).toHaveBeenCalledTimes(1);
    expect(align).toHaveBeenCalledWith({
      subscriptionId: "sub-1",
      externalSubscriptionId: "sub-remote-1",
      contractKey: "contract-1",
      scopeKey: "trial-start",
      billingCycle: "monthly",
      targetDueDate: "2026-08-26",
      amountMinor: 7990,
      paymentExternalReference: "contract-1",
    });
  });

  it("enriches only the authoritative early-conversion payment with its persisted confirmation key", async () => {
    const hooks = createAsaasLifecycleHooks(() => ({
      store: store({
        byExternalId: operation({
          kind: "payment_reschedule" as AsaasOperationKind,
          subscriptionId: "sub-1",
          externalId: "pay-early-1",
          correlationId: "confirm-1",
        }),
      }),
      creditCardSchedule: {} as AsaasCreditCardSchedule,
    }));
    const fact: BillingProviderNeutralFinancialFact = {
      providerCode: "asaas",
      providerEventId: "evt-1",
      subscriptionId: "sub-1",
      kind: "payment_confirmed",
      occurredAt: new Date("2026-08-20T12:00:00.000Z"),
      competenceKey: "pay-early-1",
      chargePurpose: "early_conversion",
      commercialConfirmationKey: null,
      correlationId: "asaas:evt-1",
    };

    await expect(hooks.enrichFinancialFact?.(fact)).resolves.toMatchObject({
      commercialConfirmationKey: "confirm-1",
    });

    await expect(
      hooks.enrichFinancialFact?.({ ...fact, chargePurpose: "renewal" })
    ).resolves.toMatchObject({ commercialConfirmationKey: null });
  });
});
