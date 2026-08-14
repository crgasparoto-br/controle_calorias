import { describe, expect, it } from "vitest";
import { createAsaasAdapter } from "./adapter";
import { createAsaasClient } from "./client";
import { executeGuardedAsaasMutation } from "./mutationGuard";
import type {
  AsaasOperation,
  AsaasOperationKind,
  AsaasOperationStore,
} from "./operationStore";

function exclusiveStore(): AsaasOperationStore {
  const values = new Map<string, AsaasOperation>();
  const owned = new Set<string>();
  const key = (kind: AsaasOperationKind, operationKey: string) =>
    `${kind}:${operationKey}`;
  const list = () => [...values.values()];

  return {
    async get(kind, operationKey) {
      return values.get(key(kind, operationKey)) ?? null;
    },
    async prepare(input) {
      const mapKey = key(input.kind, input.operationKey);
      const current = values.get(mapKey);
      if (current && owned.has(mapKey)) {
        throw new Error("asaas_operation_in_progress");
      }
      if (current) {
        if (current.state === "prepared") owned.add(mapKey);
        return { operation: current, created: false };
      }
      const operation: AsaasOperation = {
        id: mapKey,
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
      values.set(mapKey, operation);
      owned.add(mapKey);
      return { operation, created: true };
    },
    async markCreated(input) {
      const mapKey = key(input.kind, input.operationKey);
      const current = values.get(mapKey);
      if (!current) throw new Error("missing");
      owned.delete(mapKey);
      values.set(mapKey, {
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
      const mapKey = key(kind, operationKey);
      const current = values.get(mapKey);
      if (!current) throw new Error("missing");
      values.set(mapKey, { ...current, subscriptionId });
    },
    async markOutcomeUnknown(kind, operationKey) {
      const mapKey = key(kind, operationKey);
      const current = values.get(mapKey);
      if (!current) throw new Error("missing");
      owned.delete(mapKey);
      values.set(mapKey, { ...current, state: "outcome_unknown" });
    },
    async resetOutcomeUnknownToPrepared(kind, operationKey) {
      const mapKey = key(kind, operationKey);
      const current = values.get(mapKey);
      if (current?.state === "outcome_unknown") {
        values.set(mapKey, { ...current, state: "prepared" });
      }
    },
    async markFailed(kind, operationKey) {
      const mapKey = key(kind, operationKey);
      const current = values.get(mapKey);
      if (!current) throw new Error("missing");
      owned.delete(mapKey);
      values.set(mapKey, { ...current, state: "failed" });
    },
    async countCouponCharges(subscriptionId) {
      return list().filter(
        item =>
          item.kind === "coupon_charge" &&
          item.subscriptionId === subscriptionId &&
          item.state === "created"
      ).length;
    },
    async findByExternalId(kind, externalId) {
      return list().find(item => item.kind === kind && item.externalId === externalId) ?? null;
    },
    async findByPublicReference(kind, publicReference) {
      return list().find(
        item => item.kind === kind && item.publicReference === publicReference
      ) ?? null;
    },
    async listScheduledPixPayments() {
      return list().filter(
        item =>
          item.kind === "pix_payment" &&
          (item.state === "prepared" || item.state === "outcome_unknown")
      );
    },
  };
}

function flow() {
  return {
    contractKey: "concurrency-contract",
    payerUserId: 42,
    versionCode: "individual-monthly-v1",
    productName: "Individual",
    billingCycle: "monthly" as const,
    currency: "BRL" as const,
    unitAmount: 3990,
    paymentMethod: "credit_card" as const,
    trialChoice: "request" as const,
    trialDays: 7,
    customer: {
      payerUserId: 42,
      name: "Concurrent User",
      email: "concurrent@example.com",
      cpfCnpj: "529.982.247-25",
    },
    correlationId: "concurrency-attempt",
    successUrl: "https://app.example/success",
    cancelUrl: "https://app.example/cancel",
    expiredUrl: "https://app.example/expired",
  };
}

function response(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function barrier() {
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>(resolve => {
    entered = resolve;
  });
  const releasePromise = new Promise<void>(resolve => {
    release = resolve;
  });
  return { entered, release, enteredPromise, releasePromise };
}

describe("CONCURRENCY-CAS-001 provider mutation ownership", () => {
  it("allows only one hosted checkout POST while concurrent callers overlap", async () => {
    const store = exclusiveStore();
    const gate = barrier();
    let checkoutPosts = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      if (url.endsWith("/checkouts") && init?.method === "POST") {
        checkoutPosts += 1;
        gate.entered();
        await gate.releasePromise;
        return response({ id: "checkout-1", link: "https://asaas.example/checkout-1" });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["credit_card"],
    });

    const first = adapter.createPaymentFlow(flow());
    await gate.enteredPromise;
    await expect(adapter.createPaymentFlow(flow())).rejects.toThrow(
      "asaas_operation_in_progress"
    );
    expect(checkoutPosts).toBe(1);
    gate.release();
    await expect(first).resolves.toMatchObject({ state: "pending" });
    expect(checkoutPosts).toBe(1);
  });

  it("allows only one Pix authorization POST while concurrent callers overlap", async () => {
    const store = exclusiveStore();
    const gate = barrier();
    let pixPosts = 0;
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      if (url.endsWith("/customers")) return response({ id: "customer-1" });
      if (url.endsWith("/pix/automatic/authorizations") && init?.method === "POST") {
        pixPosts += 1;
        gate.entered();
        await gate.releasePromise;
        return response({
          id: "authorization-1",
          immediateQrCode: { payload: "qr", expirationDate: "2026-08-15" },
        });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["pix_automatic"],
    });
    const pixFlow = {
      ...flow(),
      paymentMethod: "pix_automatic" as const,
      trialChoice: "waive" as const,
      trialDays: 0,
    };

    const first = adapter.createPaymentFlow(pixFlow);
    await gate.enteredPromise;
    await expect(adapter.createPaymentFlow(pixFlow)).rejects.toThrow(
      "asaas_operation_in_progress"
    );
    expect(pixPosts).toBe(1);
    gate.release();
    await expect(first).resolves.toMatchObject({ state: "pending" });
    expect(pixPosts).toBe(1);
  });

  it("prevents a concurrent negative reconciliation from reopening an in-flight mutation", async () => {
    const store = exclusiveStore();
    const gate = barrier();
    let guardedActions = 0;
    let reconciliations = 0;
    const input = {
      store,
      operationKey: "cancel:sub-1:concurrency",
      subscriptionId: "sub-1",
      contractKey: "concurrency-contract",
    };

    const first = executeGuardedAsaasMutation({
      ...input,
      action: async () => {
        guardedActions += 1;
        gate.entered();
        await gate.releasePromise;
        return "remote-1";
      },
      reconcile: async () => ({ status: "pending" as const }),
    });
    await gate.enteredPromise;

    await expect(
      executeGuardedAsaasMutation({
        ...input,
        action: async () => {
          guardedActions += 1;
          return "must-not-run";
        },
        reconcile: async () => {
          reconciliations += 1;
          return { status: "not_applied" as const };
        },
      })
    ).rejects.toThrow("asaas_operation_in_progress");
    expect(guardedActions).toBe(1);
    expect(reconciliations).toBe(0);

    gate.release();
    await expect(first).resolves.toBe("created");
    expect(guardedActions).toBe(1);
  });
});
