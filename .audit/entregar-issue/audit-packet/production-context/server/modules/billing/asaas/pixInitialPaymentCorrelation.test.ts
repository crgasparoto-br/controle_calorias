import { describe, expect, it } from "vitest";
import { createAsaasClient, AsaasUncertainOutcomeError } from "./client";
import {
  createAsaasAdapter,
  persistPixInitialPaymentCorrelation,
  type AsaasAdapter,
} from "./adapter";
import {
  createAsaasWebhookRuntime,
  createConciliationAwareAsaasOperationStore,
  normalizeAsaasWebhookEnvelope,
  persistAsaasPixInitialPaymentEventCorrelation,
  processAsaasPixCorrelationForPersistedEvent,
  type AsaasWebhookEnvelope,
  type PersistedWebhookRow,
} from "./webhook";
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
      values.set(key(kind, operationKey), {
        ...current,
        state: "outcome_unknown",
      });
    },
    async resetOutcomeUnknownToPrepared(kind, operationKey) {
      const current = values.get(key(kind, operationKey));
      if (current?.state === "outcome_unknown") {
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


function persistedEvent(envelope: AsaasWebhookEnvelope): PersistedWebhookRow {
  const normalized = normalizeAsaasWebhookEnvelope(envelope);
  return {
    id: `db:${normalized.providerEventId}`,
    providerEventId: normalized.providerEventId,
    eventType: normalized.eventType,
    subscriptionId: null,
    occurredAt: normalized.occurredAt,
    metadata: normalized.metadata ?? {},
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function pixFlow() {
  return {
    contractKey: "contract-pix-1",
    subscriptionId: "sub-local-1",
    payerUserId: 7,
    versionCode: "individual-monthly-v1",
    productName: "Individual",
    billingCycle: "monthly" as const,
    currency: "BRL" as const,
    unitAmount: 3990,
    paymentMethod: "pix_automatic" as const,
    trialChoice: "waive" as const,
    trialDays: 0,
    customer: {
      payerUserId: 7,
      name: "Pix User",
      email: "pix@example.com",
      cpfCnpj: "52998224725",
    },
    correlationId: "attempt-pix-1",
    successUrl: "https://app.example/success",
    cancelUrl: "https://app.example/cancel",
    expiredUrl: "https://app.example/expired",
  };
}

describe("Asaas Pix Automático initial payment correlation", () => {
  it("PIX-CONCILIATION-001 persists the API conciliationIdentifier before returning the QR", async () => {
    const store = memoryStore();
    const fetchImpl: typeof fetch = async request => {
      const url = String(request);
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/pix/automatic/authorizations")) {
        return jsonResponse({
          id: "aut_1",
          immediateQrCode: {
            payload: "qr-payload",
            expirationDate: "2026-08-12 01:00:00",
            conciliationIdentifier: "ASAAS-CID-001",
          },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["pix_automatic"],
    });

    await adapter.createPaymentFlow(pixFlow());

    await expect(
      store.findByPublicReference("reconciliation", "ASAAS-CID-001")
    ).resolves.toMatchObject({
      state: "created",
      subscriptionId: "sub-local-1",
      externalId: "aut_1",
      externalReference: "contract-pix-1",
      authorizationReference: "aut_1",
      publicReference: "ASAAS-CID-001",
    });
  });

  it("PIX-CONCILIATION-NEG-001 treats a missing identifier after remote creation as uncertain", async () => {
    const store = memoryStore();
    const fetchImpl: typeof fetch = async request => {
      const url = String(request);
      if (url.endsWith("/customers")) return jsonResponse({ id: "cus_1" });
      if (url.endsWith("/pix/automatic/authorizations")) {
        return jsonResponse({
          id: "aut_missing_cid",
          immediateQrCode: { payload: "qr-payload" },
        });
      }
      throw new Error(`unexpected ${url}`);
    };
    const adapter = createAsaasAdapter({
      client: createAsaasClient({ environment: "sandbox", apiKey: "key", fetchImpl }),
      store,
      enabledPaymentMethods: ["pix_automatic"],
    });

    await expect(adapter.createPaymentFlow(pixFlow())).rejects.toBeInstanceOf(
      AsaasUncertainOutcomeError
    );
    await expect(
      store.get("pix_automatic_authorization", "contract-pix-1:pix-automatic")
    ).resolves.toMatchObject({ state: "outcome_unknown" });
  });

  it("normalizes the initial payment identifier without persisting unrelated raw fields", () => {
    const normalized = normalizeAsaasWebhookEnvelope({
      id: "evt_initial_pix",
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_initial_1",
        status: "RECEIVED",
        value: 39.9,
        dueDate: "2026-08-12",
        conciliationIdentifier: "ASAAS-CID-001",
        rawSecret: "must-not-survive",
      },
    });

    expect(normalized.metadata).toMatchObject({
      objectId: "pay_initial_1",
      publicReference: "ASAAS-CID-001",
    });
    expect(JSON.stringify(normalized.metadata)).not.toContain("must-not-survive");
  });

  it("keeps an out-of-order initial payment recoverable through the durable sidecar", async () => {
    const store = memoryStore();
    await persistAsaasPixInitialPaymentEventCorrelation({
      store,
      event: persistedEvent({
        id: "evt_initial_pix",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_initial_1",
          value: 39.9,
          dueDate: "2026-08-12",
          conciliationIdentifier: "ASAAS-CID-LATE",
        },
      }),
    });

    await persistPixInitialPaymentCorrelation({
      store,
      contractKey: "contract-late",
      subscriptionId: "sub-late",
      authorizationId: "aut-late",
      conciliationIdentifier: "ASAAS-CID-LATE",
    });

    const wrapped = createConciliationAwareAsaasOperationStore(store);
    await expect(
      wrapped.findByExternalId("pix_payment", "pay_initial_1")
    ).resolves.toMatchObject({
      subscriptionId: "sub-late",
      externalReference: "contract-late",
      authorizationReference: "aut-late",
      publicReference: "ASAAS-CID-LATE",
    });
  });

  it("does not shadow a scheduled recurring Pix payment that already owns the paymentId", async () => {
    const store = memoryStore();
    const scheduled = await store.prepare({
      kind: "pix_payment",
      operationKey: "sub-1:2026-09-12",
      subscriptionId: "sub-1",
      externalReference: "contract-1",
      authorizationReference: "aut-1",
      amountMinor: 3990,
      dueDate: "2026-09-12",
    });
    await store.markCreated({
      kind: "pix_payment",
      operationKey: scheduled.operation.operationKey,
      externalId: "pay_recurring_1",
      externalReference: "contract-1",
      authorizationReference: "aut-1",
    });

    const result = await persistAsaasPixInitialPaymentEventCorrelation({
      store,
      event: persistedEvent({
        id: "evt_recurring",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_recurring_1",
          conciliationIdentifier: "CID-RECURRING",
        },
      }),
    });

    expect(result).toMatchObject({
      operationKey: "sub-1:2026-09-12",
      existingScheduledPayment: true,
    });
    await expect(
      store.get("pix_payment", "pix-initial-payment-event:pay_recurring_1")
    ).resolves.toBeNull();
  });

  it("does not correlate an unknown conciliationIdentifier to another subscription", async () => {
    const store = memoryStore();
    await persistPixInitialPaymentCorrelation({
      store,
      contractKey: "contract-known",
      subscriptionId: "sub-known",
      authorizationId: "aut-known",
      conciliationIdentifier: "ASAAS-CID-KNOWN",
    });
    await persistAsaasPixInitialPaymentEventCorrelation({
      store,
      event: persistedEvent({
        id: "evt_unknown",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_unknown",
          conciliationIdentifier: "ASAAS-CID-UNKNOWN",
        },
      }),
    });

    const wrapped = createConciliationAwareAsaasOperationStore(store);
    await expect(
      wrapped.findByExternalId("pix_payment", "pay_unknown")
    ).resolves.toMatchObject({ subscriptionId: null });
  });

  it("WEBHOOK-PERSIST-BEFORE-CORRELATION-001 rejects missing event identity with zero Pix mutation", async () => {
    const store = memoryStore();
    const runtime = createAsaasWebhookRuntime({
      webhookToken: "secret-123",
      adapter: {} as AsaasAdapter,
      store,
    });
    let statusCode = 0;
    const response = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };
    const request = {
      headers: { "asaas-access-token": "secret-123" },
      body: Buffer.from(
        JSON.stringify({
          event: "PAYMENT_RECEIVED",
          payment: {
            id: "pay_missing_event_id",
            value: 39.9,
            conciliationIdentifier: "CID-MISSING-EVENT-ID",
          },
        })
      ),
    };

    await runtime.handle(
      request as Parameters<typeof runtime.handle>[0],
      response as Parameters<typeof runtime.handle>[1]
    );

    expect(statusCode).toBe(400);
    await expect(
      store.findByExternalId("pix_payment", "pay_missing_event_id")
    ).resolves.toBeNull();
    await expect(
      store.findByPublicReference("reconciliation", "CID-MISSING-EVENT-ID")
    ).resolves.toBeNull();
  });

  it("WEBHOOK-DUPLICATE-CORRELATION-001 keeps replay of the same durable event idempotent", async () => {
    const base = memoryStore();
    let markCreatedCalls = 0;
    const store: AsaasOperationStore = {
      ...base,
      async markCreated(input) {
        markCreatedCalls += 1;
        return base.markCreated(input);
      },
    };
    const event = persistedEvent({
      id: "evt_duplicate_pix",
      event: "PAYMENT_RECEIVED",
      payment: {
        id: "pay_duplicate_pix",
        value: 39.9,
        dueDate: "2026-08-12",
        conciliationIdentifier: "CID-DUPLICATE-PIX",
      },
    });

    const first = await processAsaasPixCorrelationForPersistedEvent({
      store,
      event,
    });
    const second = await processAsaasPixCorrelationForPersistedEvent({
      store,
      event,
    });

    expect(first?.operationKey).toBe(
      "pix-initial-payment-event:pay_duplicate_pix"
    );
    expect(second?.operationKey).toBe(first?.operationKey);
    expect(markCreatedCalls).toBe(1);
    await expect(
      store.findByExternalId("pix_payment", "pay_duplicate_pix")
    ).resolves.toMatchObject({
      state: "created",
      correlationId: "evt_duplicate_pix",
      publicReference: "CID-DUPLICATE-PIX",
    });
  });


  it("WEBHOOK-AUTH-DURABLE-CORRELATION-001 rebuilds the Pix mapping from persisted authorization metadata", async () => {
    const store = memoryStore();
    const authorization = await store.prepare({
      kind: "pix_automatic_authorization",
      operationKey: "contract-auth:pix-automatic",
      subscriptionId: "sub-auth",
      externalReference: "contract-auth",
      publicReference: "ASAAS-CONTRACT-AUTH",
    });
    await store.markCreated({
      kind: "pix_automatic_authorization",
      operationKey: authorization.operation.operationKey,
      externalId: "aut-auth",
      externalReference: "contract-auth",
      authorizationReference: "aut-auth",
      publicReference: "ASAAS-CONTRACT-AUTH",
    });
    const event = persistedEvent({
      id: "evt_auth_durable",
      event: "PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED",
      authorization: {
        id: "aut-auth",
        contractId: "ASAAS-CONTRACT-AUTH",
        immediateQrCode: {
          conciliationIdentifier: "CID-AUTH-DURABLE",
          rawSecret: "must-not-survive",
        },
      },
    });

    await processAsaasPixCorrelationForPersistedEvent({ store, event });

    expect(event.metadata).toMatchObject({
      authorizationReference: "aut-auth",
      contractReference: "ASAAS-CONTRACT-AUTH",
      publicReference: "CID-AUTH-DURABLE",
    });
    expect(JSON.stringify(event.metadata)).not.toContain("must-not-survive");
    await expect(
      store.findByPublicReference("reconciliation", "CID-AUTH-DURABLE")
    ).resolves.toMatchObject({
      state: "created",
      subscriptionId: "sub-auth",
      externalId: "aut-auth",
      externalReference: "contract-auth",
      authorizationReference: "aut-auth",
    });
  });

});
