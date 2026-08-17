import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

async function requireDb() {
  const db = await getDb();
  if (!db || typeof (db as { execute?: unknown }).execute !== "function") {
    throw new Error("usage_governance_persistence_unavailable");
  }
  return db as NonNullable<typeof db>;
}

export async function reconcileUsageEventEffectiveCost(input: {
  id: string;
  reconciliationKey: string;
  usageIdempotencyKey: string;
  effectiveCostMicros: number;
  currency: string;
  effectiveAt: Date;
  reason: string;
  actorUserId?: number | null;
  ruleVersion: string;
  correlationId: string;
}) {
  const db = await requireDb();
  return db.transaction(async tx => {
    const event = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id, idempotencyKey, estimatedCostMicros, effectiveCostMicros, currency, occurredAt
        FROM billingUsageEvents
        WHERE idempotencyKey = ${input.usageIdempotencyKey} AND invalidatedAt IS NULL
        LIMIT 1
        FOR UPDATE
      `),
    )[0];
    if (!event) throw new Error("usage_cost_event_not_found");

    const eventCurrency = event.currency == null ? null : String(event.currency).toUpperCase();
    if (eventCurrency && eventCurrency !== input.currency) throw new Error("usage_cost_currency_mismatch");

    const existing = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT usageEventId, usageIdempotencyKey, newEffectiveCostMicros, currency
        FROM billingUsageCostReconciliations
        WHERE reconciliationKey = ${input.reconciliationKey}
        LIMIT 1
      `),
    )[0];
    if (existing) {
      const same = String(existing.usageEventId) === String(event.id)
        && String(existing.usageIdempotencyKey) === input.usageIdempotencyKey
        && Number(existing.newEffectiveCostMicros) === input.effectiveCostMicros
        && String(existing.currency).toUpperCase() === input.currency;
      if (!same) throw new Error("usage_cost_reconciliation_key_conflict");
      return { applied: false as const, occurredAt: new Date(String(event.occurredAt)), usageEventId: String(event.id) };
    }

    await tx.execute(sql`
      INSERT INTO billingUsageCostReconciliations (
        id, reconciliationKey, usageEventId, usageIdempotencyKey,
        previousEstimatedCostMicros, previousEffectiveCostMicros, newEffectiveCostMicros,
        currency, effectiveAt, reason, actorUserId, ruleVersion, correlationId
      ) VALUES (
        ${input.id}, ${input.reconciliationKey}, ${String(event.id)}, ${input.usageIdempotencyKey},
        ${event.estimatedCostMicros == null ? null : Number(event.estimatedCostMicros)},
        ${event.effectiveCostMicros == null ? null : Number(event.effectiveCostMicros)},
        ${input.effectiveCostMicros}, ${input.currency}, ${input.effectiveAt}, ${input.reason},
        ${input.actorUserId ?? null}, ${input.ruleVersion}, ${input.correlationId}
      )
    `);
    await tx.execute(sql`
      UPDATE billingUsageEvents
      SET effectiveCostMicros = ${input.effectiveCostMicros}, currency = ${input.currency}
      WHERE id = ${String(event.id)} AND invalidatedAt IS NULL
    `);
    return { applied: true as const, occurredAt: new Date(String(event.occurredAt)), usageEventId: String(event.id) };
  });
}
