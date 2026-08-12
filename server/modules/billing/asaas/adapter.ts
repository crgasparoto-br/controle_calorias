import type { BillingProviderPaymentFlowInput } from "../provider";
import { AsaasUncertainOutcomeError, type AsaasClient } from "./client";
import {
  businessWeekdaysUntil,
  createAsaasAdapter as createBaseAsaasAdapter,
  shouldCreateScheduledPixPayment,
  type AsaasCustomerResponse,
} from "./adapterCore";
import type { AsaasOperationStore } from "./operationStore";

export { businessWeekdaysUntil, shouldCreateScheduledPixPayment };
export type { AsaasCustomerResponse };

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeCustomerDocument(value: unknown) {
  const raw = textValue(value);
  if (!raw) throw new Error("asaas_customer_document_required");
  const digits = raw.replace(/[.\-/\s]/g, "");
  if (!/^\d+$/.test(digits) || (digits.length !== 11 && digits.length !== 14)) {
    throw new Error("asaas_customer_document_invalid");
  }
  return digits;
}

export async function persistPixInitialPaymentCorrelation(input: {
  store: AsaasOperationStore;
  contractKey: string;
  subscriptionId?: string | null;
  authorizationId: string;
  conciliationIdentifier: string;
}) {
  const contractKey = textValue(input.contractKey);
  const authorizationId = textValue(input.authorizationId);
  const conciliationIdentifier = textValue(input.conciliationIdentifier);
  if (!contractKey || !authorizationId || !conciliationIdentifier) {
    throw new Error("asaas_pix_initial_payment_correlation_required");
  }

  const operationKey = `${contractKey}:pix-initial-payment`;
  const prepared = await input.store.prepare({
    kind: "reconciliation",
    operationKey,
    subscriptionId: input.subscriptionId ?? null,
    externalReference: contractKey,
    authorizationReference: authorizationId,
    publicReference: conciliationIdentifier,
  });
  const existing = prepared.operation;
  if (
    (existing.externalId && existing.externalId !== authorizationId) ||
    (existing.externalReference && existing.externalReference !== contractKey) ||
    (existing.authorizationReference &&
      existing.authorizationReference !== authorizationId) ||
    (existing.publicReference &&
      existing.publicReference !== conciliationIdentifier) ||
    (existing.subscriptionId &&
      input.subscriptionId &&
      existing.subscriptionId !== input.subscriptionId)
  ) {
    throw new Error("asaas_pix_initial_payment_correlation_conflict");
  }

  if (input.subscriptionId && !existing.subscriptionId) {
    await input.store.bindSubscription(
      "reconciliation",
      operationKey,
      input.subscriptionId
    );
  }
  if (existing.state !== "created") {
    await input.store.markCreated({
      kind: "reconciliation",
      operationKey,
      externalId: authorizationId,
      externalReference: contractKey,
      authorizationReference: authorizationId,
      publicReference: conciliationIdentifier,
    });
  }
  return input.store.get("reconciliation", operationKey);
}

function createConciliationAwareClient(input: {
  client: AsaasClient;
  store: AsaasOperationStore;
}): AsaasClient {
  return {
    ...input.client,
    async post<T>(path: string, body: unknown) {
      const result = await input.client.post<T>(path, body);
      if (path !== "/pix/automatic/authorizations") return result;

      try {
        const request = recordValue(body);
        const contractId = textValue(request?.contractId);
        if (!contractId) {
          throw new Error("asaas_pix_contract_id_missing");
        }
        const operation = await input.store.findByPublicReference(
          "pix_automatic_authorization",
          contractId
        );
        if (!operation) {
          throw new Error("asaas_pix_authorization_operation_missing");
        }

        // Direct adapter/unit uses may not have a local subscription yet. The real
        // paid Pix flow prepares the provider-neutral subscription before outbound.
        if (!operation.subscriptionId) return result;

        const response = recordValue(result);
        const immediateQrCode = recordValue(response?.immediateQrCode);
        const authorizationId = textValue(response?.id);
        const conciliationIdentifier = textValue(
          immediateQrCode?.conciliationIdentifier
        );
        if (
          !authorizationId ||
          !conciliationIdentifier ||
          !operation.externalReference
        ) {
          throw new Error("asaas_pix_initial_payment_correlation_missing");
        }
        await persistPixInitialPaymentCorrelation({
          store: input.store,
          contractKey: operation.externalReference,
          subscriptionId: operation.subscriptionId,
          authorizationId,
          conciliationIdentifier,
        });
      } catch (error) {
        if (error instanceof AsaasUncertainOutcomeError) throw error;
        throw new AsaasUncertainOutcomeError(
          "asaas_pix_initial_payment_correlation_persistence_failed"
        );
      }
      return result;
    },
  };
}

export function createAsaasAdapter(input: {
  client: AsaasClient;
  store: AsaasOperationStore;
  enabledPaymentMethods: readonly BillingProviderPaymentFlowInput["paymentMethod"][];
  now?: () => Date;
}) {
  const adapter = createBaseAsaasAdapter({
    ...input,
    client: createConciliationAwareClient({
      client: input.client,
      store: input.store,
    }),
  });
  return {
    ...adapter,
    async createPaymentFlow(flow: BillingProviderPaymentFlowInput) {
      return adapter.createPaymentFlow({
        ...flow,
        customer: {
          ...flow.customer,
          cpfCnpj: normalizeCustomerDocument(flow.customer.cpfCnpj),
        },
      });
    },
    persistPixInitialPaymentCorrelation: (correlation: {
      contractKey: string;
      subscriptionId?: string | null;
      authorizationId: string;
      conciliationIdentifier: string;
    }) => persistPixInitialPaymentCorrelation({ store: input.store, ...correlation }),
  };
}

export type AsaasAdapter = ReturnType<typeof createAsaasAdapter>;
