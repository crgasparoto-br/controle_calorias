import crypto from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "../../../db";
import { requireDb, resultRows } from "../../../repositories/billingRepositorySupport";
import type {
  AsaasOperation,
  AsaasOperationKind,
  AsaasOperationState,
  AsaasOperationStore as BaseAsaasOperationStore,
  PrepareAsaasOperationInput,
} from "./operationStoreBase";
import {
  createDrizzleAsaasOperationStore as createBaseAsaasOperationStore,
  isAsaasProviderTerminalFailure,
} from "./operationStoreBase";

export { isAsaasProviderTerminalFailure };
export type {
  AsaasOperation,
  AsaasOperationKind,
  AsaasOperationState,
  PrepareAsaasOperationInput,
};

export type AsaasOperationStore = BaseAsaasOperationStore;

const IMMEDIATE_PROVIDER_MUTATIONS = new Set<string>([
  "customer",
  "checkout",
  "pix_automatic_authorization",
  "coupon_reset",
  "reconciliation",
  "subscription_schedule",
  "payment_reschedule",
]);

function providerEventId(kind: AsaasOperationKind, operationKey: string) {
  const digest = crypto.createHash("sha256").update(operationKey).digest("hex");
  return `local:${kind}:${digest}`;
}

function shouldCreateScheduledPixPayment(dueDate: string, now: Date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return false;
  const due = new Date(`${dueDate}T12:00:00.000Z`);
  const cursor = new Date(`${now.toISOString().slice(0, 10)}T12:00:00.000Z`);
  if (Number.isNaN(due.getTime()) || due.getTime() <= cursor.getTime()) return false;
  let weekdays = 0;
  for (
    let value = new Date(cursor.getTime() + 86_400_000);
    value.getTime() <= due.getTime();
    value = new Date(value.getTime() + 86_400_000)
  ) {
    const day = value.getUTCDay();
    if (day !== 0 && day !== 6) weekdays += 1;
  }
  return weekdays >= 2 && weekdays <= 6;
}

function affectedRows(result: unknown) {
  const candidate = Array.isArray(result) ? result[0] : result;
  const value = Number((candidate as { affectedRows?: number })?.affectedRows ?? 0);
  return Number.isFinite(value) ? value : 0;
}

async function db() {
  return requireDb(getDb);
}

async function retryReady(kind: AsaasOperationKind, operationKey: string) {
  const executor = await db();
  const [row] = resultRows<Record<string, unknown>>(
    await executor.execute(sql`
      SELECT JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.retryReady')) AS retryReady
      FROM billingProviderEvents
      WHERE provider = 'asaas'
        AND providerEventId = ${providerEventId(kind, operationKey)}
      LIMIT 1
    `)
  );
  return String(row?.retryReady ?? "").toLowerCase() === "true";
}

async function claimSafeRetry(kind: AsaasOperationKind, operationKey: string) {
  const executor = await db();
  const result = await executor.execute(sql`
    UPDATE billingProviderEvents
    SET payloadJson = JSON_SET(
          COALESCE(payloadJson, JSON_OBJECT()),
          '$.retryReady', false
        ),
        updatedAt = NOW()
    WHERE provider = 'asaas'
      AND providerEventId = ${providerEventId(kind, operationKey)}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'prepared'
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.retryReady')) = 'true'
      AND COALESCE(errorCode, '') NOT LIKE 'provider_terminal:%'
  `);
  return affectedRows(result) > 0;
}

async function recoverAbandonedImmediateClaim(
  kind: AsaasOperationKind,
  operationKey: string
) {
  const executor = await db();
  const result = await executor.execute(sql`
    UPDATE billingProviderEvents
    SET status = 'failed', errorCode = 'outcome_unknown',
        payloadJson = JSON_SET(
          COALESCE(payloadJson, JSON_OBJECT()),
          '$.status', 'outcome_unknown'
        ),
        updatedAt = NOW()
    WHERE provider = 'asaas'
      AND providerEventId = ${providerEventId(kind, operationKey)}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'prepared'
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.retryReady')), 'false') <> 'true'
      AND updatedAt < DATE_SUB(NOW(), INTERVAL 120 SECOND)
  `);
  return affectedRows(result) > 0;
}

async function markRetryReady(kind: AsaasOperationKind, operationKey: string) {
  const executor = await db();
  await executor.execute(sql`
    UPDATE billingProviderEvents
    SET payloadJson = JSON_SET(
          COALESCE(payloadJson, JSON_OBJECT()),
          '$.retryReady', true
        ),
        updatedAt = NOW()
    WHERE provider = 'asaas'
      AND providerEventId = ${providerEventId(kind, operationKey)}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'prepared'
  `);
}

async function claimScheduledPix(operation: AsaasOperation) {
  const executor = await db();
  const eventId = providerEventId("pix_payment", operation.operationKey);
  const recovered = await executor.execute(sql`
    UPDATE billingProviderEvents
    SET status = 'failed', errorCode = 'outcome_unknown',
        payloadJson = JSON_SET(
          COALESCE(payloadJson, JSON_OBJECT()),
          '$.status', 'outcome_unknown'
        ),
        updatedAt = NOW()
    WHERE provider = 'asaas'
      AND providerEventId = ${eventId}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'prepared'
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.executionClaimed')) = 'true'
      AND updatedAt < DATE_SUB(NOW(), INTERVAL 120 SECOND)
  `);
  if (affectedRows(recovered) > 0) return "recovered" as const;

  const claimed = await executor.execute(sql`
    UPDATE billingProviderEvents
    SET payloadJson = JSON_SET(
          COALESCE(payloadJson, JSON_OBJECT()),
          '$.executionClaimed', true
        ),
        updatedAt = NOW()
    WHERE provider = 'asaas'
      AND providerEventId = ${eventId}
      AND JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.status')) = 'prepared'
      AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(payloadJson, '$.executionClaimed')), 'false') <> 'true'
      AND COALESCE(errorCode, '') NOT LIKE 'provider_terminal:%'
  `);
  return affectedRows(claimed) > 0 ? ("claimed" as const) : ("busy" as const);
}

export function createDrizzleAsaasOperationStore(): AsaasOperationStore {
  const base = createBaseAsaasOperationStore();
  return {
    ...base,
    async prepare(input: PrepareAsaasOperationInput) {
      const prepared = await base.prepare(input);
      if (
        prepared.created ||
        !IMMEDIATE_PROVIDER_MUTATIONS.has(String(input.kind)) ||
        prepared.operation.state !== "prepared"
      ) {
        return prepared;
      }

      if (await retryReady(input.kind, input.operationKey)) {
        if (await claimSafeRetry(input.kind, input.operationKey)) {
          const operation = await base.get(input.kind, input.operationKey);
          if (!operation) throw new Error("asaas_operation_persistence_failed");
          return { operation, created: false };
        }
        throw new Error("asaas_operation_in_progress");
      }

      if (await recoverAbandonedImmediateClaim(input.kind, input.operationKey)) {
        const operation = await base.get(input.kind, input.operationKey);
        if (!operation) throw new Error("asaas_operation_persistence_failed");
        return { operation, created: false };
      }
      throw new Error("asaas_operation_in_progress");
    },
    async resetOutcomeUnknownToPrepared(kind, operationKey) {
      await base.resetOutcomeUnknownToPrepared(kind, operationKey);
      await markRetryReady(kind, operationKey);
    },
    async listScheduledPixPayments(limit) {
      const scheduled = await base.listScheduledPixPayments(limit);
      const output: AsaasOperation[] = [];
      for (const operation of scheduled) {
        if (
          operation.state !== "prepared" ||
          !operation.dueDate ||
          !operation.authorizationReference ||
          !shouldCreateScheduledPixPayment(operation.dueDate, new Date())
        ) {
          output.push(operation);
          continue;
        }
        const active = await base.findByExternalId(
          "pix_automatic_authorization",
          operation.authorizationReference
        );
        if (active?.state !== "created") {
          output.push(operation);
          continue;
        }
        const claim = await claimScheduledPix(operation);
        if (claim === "claimed") output.push(operation);
        if (claim === "recovered") {
          const recovered = await base.get("pix_payment", operation.operationKey);
          if (recovered) output.push(recovered);
        }
      }
      return output;
    },
  };
}
