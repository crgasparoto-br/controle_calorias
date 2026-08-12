import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  requireDb,
  resultRows,
} from "../../../repositories/billingRepositorySupport";
import {
  billingSubscriptionLifecycleRepository,
  billingSubscriptionLifecycleService,
} from "../subscriptionLifecycleRuntime";
import { persistPixInitialPaymentCorrelation } from "./adapter";
import {
  createAsaasClient,
  type AsaasClient,
  type AsaasEnvironment,
} from "./client";
import {
  createDrizzleAsaasOperationStore,
  type AsaasOperation,
  type AsaasOperationStore,
} from "./operationStore";

type PixAuthorizationResponse = {
  id?: string;
  status?: string;
  contractId?: string;
  customerId?: string;
  immediateQrCode?: {
    conciliationIdentifier?: string;
  };
};

type PixAuthorizationListResponse = {
  data?: PixAuthorizationResponse[];
  hasMore?: boolean;
  totalCount?: number;
  limit?: number;
  offset?: number;
};

export type PixAuthorizationReadOutcome =
  | {
      status: "reconciled";
      externalId: string;
      remoteStatus: string | null;
      conciliationIdentifier: string | null;
    }
  | {
      status: "terminal";
      externalId: string;
      remoteStatus: string;
      conciliationIdentifier: string | null;
    }
  | {
      status: "pending";
      reason: "not_found" | "not_found_first_page" | "operation_not_uncertain";
    }
  | {
      status: "reused";
      externalId: string;
    }
  | {
      status: "failed";
    };

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function environment(): AsaasEnvironment {
  return process.env.ASAAS_ENV?.trim().toLowerCase() === "production"
    ? "production"
    : "sandbox";
}

function apiKey() {
  return (
    environment() === "production"
      ? process.env.ASAAS_PRODUCTION_API_KEY
      : process.env.ASAAS_SANDBOX_API_KEY
  )?.trim() ?? "";
}

function webhookToken() {
  return (
    environment() === "production"
      ? process.env.ASAAS_PRODUCTION_WEBHOOK_TOKEN
      : process.env.ASAAS_SANDBOX_WEBHOOK_TOKEN
  )?.trim() ?? "";
}

function requestTimeoutMs() {
  const value = Number(process.env.ASAAS_REQUEST_TIMEOUT_MS ?? 60_000);
  return Number.isFinite(value) && value >= 1_000 ? value : 60_000;
}

function pixAutomaticEnabled() {
  const configured = (
    process.env.ASAAS_ENABLED_PAYMENT_METHODS ?? "credit_card,pix_automatic"
  )
    .split(",")
    .map(value => value.trim())
    .filter(Boolean);
  return !!apiKey() && !!webhookToken() && configured.includes("pix_automatic");
}

function createReadClient() {
  const key = apiKey();
  if (!key) throw new Error("asaas_not_configured");
  return createAsaasClient({
    environment: environment(),
    apiKey: key,
    timeoutMs: requestTimeoutMs(),
  });
}

function isTerminalAuthorizationStatus(status: string | null) {
  return !!status && ["CANCELLED", "CANCELED", "EXPIRED", "REFUSED"].includes(status);
}

/**
 * Performs exactly one provider read for an uncertain Pix Automático creation.
 * It never retries the original POST. Local persistence is intentionally left
 * to the caller so provider observation and state transition remain explicit.
 */
export async function readAsaasPixAuthorizationOutcome(input: {
  client: Pick<AsaasClient, "get">;
  operation: AsaasOperation;
}): Promise<PixAuthorizationReadOutcome> {
  const operation = input.operation;
  if (operation.kind !== "pix_automatic_authorization") {
    throw new Error("asaas_pix_authorization_reconciliation_kind_invalid");
  }
  if (operation.state === "created" && operation.externalId) {
    return { status: "reused", externalId: operation.externalId };
  }
  if (operation.state === "failed") {
    return { status: "failed" };
  }
  if (operation.state !== "outcome_unknown") {
    return { status: "pending", reason: "operation_not_uncertain" };
  }

  const customerId = textValue(operation.customerReference);
  const contractId = textValue(operation.publicReference);
  if (!customerId || !contractId) {
    throw new Error("asaas_pix_authorization_reconciliation_context_missing");
  }

  const response = await input.client.get<PixAuthorizationListResponse>(
    "/pix/automatic/authorizations",
    { customerId, limit: 100 }
  );
  const matches = (response.data ?? []).filter(item => {
    const id = textValue(item.id);
    const remoteContractId = textValue(item.contractId);
    const remoteCustomerId = textValue(item.customerId);
    return (
      !!id &&
      remoteContractId === contractId &&
      (!remoteCustomerId || remoteCustomerId === customerId)
    );
  });

  if (matches.length > 1) {
    throw new Error("asaas_pix_authorization_reconciliation_ambiguous");
  }
  if (matches.length === 0) {
    return {
      status: "pending",
      reason: response.hasMore ? "not_found_first_page" : "not_found",
    };
  }

  const match = matches[0]!;
  const externalId = textValue(match.id);
  if (!externalId) throw new Error("asaas_pix_authorization_id_missing");
  const remoteStatus = textValue(match.status)?.toUpperCase() ?? null;
  const conciliationIdentifier = textValue(
    match.immediateQrCode?.conciliationIdentifier
  );

  if (isTerminalAuthorizationStatus(remoteStatus)) {
    return {
      status: "terminal",
      externalId,
      remoteStatus: remoteStatus!,
      conciliationIdentifier,
    };
  }

  return {
    status: "reconciled",
    externalId,
    remoteStatus,
    conciliationIdentifier,
  };
}

async function persistReadOutcome(input: {
  store: AsaasOperationStore;
  operation: AsaasOperation;
  outcome: PixAuthorizationReadOutcome;
}) {
  const { store, operation, outcome } = input;
  if (outcome.status === "reconciled") {
    await store.markCreated({
      kind: "pix_automatic_authorization",
      operationKey: operation.operationKey,
      externalId: outcome.externalId,
      externalReference: operation.externalReference,
      customerReference: operation.customerReference,
      authorizationReference: outcome.externalId,
      publicReference: operation.publicReference,
    });
    if (
      outcome.conciliationIdentifier &&
      operation.externalReference &&
      operation.subscriptionId
    ) {
      await persistPixInitialPaymentCorrelation({
        store,
        contractKey: operation.externalReference,
        subscriptionId: operation.subscriptionId,
        authorizationId: outcome.externalId,
        conciliationIdentifier: outcome.conciliationIdentifier,
      });
    }
    return;
  }

  if (outcome.status !== "terminal") return;

  if (operation.subscriptionId) {
    await billingSubscriptionLifecycleService.applyFinancialFact({
      providerCode: "asaas",
      providerEventId: `reconcile:pix-authorization:${outcome.externalId}:${outcome.remoteStatus}`,
      subscriptionId: operation.subscriptionId,
      kind: "attempt_expired",
      occurredAt: new Date(),
      competenceKey: outcome.externalId,
      correlationId: `asaas:reconcile:${outcome.externalId}`,
    });
  }
  if (operation.externalReference) {
    await billingSubscriptionLifecycleRepository.cancelCouponReservation(
      operation.externalReference
    );
  }
  await store.markFailed(
    "pix_automatic_authorization",
    operation.operationKey,
    "authorization_closed"
  );
}

async function loadOutcomeUnknownOperations(input: {
  store: AsaasOperationStore;
  limit: number;
}) {
  const db = await requireDb(getDb);
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.operationReference')) AS operationKey
      FROM billingProviderEvents
      WHERE provider = 'asaas'
        AND eventType = 'local_pix_automatic_authorization'
        AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'outcome_unknown'
      ORDER BY updatedAt ASC
      LIMIT ${Math.max(1, Math.min(500, input.limit))}
    `)
  );
  const operations: AsaasOperation[] = [];
  for (const row of rows) {
    const operationKey = textValue(row.operationKey);
    if (!operationKey) continue;
    const operation = await input.store.get(
      "pix_automatic_authorization",
      operationKey
    );
    if (operation?.state === "outcome_unknown") operations.push(operation);
  }
  return operations;
}

export async function reconcileAsaasPixAuthorizationOperation(input: {
  client: Pick<AsaasClient, "get">;
  store: AsaasOperationStore;
  operation: AsaasOperation;
}) {
  const outcome = await readAsaasPixAuthorizationOutcome(input);
  await persistReadOutcome({
    store: input.store,
    operation: input.operation,
    outcome,
  });
  return outcome;
}

export async function reconcileAsaasPixAuthorizationContract(contractKey: string) {
  const normalized = contractKey.trim();
  if (!normalized) throw new Error("asaas_contract_reference_required");
  const store = createDrizzleAsaasOperationStore();
  const operation = await store.get(
    "pix_automatic_authorization",
    `${normalized}:pix-automatic`
  );
  if (!operation) return { found: false as const };
  if (operation.state !== "outcome_unknown") {
    return {
      found: true as const,
      operationState: operation.state,
      externalId: operation.externalId,
      reconciliation: operation.state === "created" ? "reused" : "not_required",
    };
  }
  const outcome = await reconcileAsaasPixAuthorizationOperation({
    client: createReadClient(),
    store,
    operation,
  });
  return {
    found: true as const,
    operationState: operation.state,
    externalId:
      outcome.status === "reconciled" ||
      outcome.status === "terminal" ||
      outcome.status === "reused"
        ? outcome.externalId
        : operation.externalId,
    reconciliation: outcome.status,
    ...(outcome.status === "pending" ? { reason: outcome.reason } : {}),
  };
}

export async function reconcileAsaasUnknownPixAuthorizations(limit = 100) {
  if (!pixAutomaticEnabled()) {
    return {
      configured: false as const,
      scanned: 0,
      reconciled: 0,
      terminal: 0,
      pending: 0,
      failed: 0,
    };
  }

  const store = createDrizzleAsaasOperationStore();
  const client = createReadClient();
  const operations = await loadOutcomeUnknownOperations({ store, limit });
  let reconciled = 0;
  let terminal = 0;
  let pending = 0;
  let failed = 0;

  for (const operation of operations) {
    try {
      const outcome = await reconcileAsaasPixAuthorizationOperation({ client, store, operation });
      if (outcome.status === "reconciled" || outcome.status === "reused") {
        reconciled += 1;
      } else if (outcome.status === "terminal") {
        terminal += 1;
      } else {
        pending += 1;
      }
    } catch (error) {
      failed += 1;
      console.warn("[Billing/Asaas] Pix authorization reconciliation deferred", {
        operationId: operation.id,
        error: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  return {
    configured: true as const,
    scanned: operations.length,
    reconciled,
    terminal,
    pending,
    failed,
  };
}

let schedulerStarted = false;

export function startAsaasPixAuthorizationRecoveryScheduler() {
  if (schedulerStarted || !pixAutomaticEnabled()) return;
  schedulerStarted = true;
  const intervalMs = Math.max(
    60_000,
    Number(process.env.ASAAS_RECONCILIATION_INTERVAL_MS ?? 300_000) || 300_000
  );
  const run = () => {
    void reconcileAsaasUnknownPixAuthorizations().catch(error => {
      console.warn("[Billing/Asaas] Pix authorization recovery cycle failed", {
        error: error instanceof Error ? error.name : "unknown",
      });
    });
  };
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
}
