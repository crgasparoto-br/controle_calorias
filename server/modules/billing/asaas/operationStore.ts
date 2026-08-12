import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import {
  dateOrNull,
  isDuplicateEntryError,
  requireDb,
  resultRows,
} from "../../../repositories/billingRepositorySupport";
import type { BillingCycle, BillingPaymentMethod } from "../catalogPolicy";
import { sanitizeBillingProviderEventMetadata } from "../providerEvents";
import type { BillingTrialChoice } from "../subscriptionLifecycleTypes";

export type AsaasOperationKind =
  | "customer"
  | "checkout"
  | "pix_automatic_authorization"
  | "pix_payment"
  | "coupon_charge"
  | "coupon_reset"
  | "reconciliation";

export type AsaasOperationState =
  | "prepared"
  | "created"
  | "outcome_unknown"
  | "failed";

export function isAsaasProviderTerminalFailure(
  kind: AsaasOperationKind,
  errorCode: string
) {
  return (
    (kind === "checkout" && errorCode === "checkout_expired") ||
    (kind === "pix_automatic_authorization" && errorCode === "authorization_closed")
  );
}

export type AsaasOperation = {
  id: string;
  kind: AsaasOperationKind;
  operationKey: string;
  state: AsaasOperationState;
  subscriptionId: string | null;
  externalId: string | null;
  externalReference: string | null;
  customerReference: string | null;
  authorizationReference: string | null;
  publicReference: string | null;
  payerUserId: number | null;
  planCode: string | null;
  paymentMethod: BillingPaymentMethod | null;
  trialChoice: BillingTrialChoice | null;
  couponCode: string | null;
  billingCycle: BillingCycle | "custom" | null;
  correlationId: string | null;
  amountMinor: number | null;
  unitAmountMinor: number | null;
  discountDurationCharges: number | null;
  transitionAccessUntil: Date | null;
  dueDate: string | null;
  updatedAt: Date | null;
};

export type PrepareAsaasOperationInput = {
  kind: AsaasOperationKind;
  operationKey: string;
  subscriptionId?: string | null;
  externalReference?: string | null;
  customerReference?: string | null;
  authorizationReference?: string | null;
  publicReference?: string | null;
  payerUserId?: number | null;
  planCode?: string | null;
  paymentMethod?: BillingPaymentMethod | null;
  trialChoice?: BillingTrialChoice | null;
  couponCode?: string | null;
  billingCycle?: BillingCycle | null;
  correlationId?: string | null;
  amountMinor?: number | null;
  unitAmountMinor?: number | null;
  discountDurationCharges?: number | null;
  transitionAccessUntil?: Date | null;
  dueDate?: string | null;
};

export type AsaasOperationStore = {
  get(kind: AsaasOperationKind, operationKey: string): Promise<AsaasOperation | null>;
  prepare(input: PrepareAsaasOperationInput): Promise<{
    operation: AsaasOperation;
    created: boolean;
  }>;
  markCreated(input: {
    kind: AsaasOperationKind;
    operationKey: string;
    externalId: string;
    externalReference?: string | null;
    customerReference?: string | null;
    authorizationReference?: string | null;
    publicReference?: string | null;
  }): Promise<void>;
  bindSubscription(
    kind: AsaasOperationKind,
    operationKey: string,
    subscriptionId: string
  ): Promise<void>;
  markOutcomeUnknown(kind: AsaasOperationKind, operationKey: string): Promise<void>;
  resetOutcomeUnknownToPrepared(
    kind: AsaasOperationKind,
    operationKey: string
  ): Promise<void>;
  markFailed(
    kind: AsaasOperationKind,
    operationKey: string,
    errorCode: string
  ): Promise<void>;
  markProviderTerminal?(input: {
    kind: AsaasOperationKind;
    operationKey: string;
    errorCode: string;
    externalId?: string | null;
    externalReference?: string | null;
    customerReference?: string | null;
    authorizationReference?: string | null;
    publicReference?: string | null;
  }): Promise<void>;
  countCouponCharges(subscriptionId: string): Promise<number>;
  findByExternalId(
    kind: AsaasOperationKind,
    externalId: string
  ): Promise<AsaasOperation | null>;
  findByPublicReference(
    kind: AsaasOperationKind,
    publicReference: string
  ): Promise<AsaasOperation | null>;
  listScheduledPixPayments(limit: number): Promise<AsaasOperation[]>;
};

function providerEventId(kind: AsaasOperationKind, operationKey: string) {
  const digest = crypto.createHash("sha256").update(operationKey).digest("hex");
  return `local:${kind}:${digest}`;
}

function metadataFromRow(row: Record<string, unknown>) {
  const raw = row.payloadJson;
  if (!raw) return {} as Record<string, unknown>;
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw !== "string") return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {} as Record<string, unknown>;
  }
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapOperation(
  row: Record<string, unknown>,
  kind: AsaasOperationKind,
  fallbackOperationKey: string
): AsaasOperation {
  const metadata = metadataFromRow(row);
  const transition = stringOrNull(metadata.transitionAccessUntil);
  const transitionAccessUntil = transition ? new Date(transition) : null;
  return {
    id: String(row.id),
    kind,
    operationKey:
      stringOrNull(metadata.operationReference) ?? fallbackOperationKey,
    state: String(metadata.status ?? "prepared") as AsaasOperationState,
    subscriptionId: row.subscriptionId ? String(row.subscriptionId) : null,
    externalId: stringOrNull(metadata.objectId),
    externalReference:
      stringOrNull(metadata.contractReference) ??
      stringOrNull(metadata.subscriptionReference),
    customerReference: stringOrNull(metadata.customerReference),
    authorizationReference: stringOrNull(metadata.authorizationReference),
    publicReference: stringOrNull(metadata.publicReference),
    payerUserId: numberOrNull(metadata.payerUserId),
    planCode: stringOrNull(metadata.planCode),
    paymentMethod: stringOrNull(metadata.paymentMethod) as BillingPaymentMethod | null,
    trialChoice: stringOrNull(metadata.trialChoice) as BillingTrialChoice | null,
    couponCode: stringOrNull(metadata.couponCode),
    billingCycle: stringOrNull(metadata.billingCycle) as BillingCycle | null,
    correlationId: stringOrNull(metadata.correlationId),
    amountMinor: numberOrNull(metadata.amountMinor),
    unitAmountMinor: numberOrNull(metadata.unitAmountMinor),
    discountDurationCharges: numberOrNull(metadata.discountDurationCharges),
    transitionAccessUntil:
      transitionAccessUntil && !Number.isNaN(transitionAccessUntil.getTime())
        ? transitionAccessUntil
        : null,
    dueDate: stringOrNull(metadata.dueDate),
    updatedAt: dateOrNull(row.updatedAt),
  };
}

function metadataFromOperation(
  current: AsaasOperation,
  overrides: Record<string, unknown> = {}
) {
  return sanitizeBillingProviderEventMetadata({
    status: current.state,
    operationReference: current.operationKey,
    objectId: current.externalId,
    contractReference: current.externalReference,
    customerReference: current.customerReference,
    authorizationReference: current.authorizationReference,
    publicReference: current.publicReference,
    payerUserId: current.payerUserId,
    planCode: current.planCode,
    paymentMethod: current.paymentMethod,
    trialChoice: current.trialChoice,
    couponCode: current.couponCode,
    billingCycle: current.billingCycle,
    correlationId: current.correlationId,
    amountMinor: current.amountMinor,
    unitAmountMinor: current.unitAmountMinor,
    discountDurationCharges: current.discountDurationCharges,
    transitionAccessUntil: current.transitionAccessUntil?.toISOString() ?? null,
    dueDate: current.dueDate,
    ...overrides,
  });
}

export function createDrizzleAsaasOperationStore(): AsaasOperationStore {
  async function db() {
    return requireDb(getDb);
  }

  async function get(kind: AsaasOperationKind, operationKey: string) {
    const executor = await db();
    const [row] = resultRows<Record<string, unknown>>(
      await executor.execute(sql`
        SELECT id, subscriptionId, payloadJson, updatedAt
        FROM billingProviderEvents
        WHERE provider = 'asaas'
          AND providerEventId = ${providerEventId(kind, operationKey)}
        LIMIT 1
      `)
    );
    return row ? mapOperation(row, kind, operationKey) : null;
  }

  async function prepare(input: PrepareAsaasOperationInput) {
    const executor = await db();
    const id = crypto.randomUUID();
    const eventId = providerEventId(input.kind, input.operationKey);
    const metadata = sanitizeBillingProviderEventMetadata({
      status: "prepared",
      operationReference: input.operationKey,
      contractReference: input.externalReference ?? null,
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
      transitionAccessUntil: input.transitionAccessUntil?.toISOString() ?? null,
      dueDate: input.dueDate ?? null,
    });
    try {
      await executor.execute(sql`
        INSERT INTO billingProviderEvents (
          id, provider, providerEventId, eventType, status, subscriptionId,
          payloadJson, createdAt, updatedAt
        ) VALUES (
          ${id}, 'asaas', ${eventId}, ${`local_${input.kind}`}, 'received',
          ${input.subscriptionId ?? null},
          ${metadata ? JSON.stringify(metadata) : null}, NOW(), NOW()
        )
      `);
    } catch (error) {
      if (!isDuplicateEntryError(error)) throw error;
      const existing = await get(input.kind, input.operationKey);
      if (!existing) throw error;
      return { operation: existing, created: false };
    }
    const operation = await get(input.kind, input.operationKey);
    if (!operation) throw new Error("asaas_operation_persistence_failed");
    return { operation, created: true };
  }

  async function updateOperation(input: {
    kind: AsaasOperationKind;
    operationKey: string;
    state?: AsaasOperationState;
    externalId?: string | null;
    externalReference?: string | null;
    customerReference?: string | null;
    authorizationReference?: string | null;
    publicReference?: string | null;
    subscriptionId?: string | null;
    errorCode?: string | null;
    allowConfirmedStateTransition?: boolean;
    allowProviderTerminalTransition?: boolean;
  }) {
    const executor = await db();
    const current = await get(input.kind, input.operationKey);
    if (!current) throw new Error("asaas_operation_not_prepared");
    const state = input.state ?? current.state;
    const next: AsaasOperation = {
      ...current,
      state,
      externalId: input.externalId ?? current.externalId,
      externalReference: input.externalReference ?? current.externalReference,
      customerReference: input.customerReference ?? current.customerReference,
      authorizationReference:
        input.authorizationReference ?? current.authorizationReference,
      publicReference: input.publicReference ?? current.publicReference,
      subscriptionId: input.subscriptionId ?? current.subscriptionId,
    };
    const metadata = metadataFromOperation(next);
    const protectsConfirmedState =
      !input.allowConfirmedStateTransition &&
      state !== "created" &&
      state !== "prepared";
    const protectsProviderTerminal = !input.allowProviderTerminalTransition;
    await executor.execute(sql`
      UPDATE billingProviderEvents
      SET status = ${
        state === "created"
          ? "processed"
          : state === "prepared"
            ? "received"
            : "failed"
      },
        subscriptionId = ${next.subscriptionId},
        payloadJson = ${metadata ? JSON.stringify(metadata) : null},
        errorCode = ${input.errorCode ?? null}, updatedAt = NOW()
      WHERE provider = 'asaas'
        AND providerEventId = ${providerEventId(input.kind, input.operationKey)}
        ${
          protectsConfirmedState
            ? sql`AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')), 'prepared') <> 'created'`
            : sql``
        }
        ${
          protectsProviderTerminal
            ? sql`AND COALESCE(errorCode, '') NOT LIKE 'provider_terminal:%'`
            : sql``
        }
    `);
  }

  return {
    get,
    prepare,
    markCreated(input) {
      return updateOperation({ ...input, state: "created", errorCode: null });
    },
    bindSubscription(kind, operationKey, subscriptionId) {
      return updateOperation({ kind, operationKey, subscriptionId });
    },
    markOutcomeUnknown(kind, operationKey) {
      return updateOperation({
        kind,
        operationKey,
        state: "outcome_unknown",
        errorCode: "outcome_unknown",
      });
    },
    async resetOutcomeUnknownToPrepared(kind, operationKey) {
      const executor = await db();
      await executor.execute(sql`
        UPDATE billingProviderEvents
        SET status = 'received', errorCode = NULL,
          payloadJson = JSON_SET(
            COALESCE(payloadJson, JSON_OBJECT()),
            '$.status', 'prepared'
          ),
          updatedAt = NOW()
        WHERE provider = 'asaas'
          AND providerEventId = ${providerEventId(kind, operationKey)}
          AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'outcome_unknown'
      `);
    },
    markFailed(kind, operationKey, errorCode) {
      const providerTerminal = isAsaasProviderTerminalFailure(kind, errorCode);
      return updateOperation({
        kind,
        operationKey,
        state: "failed",
        errorCode: providerTerminal ? `provider_terminal:${errorCode}` : errorCode,
        allowConfirmedStateTransition: providerTerminal,
        allowProviderTerminalTransition: providerTerminal,
      });
    },
    markProviderTerminal(input) {
      return updateOperation({
        ...input,
        state: "failed",
        errorCode: `provider_terminal:${input.errorCode}`,
        allowConfirmedStateTransition: true,
        allowProviderTerminalTransition: true,
      });
    },
    async findByExternalId(kind, externalId) {
      const executor = await db();
      const [row] = resultRows<Record<string, unknown>>(
        await executor.execute(sql`
          SELECT id, providerEventId, subscriptionId, payloadJson, updatedAt
          FROM billingProviderEvents
          WHERE provider = 'asaas'
            AND eventType = ${`local_${kind}`}
            AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.objectId')) = ${externalId}
          ORDER BY createdAt DESC
          LIMIT 1
        `)
      );
      return row
        ? mapOperation(row, kind, String(row.providerEventId ?? ""))
        : null;
    },
    async findByPublicReference(kind, publicReference) {
      const executor = await db();
      const [row] = resultRows<Record<string, unknown>>(
        await executor.execute(sql`
          SELECT id, providerEventId, subscriptionId, payloadJson, updatedAt
          FROM billingProviderEvents
          WHERE provider = 'asaas'
            AND eventType = ${`local_${kind}`}
            AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.publicReference')) = ${publicReference}
          ORDER BY createdAt DESC
          LIMIT 1
        `)
      );
      return row
        ? mapOperation(row, kind, String(row.providerEventId ?? ""))
        : null;
    },
    async listScheduledPixPayments(limit) {
      const executor = await db();
      const rows = resultRows<Record<string, unknown>>(
        await executor.execute(sql`
          SELECT id, providerEventId, subscriptionId, payloadJson, updatedAt
          FROM billingProviderEvents
          WHERE provider = 'asaas'
            AND eventType = 'local_pix_payment'
            AND (
              status = 'received'
              OR (status = 'failed' AND errorCode = 'outcome_unknown')
            )
          ORDER BY createdAt ASC
          LIMIT ${Math.max(1, Math.min(500, limit))}
        `)
      );
      return rows.map(row =>
        mapOperation(row, "pix_payment", String(row.providerEventId ?? row.id))
      );
    },
    async countCouponCharges(subscriptionId) {
      const executor = await db();
      const [row] = resultRows<Record<string, unknown>>(
        await executor.execute(sql`
          SELECT COUNT(*) AS total
          FROM billingProviderEvents
          WHERE provider = 'asaas'
            AND subscriptionId = ${subscriptionId}
            AND eventType = 'local_coupon_charge'
            AND status = 'processed'
        `)
      );
      const value = Number(row?.total ?? 0);
      return Number.isFinite(value) ? value : 0;
    },
  };
}
