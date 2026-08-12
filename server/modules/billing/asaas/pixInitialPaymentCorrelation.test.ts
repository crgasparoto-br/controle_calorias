import { describe, expect, it } from "vitest";
import { createAsaasClient, AsaasUncertainOutcomeError } from "./client";
import {
  createAsaasAdapter,
  persistPixInitialPaymentCorrelation,
} from "./adapter";
import {
  createConciliationAwareAsaasOperationStore,
  normalizeAsaasWebhookEnvelope,
  persistAsaasPixInitialPaymentEventCorrelation,
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
      envelope: {
        id: "evt_initial_pix",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_initial_1",
          value: 39.9,
          dueDate: "2026-08-12",
          conciliationIdentifier: "ASAAS-CID-LATE",
        },
      },
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
      envelope: {
        id: "evt_recurring",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_recurring_1",
          conciliationIdentifier: "CID-RECURRING",
        },
      },
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
      envelope: {
        id: "evt_unknown",
        event: "PAYMENT_RECEIVED",
        payment: {
          id: "pay_unknown",
          conciliationIdentifier: "ASAAS-CID-UNKNOWN",
        },
      },
    });

    const wrapped = createConciliationAwareAsaasOperationStore(store);
    await expect(
      wrapped.findByExternalId("pix_payment", "pay_unknown")
    ).resolves.toMatchObject({ subscriptionId: null });
  });
});
