import {
  authenticateAsaasWebhook,
  authoritativePaymentOccurredAt,
  createAsaasWebhookRuntime as createBaseAsaasWebhookRuntime,
  financialKind,
  financialKindFromPaymentStatus,
  isPixAuthorizationActivated,
  isPixAuthorizationTerminal,
  normalizeAsaasWebhookEnvelope,
  type AsaasWebhookEnvelope,
  type PersistedWebhookRow,
} from "./webhookCore";
import {
  persistPixInitialPaymentCorrelation,
  type AsaasAdapter,
} from "./adapter";
import type { AsaasOperationStore } from "./operationStore";

export type { AsaasWebhookEnvelope, PersistedWebhookRow };
export {
  authenticateAsaasWebhook,
  authoritativePaymentOccurredAt,
  financialKind,
  financialKindFromPaymentStatus,
  isPixAuthorizationActivated,
  isPixAuthorizationTerminal,
  normalizeAsaasWebhookEnvelope,
};

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataText(event: PersistedWebhookRow, key: string) {
  return textValue(event.metadata[key]);
}

export async function persistAsaasHostedCheckoutCustomerCorrelation(input: {
  store: AsaasOperationStore;
  adapter: AsaasAdapter;
  event: PersistedWebhookRow;
}) {
  if (input.event.eventType !== "SUBSCRIPTION_CREATED") return null;
  const contractKey = metadataText(input.event, "contractReference");
  const customerId = metadataText(input.event, "customerReference");
  if (!contractKey || !customerId) return null;

  const checkout = await input.store.get("checkout", `${contractKey}:checkout`);
  if (!checkout?.payerUserId) return null;

  await input.adapter.rememberHostedCheckoutCustomer(
    checkout.payerUserId,
    customerId
  );
  return {
    payerUserId: checkout.payerUserId,
    customerId,
  };
}

export async function persistAsaasPixInitialPaymentEventCorrelation(input: {
  store: AsaasOperationStore;
  event: PersistedWebhookRow;
}) {
  const paymentId = metadataText(input.event, "objectId");
  const conciliationIdentifier = metadataText(input.event, "publicReference");
  if (
    !input.event.eventType.startsWith("PAYMENT_") ||
    !paymentId ||
    !conciliationIdentifier
  ) {
    return null;
  }

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
  const amountMinor = numberValue(input.event.metadata.amountMinor);
  const prepared = await input.store.prepare({
    kind: "pix_payment",
    operationKey,
    subscriptionId: mapping?.subscriptionId ?? null,
    externalReference: mapping?.externalReference ?? null,
    authorizationReference:
      mapping?.authorizationReference ?? mapping?.externalId ?? null,
    publicReference: conciliationIdentifier,
    correlationId: input.event.providerEventId,
    amountMinor,
    dueDate: metadataText(input.event, "dueDate"),
  });
  if (
    (prepared.operation.externalId &&
      prepared.operation.externalId !== paymentId) ||
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
  event: PersistedWebhookRow;
}) {
  if (!input.event.eventType.startsWith("PIX_AUTOMATIC_")) return null;
  const authorizationId =
    metadataText(input.event, "authorizationReference") ??
    metadataText(input.event, "objectId");
  const conciliationIdentifier = metadataText(input.event, "publicReference");
  if (!authorizationId || !conciliationIdentifier) return null;

  let operation = await input.store.findByExternalId(
    "pix_automatic_authorization",
    authorizationId
  );
  const contractId = metadataText(input.event, "contractReference");
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

export async function processAsaasPixCorrelationForPersistedEvent(input: {
  store: AsaasOperationStore;
  event: PersistedWebhookRow;
}) {
  await recoverAsaasPixInitialPaymentCorrelationFromAuthorization(input);
  return persistAsaasPixInitialPaymentEventCorrelation(input);
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
        externalReference:
          direct.externalReference ?? mapping.externalReference,
        authorizationReference:
          direct.authorizationReference ??
          mapping.authorizationReference ??
          mapping.externalId,
      };
    },
    async get(kind, operationKey) {
      const direct = await store.get(kind, operationKey);
      if (
        direct ||
        kind !== "checkout" ||
        !operationKey.endsWith(":checkout")
      ) {
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

export function createAsaasWebhookRuntime(input: {
  webhookToken: string;
  adapter: AsaasAdapter;
  store: AsaasOperationStore;
}) {
  const store = createConciliationAwareAsaasOperationStore(input.store);
  return createBaseAsaasWebhookRuntime({
    ...input,
    store,
    beforeProcessEvent: async event => {
      await persistAsaasHostedCheckoutCustomerCorrelation({
        store: input.store,
        adapter: input.adapter,
        event,
      });
      await processAsaasPixCorrelationForPersistedEvent({
        store: input.store,
        event,
      });
    },
  });
}
