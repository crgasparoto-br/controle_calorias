import type { Request, Response } from "express";
import {
  authenticateAsaasWebhook,
  createAsaasWebhookRuntime as createBaseAsaasWebhookRuntime,
  financialKind,
  isPixAuthorizationActivated,
  isPixAuthorizationTerminal,
  normalizeAsaasWebhookEnvelope as normalizeBaseAsaasWebhookEnvelope,
  type AsaasWebhookEnvelope,
} from "./webhookCore";
import {
  persistPixInitialPaymentCorrelation,
  type AsaasAdapter,
} from "./adapter";
import type { AsaasOperationStore } from "./operationStore";

export type { AsaasWebhookEnvelope };
export {
  authenticateAsaasWebhook,
  financialKind,
  isPixAuthorizationActivated,
  isPixAuthorizationTerminal,
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function pixConciliationIdentifier(envelope: AsaasWebhookEnvelope) {
  const immediateQrCode = recordValue(envelope.authorization?.immediateQrCode);
  return (
    textValue(envelope.payment?.conciliationIdentifier) ??
    textValue(immediateQrCode?.conciliationIdentifier)
  );
}

export function normalizeAsaasWebhookEnvelope(envelope: AsaasWebhookEnvelope) {
  const normalized = normalizeBaseAsaasWebhookEnvelope(envelope);
  const conciliationIdentifier = pixConciliationIdentifier(envelope);
  if (!conciliationIdentifier) return normalized;
  return {
    ...normalized,
    metadata: {
      ...(normalized.metadata ?? {}),
      publicReference: conciliationIdentifier,
    },
  };
}

function parseRawEnvelope(req: Request): AsaasWebhookEnvelope | null {
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : req.body instanceof Uint8Array
      ? Buffer.from(req.body)
      : null;
  if (!raw || raw.byteLength === 0 || raw.byteLength > 128 * 1024) return null;
  try {
    const parsed = JSON.parse(raw.toString("utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as AsaasWebhookEnvelope)
      : null;
  } catch {
    return null;
  }
}

export async function persistAsaasPixInitialPaymentEventCorrelation(input: {
  store: AsaasOperationStore;
  envelope: AsaasWebhookEnvelope;
}) {
  const payment = input.envelope.payment;
  const paymentId = textValue(payment?.id);
  const conciliationIdentifier = pixConciliationIdentifier(input.envelope);
  if (!paymentId || !conciliationIdentifier) return null;

  const existingPayment = await input.store.findByExternalId(
    "pix_payment",
    paymentId
  );
  if (
    existingPayment &&
    !existingPayment.operationKey.startsWith("pix-initial-payment-event:")
  ) {
    return {
      operationKey: existingPayment.operationKey,
      paymentId,
      conciliationIdentifier,
      mapping: null,
      existingScheduledPayment: true,
    };
  }

  const mapping = await input.store.findByPublicReference(
    "reconciliation",
    conciliationIdentifier
  );
  const operationKey = `pix-initial-payment-event:${paymentId}`;
  const value = numberValue(payment?.value);
  const prepared = await input.store.prepare({
    kind: "pix_payment",
    operationKey,
    subscriptionId: mapping?.subscriptionId ?? null,
    externalReference: mapping?.externalReference ?? null,
    authorizationReference:
      mapping?.authorizationReference ?? mapping?.externalId ?? null,
    publicReference: conciliationIdentifier,
    correlationId:
      textValue(input.envelope.id) ??
      textValue(input.envelope.event) ??
      operationKey,
    amountMinor: value === null ? null : Math.round(value * 100),
    dueDate: textValue(payment?.dueDate),
  });
  if (
    (prepared.operation.externalId && prepared.operation.externalId !== paymentId) ||
    (prepared.operation.publicReference &&
      prepared.operation.publicReference !== conciliationIdentifier)
  ) {
    throw new Error("asaas_pix_initial_payment_event_correlation_conflict");
  }
  if (
    mapping?.subscriptionId &&
    prepared.operation.subscriptionId &&
    prepared.operation.subscriptionId !== mapping.subscriptionId
  ) {
    throw new Error("asaas_pix_initial_payment_event_subscription_conflict");
  }
  if (mapping?.subscriptionId && !prepared.operation.subscriptionId) {
    await input.store.bindSubscription(
      "pix_payment",
      operationKey,
      mapping.subscriptionId
    );
  }
  if (prepared.operation.state !== "created") {
    await input.store.markCreated({
      kind: "pix_payment",
      operationKey,
      externalId: paymentId,
      externalReference: mapping?.externalReference ?? null,
      authorizationReference:
        mapping?.authorizationReference ?? mapping?.externalId ?? null,
      publicReference: conciliationIdentifier,
    });
  }
  return {
    operationKey,
    paymentId,
    conciliationIdentifier,
    mapping,
  };
}

export async function recoverAsaasPixInitialPaymentCorrelationFromAuthorization(input: {
  store: AsaasOperationStore;
  envelope: AsaasWebhookEnvelope;
}) {
  const authorization = input.envelope.authorization;
  const authorizationId = textValue(authorization?.id);
  const conciliationIdentifier = pixConciliationIdentifier(input.envelope);
  if (!authorizationId || !conciliationIdentifier) return null;

  let operation = await input.store.findByExternalId(
    "pix_automatic_authorization",
    authorizationId
  );
  const contractId = textValue(authorization?.contractId);
  if (!operation && contractId) {
    operation = await input.store.findByPublicReference(
      "pix_automatic_authorization",
      contractId
    );
  }
  if (!operation?.externalReference) return null;

  return persistPixInitialPaymentCorrelation({
    store: input.store,
    contractKey: operation.externalReference,
    subscriptionId: operation.subscriptionId,
    authorizationId,
    conciliationIdentifier,
  });
}

export function createConciliationAwareAsaasOperationStore(
  store: AsaasOperationStore
): AsaasOperationStore {
  return {
    ...store,
    async findByExternalId(kind, externalId) {
      const direct = await store.findByExternalId(kind, externalId);
      if (
        kind !== "pix_payment" ||
        !direct ||
        direct.subscriptionId ||
        !direct.publicReference
      ) {
        return direct;
      }
      const mapping = await store.findByPublicReference(
        "reconciliation",
        direct.publicReference
      );
      if (!mapping?.subscriptionId) return direct;
      return {
        ...direct,
        subscriptionId: mapping.subscriptionId,
        externalReference: direct.externalReference ?? mapping.externalReference,
        authorizationReference:
          direct.authorizationReference ??
          mapping.authorizationReference ??
          mapping.externalId,
      };
    },
    async get(kind, operationKey) {
      const direct = await store.get(kind, operationKey);
      if (direct || kind !== "checkout" || !operationKey.endsWith(":checkout")) {
        return direct;
      }
      const contractKey = operationKey.slice(0, -":checkout".length);
      return store.get(
        "pix_automatic_authorization",
        `${contractKey}:pix-automatic`
      );
    },
  };
}

function enrichPaymentEnvelope(
  envelope: AsaasWebhookEnvelope,
  mapping: Awaited<
    ReturnType<AsaasOperationStore["findByPublicReference"]>
  >
) {
  if (!mapping || !envelope.payment) return envelope;
  const authorizationId = mapping.authorizationReference ?? mapping.externalId;
  if (!mapping.externalReference && !authorizationId) return envelope;
  return {
    ...envelope,
    payment: {
      ...envelope.payment,
      ...(mapping.externalReference
        ? { externalReference: mapping.externalReference }
        : {}),
      ...(authorizationId
        ? { pixAutomaticAuthorizationId: authorizationId }
        : {}),
    },
  };
}

export function createAsaasWebhookRuntime(input: {
  webhookToken: string;
  adapter: AsaasAdapter;
  store: AsaasOperationStore;
}) {
  const store = createConciliationAwareAsaasOperationStore(input.store);
  const runtime = createBaseAsaasWebhookRuntime({ ...input, store });
  return {
    ...runtime,
    async handle(req: Request, res: Response) {
      if (
        !authenticateAsaasWebhook(
          req.headers as Record<string, string | string[] | undefined>,
          input.webhookToken
        )
      ) {
        return runtime.handle(req, res);
      }

      const envelope = parseRawEnvelope(req);
      if (!envelope) return runtime.handle(req, res);
      try {
        await recoverAsaasPixInitialPaymentCorrelationFromAuthorization({
          store: input.store,
          envelope,
        });
        const paymentCorrelation =
          await persistAsaasPixInitialPaymentEventCorrelation({
            store: input.store,
            envelope,
          });
        if (paymentCorrelation?.mapping) {
          req.body = Buffer.from(
            JSON.stringify(
              enrichPaymentEnvelope(envelope, paymentCorrelation.mapping)
            )
          );
        }
      } catch (error) {
        console.warn("[Billing/Asaas] Pix initial payment correlation failed", {
          error: error instanceof Error ? error.name : "unknown",
        });
        res.status(503).json({ ok: false });
        return;
      }
      return runtime.handle(req, res);
    },
  };
}
