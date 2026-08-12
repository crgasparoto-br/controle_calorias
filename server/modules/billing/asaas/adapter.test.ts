import { describe, expect, it } from "vitest";
import {
  businessWeekdaysUntil,
  createAsaasAdapter,
  shouldCreateScheduledPixPayment,
} from "./adapter";
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
        item =>
          item.kind === "coupon_charge" &&
          item.subscriptionId === subscriptionId &&
          item.state === "created"
      ).length;
    },
    async findByExternalId(kind, externalId) {
      return (
        list().find(item => item.kind === kind && item.externalId === externalId) ??
        null
      );
    },
    async findByPublicReference(kind, publicReference) {
      return (
        list().find(
          item => item.kind === kind && item.publicReference === publicReference
        ) ?? null
      );
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

function baseFlow() {
  return {
    contractKey: "contract-1",
    payerUserId: 7,
    versionCode: "individual-monthly-v1",
    productName: "Individual",
    billingCycle: "monthly" as const,
    currency: "BRL" as const,
    unitAmount: 3990,
    paymentMethod: "credit_card" as const,
    trialChoice: "request" as const,
    trialDays: 7,
    customer: {
      payerUserId: 7,
      name: "Test User",
      email: "test@example.com",
      cpfCnpj: "529.982.247-25",
    },
    correlationId: "attempt-1",
    successUrl: "https://app.example/success",
    cancelUrl: "https://app.example/cancel",
    expiredUrl: "https://app.example/expired",
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("Asaas adapter", () => {
  it("uses one outbound call per operation and reuses persisted customer/checkout", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/checkouts")) {
        return jsonResponse({
          id: "chk_1",
          link: "https://sandbox.asaas.com/checkoutSession/show/chk_1",
        });
      }
      throw new Error("unexpected");
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const first = await adapter.createPaymentFlow(baseFlow());
    const second = await adapter.createPaymentFlow(baseFlow());
    expect(first).toEqual(second);
    expect(calls).toHaveLength(2);
  });

  it("rejects a missing or structurally invalid customer document before persistence or outbound calls", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ id: "unexpected" });
    };
    const store = memoryStore();
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["credit_card"],
    });

    await expect(
      adapter.createPaymentFlow({
        ...baseFlow(),
        customer: { ...baseFlow().customer, cpfCnpj: "   " },
      })
    ).rejects.toThrow("asaas_customer_document_required");
    await expect(
      adapter.createPaymentFlow({
        ...baseFlow(),
        customer: { ...baseFlow().customer, cpfCnpj: "123" },
      })
    ).rejects.toThrow("asaas_customer_document_invalid");
    await expect(
      adapter.createPaymentFlow({
        ...baseFlow(),
        customer: { ...baseFlow().customer, cpfCnpj: "529.982.247-X25" },
      })
    ).rejects.toThrow("asaas_customer_document_invalid");

    expect(calls).toBe(0);
    expect(
      await store.get("customer", "controle-calorias:user:7")
    ).toBeNull();
  });

  it("normalizes CPF/CNPJ and always sends it when creating an Asaas customer", async () => {
    const bodies: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      bodies.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : {},
      });
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/checkouts")) {
        return jsonResponse({ id: "chk_1", link: "https://sandbox.asaas.com/checkout/chk_1" });
      }
      throw new Error("unexpected");
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
    });

    await adapter.createPaymentFlow(baseFlow());

    expect(bodies[0]).toMatchObject({
      url: expect.stringContaining("/customers"),
      body: {
        name: "Test User",
        email: "test@example.com",
        cpfCnpj: "52998224725",
        externalReference: "controle-calorias:user:7",
      },
    });
  });

  it("builds the official checkout URL when Asaas returns only the checkout id", async () => {
    const calls: string[] = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/checkouts")) return jsonResponse({ id: "chk_id_only" });
      throw new Error("unexpected");
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });

    const first = await adapter.createPaymentFlow(baseFlow());
    const second = await adapter.createPaymentFlow(baseFlow());

    expect(first).toEqual({
      kind: "hosted_checkout",
      provider: "asaas",
      externalId: "chk_id_only",
      url: "https://asaas.com/checkoutSession/show?id=chk_id_only",
      state: "pending",
    });
    expect(second).toEqual(first);
    expect(calls).toHaveLength(2);
  });

  it("does not blindly recreate a checkout after an uncertain POST outcome", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async request => {
      calls += 1;
      if (String(request).endsWith("/customers")) {
        return jsonResponse({ id: "cus_1" });
      }
      throw new DOMException("aborted", "AbortError");
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
    });
    await expect(adapter.createPaymentFlow(baseFlow())).rejects.toBeInstanceOf(
      AsaasUncertainOutcomeError
    );
    await expect(adapter.createPaymentFlow(baseFlow())).rejects.toThrow(
      "asaas_checkout_reconciliation_pending"
    );
    expect(calls).toBe(2);
  });

  it("rejects disabled methods, Pix trials and zero-value charges before outbound", async () => {
    let calls = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return jsonResponse({ id: "unexpected" });
    };
    const cardOnly = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
    });
    await expect(
      cardOnly.createPaymentFlow({
        ...baseFlow(),
        paymentMethod: "pix_automatic",
        trialChoice: "waive",
        trialDays: 0,
      })
    ).rejects.toThrow("asaas_payment_method_unavailable");

    const pix = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["pix_automatic"],
    });
    await expect(
      pix.createPaymentFlow({ ...baseFlow(), paymentMethod: "pix_automatic" })
    ).rejects.toThrow("pix_automatic_requires_trial_waiver");

    await expect(
      cardOnly.createPaymentFlow({
        ...baseFlow(),
        discount: { amountMinor: 3990, durationCharges: 1 },
      })
    ).rejects.toThrow("asaas_zero_value_charge_not_supported");
    expect(calls).toBe(0);
  });

  it("creates Pix Automático in MANUAL mode and never sends a fixed recurring value", async () => {
    const bodies: unknown[] = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      if (init?.body) bodies.push(JSON.parse(String(init.body)));
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/pix/automatic/authorizations")) {
        return jsonResponse({
          id: "aut_1",
          immediateQrCode: { payload: "qr-payload", expirationDate: "2026-08-11" },
        });
      }
      throw new Error("unexpected");
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["pix_automatic"],
    });
    await adapter.createPaymentFlow({
      ...baseFlow(),
      paymentMethod: "pix_automatic",
      trialChoice: "waive",
      trialDays: 0,
    });
    const authorization = bodies[1] as Record<string, unknown>;
    expect(authorization.paymentCreationMode).toBe("MANUAL");
    expect(authorization).not.toHaveProperty("value");
    expect(authorization.immediateQrCode).toMatchObject({ value: 39.9 });
  });

  it("schedules future Pix locally and sends it only inside the conservative business-day window", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl: typeof fetch = async (request, init) => {
      calls.push({
        url: String(request),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return jsonResponse({ id: "pay_1", externalReference: "contract-1:2026-08-18" });
    };
    const store = memoryStore();
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["pix_automatic"],
      now: () => new Date("2026-08-11T12:00:00.000Z"),
    });
    const scheduled = await adapter.schedulePixPayment({
      subscriptionId: "sub-1",
      contractKey: "contract-1",
      authorizationId: "aut-1",
      customerId: "cus-1",
      competenceKey: "2026-08-18",
      dueDate: "2026-08-18",
      amountMinor: 3990,
    });
    expect(calls).toHaveLength(0);
    expect(businessWeekdaysUntil("2026-08-18", new Date("2026-08-11T12:00:00Z"))).toBe(5);
    expect(shouldCreateScheduledPixPayment("2026-08-18", new Date("2026-08-11T12:00:00Z"))).toBe(true);
    await adapter.executeScheduledPixPayment(scheduled.operation);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toMatchObject({
      pixAutomaticAuthorizationId: "aut-1",
      dueDate: "2026-08-18",
      externalReference: "contract-1:2026-08-18",
    });
  });

  it("reconciles an uncertain coupon reset by GET and never repeats the PUT", async () => {
    const calls: string[] = [];
    let putAttempted = false;
    const fetchImpl: typeof fetch = async (request, init) => {
      const url = String(request);
      const method = init?.method ?? "GET";
      calls.push(`${method} ${url}`);
      if (method === "PUT" && url.endsWith("/subscriptions/sub_remote_1")) {
        putAttempted = true;
        throw new DOMException("aborted", "AbortError");
      }
      if (method === "GET" && url.endsWith("/subscriptions/sub_remote_1")) {
        return jsonResponse({ id: "sub_remote_1", status: "ACTIVE", value: 39.9 });
      }
      throw new Error(`unexpected ${method} ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store: memoryStore(),
      enabledPaymentMethods: ["credit_card"],
    });

    await expect(
      adapter.restoreSubscriptionBaseAmount({
        subscriptionId: "sub-local-1",
        externalSubscriptionId: "sub_remote_1",
        contractKey: "contract-1",
        unitAmountMinor: 3990,
      })
    ).rejects.toBeInstanceOf(AsaasUncertainOutcomeError);
    expect(putAttempted).toBe(true);

    await adapter.restoreSubscriptionBaseAmount({
      subscriptionId: "sub-local-1",
      externalSubscriptionId: "sub_remote_1",
      contractKey: "contract-1",
      unitAmountMinor: 3990,
    });

    expect(calls.filter(call => call.startsWith("PUT "))).toHaveLength(1);
    expect(calls.filter(call => call.startsWith("GET "))).toHaveLength(1);
  });
});
