import { describe, expect, it } from "vitest";
import { createAsaasAdapter } from "./adapter";
import {
  createAsaasCreditCardSchedule,
  nextBillingCycleDate,
  type AsaasCreditCardScheduleInput,
} from "./creditCardSchedule";
import { AsaasUncertainOutcomeError, createAsaasClient } from "./client";
import type {
  AsaasOperation,
  AsaasOperationKind,
  AsaasOperationStore,
} from "./operationStore";

function memoryStore(): AsaasOperationStore {
  const values = new Map<string, AsaasOperation>();
  const key = (kind: AsaasOperationKind, operationKey: string) =>
    `${kind}:${operationKey}`;
  const list = () => [...values.values()];
  return {
    async get(kind, operationKey) {
      return values.get(key(kind, operationKey)) ?? null;
    },
    async prepare(input) {
      const current = values.get(key(input.kind, input.operationKey));
      if (current) return { operation: current, created: false };
      const operation: AsaasOperation = {
        id: key(input.kind, input.operationKey),
        kind: input.kind,
        operationKey: input.operationKey,
        state: "prepared",
        subscriptionId: input.subscriptionId ?? null,
        externalId: null,
        externalReference: input.externalReference ?? null,
        customerReference: input.customerReference ?? null,
        authorizationReference: input.authorizationReference ?? null,
        publicReference: input.publicReference ?? null,
        payerUserId: input.payerUserId ?? null,
        planCode: input.planCode ?? null,
        paymentMethod: input.paymentMethod ?? null,
        trialChoice: input.trialChoice ?? null,
        couponCode: input.couponCode ?? null,
        billingCycle: input.billingCycle ?? null,
        correlationId: input.correlationId ?? null,
        amountMinor: input.amountMinor ?? null,
        unitAmountMinor: input.unitAmountMinor ?? null,
        discountDurationCharges: input.discountDurationCharges ?? null,
        transitionAccessUntil: input.transitionAccessUntil ?? null,
        dueDate: input.dueDate ?? null,
        updatedAt: new Date(),
      };
      values.set(key(input.kind, input.operationKey), operation);
      return { operation, created: true };
    },
    async markCreated(input) {
      const current = values.get(key(input.kind, input.operationKey));
      if (!current) throw new Error("missing");
      values.set(key(input.kind, input.operationKey), {
        ...current,
        state: "created",
        externalId: input.externalId,
        externalReference: input.externalReference ?? current.externalReference,
        customerReference: input.customerReference ?? current.customerReference,
        authorizationReference:
          input.authorizationReference ?? current.authorizationReference,
        publicReference: input.publicReference ?? current.publicReference,
      });
    },
    async bindSubscription(kind, operationKey, subscriptionId) {
      const current = values.get(key(kind, operationKey));
      if (!current) throw new Error("missing");
      values.set(key(kind, operationKey), { ...current, subscriptionId });
    },
    async markOutcomeUnknown(kind, operationKey) {
      const current = values.get(key(kind, operationKey));
      if (!current) throw new Error("missing");
      values.set(key(kind, operationKey), { ...current, state: "outcome_unknown" });
    },
    async resetOutcomeUnknownToPrepared(kind, operationKey) {
      const current = values.get(key(kind, operationKey));
      if (!current) throw new Error("missing");
      if (current.state === "outcome_unknown") {
        values.set(key(kind, operationKey), { ...current, state: "prepared" });
      }
    },
    async markFailed(kind, operationKey) {
      const current = values.get(key(kind, operationKey));
      if (!current) throw new Error("missing");
      values.set(key(kind, operationKey), { ...current, state: "failed" });
    },
    async countCouponCharges(subscriptionId) {
      return list().filter(
        item => item.kind === "coupon_charge" && item.subscriptionId === subscriptionId
      ).length;
    },
    async findByExternalId(kind, externalId) {
      return list().find(item => item.kind === kind && item.externalId === externalId) ?? null;
    },
    async findByPublicReference(kind, publicReference) {
      return (
        list().find(
          item => item.kind === kind && item.publicReference === publicReference
        ) ?? null
      );
    },
    async listScheduledPixPayments() {
      return list().filter(item => item.kind === "pix_payment");
    },
  };
}

function schedule(
  overrides: Partial<AsaasCreditCardScheduleInput> = {}
): AsaasCreditCardScheduleInput {
  return {
    subscriptionId: "sub-local-1",
    externalSubscriptionId: "sub_remote_1",
    contractKey: "contract-1",
    scopeKey: "trial-start",
    billingCycle: "monthly",
    targetDueDate: "2026-08-19",
    amountMinor: 3990,
    paymentExternalReference: "contract-1",
    ...overrides,
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Asaas credit-card subscription schedule", () => {
  it("aligns the provisional trial charge to the authoritative firstChargeAt and is mutation-idempotent", async () => {
    const calls: Array<{ method: string; url: string; body: Record<string, unknown> | null }> = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ method, url, body });
      if (url.includes("/subscriptions/sub_remote_1/payments")) {
        return jsonResponse({
          data: [
            {
              id: "pay_trial_1",
              dueDate: "2026-08-20",
              externalReference: "contract-1",
              value: 39.9,
            },
          ],
        });
      }
      if (method === "PUT" && url.endsWith("/subscriptions/sub_remote_1")) {
        return jsonResponse({ id: "sub_remote_1" });
      }
      if (method === "PUT" && url.endsWith("/payments/pay_trial_1")) {
        return jsonResponse({ id: "pay_trial_1" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const creditCardSchedule = createAsaasCreditCardSchedule({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
    });

    const first = await creditCardSchedule.alignCreditCardSubscriptionSchedule(schedule());
    const second = await creditCardSchedule.alignCreditCardSubscriptionSchedule(schedule());

    expect(first).toEqual(second);
    expect(calls).toHaveLength(3);
    expect(calls[1]).toMatchObject({
      method: "PUT",
      body: { nextDueDate: "2026-09-19", updatePendingPayments: false },
    });
    expect(calls[2]).toMatchObject({
      method: "PUT",
      body: {
        billingType: "CREDIT_CARD",
        value: 39.9,
        dueDate: "2026-08-19",
        externalReference: "contract-1",
      },
    });
  });

  it("reconciles an uncertain payment reschedule by GET and never repeats the PUT", async () => {
    const calls: string[] = [];
    let paymentPutAttempted = false;
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/subscriptions/sub_remote_1/payments")) {
        return jsonResponse({
          data: [
            {
              id: "pay_trial_1",
              dueDate: "2026-08-19",
              externalReference: "contract-1",
              value: 39.9,
            },
          ],
        });
      }
      if (method === "PUT" && url.endsWith("/subscriptions/sub_remote_1")) {
        return jsonResponse({ id: "sub_remote_1" });
      }
      if (method === "PUT" && url.endsWith("/payments/pay_trial_1")) {
        paymentPutAttempted = true;
        throw new DOMException("aborted", "AbortError");
      }
      if (method === "GET" && url.endsWith("/payments/pay_trial_1")) {
        return jsonResponse({
          id: "pay_trial_1",
          dueDate: "2026-08-11",
          externalReference: "contract-1:early_conversion",
          value: 39.9,
          status: "CONFIRMED",
        });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const creditCardSchedule = createAsaasCreditCardSchedule({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
    });
    const early = schedule({
      scopeKey: "early-conversion:confirm-1",
      targetDueDate: "2026-08-11",
      expectedCurrentDueDate: "2026-08-19",
      paymentExternalReference: "contract-1:early_conversion",
      commercialConfirmationKey: "confirm-1",
    });

    await expect(
      creditCardSchedule.alignCreditCardSubscriptionSchedule(early)
    ).rejects.toBeInstanceOf(AsaasUncertainOutcomeError);
    expect(paymentPutAttempted).toBe(true);

    const reconciled = await creditCardSchedule.alignCreditCardSubscriptionSchedule(early);
    expect(reconciled.paymentId).toBe("pay_trial_1");
    expect(calls.filter(call => call.includes("PUT") && call.includes("/payments/"))).toHaveLength(1);
    expect(calls.filter(call => call.includes("GET") && call.endsWith("/payments/pay_trial_1"))).toHaveLength(1);
  });

  it("keeps month-end recurrence deterministic", () => {
    expect(nextBillingCycleDate("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(nextBillingCycleDate("2024-02-29", "yearly")).toBe("2025-02-28");
  });
});

describe("Asaas aligned payment correlation", () => {
  it("persists an already-aligned early-conversion payment without issuing a duplicate payment PUT", async () => {
    const calls: string[] = [];
    const store = memoryStore();
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (url.includes("/subscriptions/sub_remote_1/payments")) {
        return jsonResponse({
          data: [
            {
              id: "pay_early_1",
              dueDate: "2026-08-11",
              externalReference: "contract-1:early_conversion",
              value: 39.9,
            },
          ],
        });
      }
      if (method === "PUT" && url.endsWith("/subscriptions/sub_remote_1")) {
        return jsonResponse({ id: "sub_remote_1" });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const creditCardSchedule = createAsaasCreditCardSchedule({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
    });
    const early = schedule({
      scopeKey: "early-conversion:confirm-aligned",
      targetDueDate: "2026-08-11",
      expectedCurrentDueDate: "2026-08-19",
      paymentExternalReference: "contract-1:early_conversion",
      commercialConfirmationKey: "confirm-aligned",
    });

    const result = await creditCardSchedule.alignCreditCardSubscriptionSchedule(early);
    const operation = await store.findByExternalId(
      "payment_reschedule" as AsaasOperationKind,
      "pay_early_1"
    );

    expect(result.paymentId).toBe("pay_early_1");
    expect(operation?.correlationId).toBe("confirm-aligned");
    expect(
      calls.filter(call => call.includes("PUT") && call.includes("/payments/"))
    ).toHaveLength(0);
  });
});

describe("Asaas hosted checkout navigation boundary", () => {
  it("returns browser navigation as pending and never treats the callback URL as payment confirmation", async () => {
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/checkouts") && init?.method === "POST") {
        return jsonResponse({
          id: "chk_1",
          link: "https://sandbox.asaas.com/checkoutSession/show/chk_1",
        });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    const flow = await adapter.createPaymentFlow({
      contractKey: "callback-contract",
      payerUserId: 9,
      versionCode: "individual-monthly-v1",
      productName: "Individual",
      billingCycle: "monthly",
      currency: "BRL",
      unitAmount: 3990,
      paymentMethod: "credit_card",
      trialChoice: "waive",
      trialDays: 0,
      customer: { payerUserId: 9, name: "Callback User" },
      correlationId: "callback-attempt",
      successUrl: "https://app.example/billing/return/success",
      cancelUrl: "https://app.example/billing/return/cancel",
      expiredUrl: "https://app.example/billing/return/expired",
    });

    expect(flow).toMatchObject({
      kind: "hosted_checkout",
      externalId: "chk_1",
      state: "pending",
    });
  });
});
