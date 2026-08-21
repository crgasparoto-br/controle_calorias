import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

const PROVIDER_DISPATCH_LEASE_MS = 5 * 60 * 1000;

async function requireDb() {
  const db = await getDb();
  if (!db || typeof (db as { execute?: unknown }).execute !== "function") {
    throw new Error("usage_governance_persistence_unavailable");
  }
  return db as NonNullable<typeof db>;
}

function affectedRows(result: unknown) {
  return Number((result as unknown as [{ affectedRows?: number }])[0]?.affectedRows ?? 0);
}

async function readUsageEventState(idempotencyKey: string) {
  const db = await requireDb();
  const row = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT eventState, providerDispatchStartedAt
      FROM billingUsageEvents
      WHERE idempotencyKey = ${idempotencyKey} AND invalidatedAt IS NULL
      LIMIT 1
    `),
  )[0];
  return row
    ? {
        state: String(row.eventState),
        providerDispatchStartedAt: row.providerDispatchStartedAt == null
          ? null
          : new Date(String(row.providerDispatchStartedAt)),
      }
    : { state: null, providerDispatchStartedAt: null };
}

async function closeExpiredDispatchAsUncertain(idempotencyKey: string, now: Date) {
  const db = await requireDb();
  const cutoff = new Date(now.getTime() - PROVIDER_DISPATCH_LEASE_MS);
  const result = await db.execute(sql`
    UPDATE billingUsageEvents
    SET eventState = 'provider_dispatch_uncertain'
    WHERE idempotencyKey = ${idempotencyKey}
      AND invalidatedAt IS NULL
      AND eventState = 'provider_dispatch_started'
      AND providerDispatchStartedAt IS NOT NULL
      AND providerDispatchStartedAt <= ${cutoff}
  `);
  return affectedRows(result) > 0;
}

export async function claimUsageProviderDispatch(idempotencyKey: string, now = new Date()) {
  const db = await requireDb();
  const result = await db.execute(sql`
    UPDATE billingUsageEvents
    SET eventState = 'provider_dispatch_started', providerDispatchStartedAt = ${now}
    WHERE idempotencyKey = ${idempotencyKey}
      AND invalidatedAt IS NULL
      AND eventState = 'provider_dispatch_reserved'
  `);
  if (affectedRows(result) > 0) {
    return { claimed: true as const, state: "provider_dispatch_started" as const };
  }

  const current = await readUsageEventState(idempotencyKey);
  if (current.state === "provider_dispatch_started" && await closeExpiredDispatchAsUncertain(idempotencyKey, now)) {
    return { claimed: false as const, state: "provider_dispatch_uncertain" as const };
  }
  return { claimed: false as const, state: current.state };
}

export async function finalizeUsageProviderDispatch(input: {
  idempotencyKey: string;
  eventState: string;
  operation: string;
  attemptRole: string;
  retryRootKey?: string | null;
  metadata: Record<string, unknown>;
  provider?: string | null;
  model?: string | null;
  unitType?: string;
  unitCount?: number;
  estimatedCostMicros?: number | null;
  effectiveCostMicros?: number | null;
  currency?: string | null;
}) {
  const db = await requireDb();
  const result = await db.execute(sql`
    UPDATE billingUsageEvents
    SET eventState = ${input.eventState},
        operation = ${input.operation},
        attemptRole = ${input.attemptRole},
        retryRootKey = ${input.retryRootKey ?? null},
        provider = COALESCE(${input.provider ?? null}, provider),
        model = COALESCE(${input.model ?? null}, model),
        unitType = COALESCE(${input.unitType ?? null}, unitType),
        unitCount = COALESCE(${input.unitCount ?? null}, unitCount),
        estimatedCostMicros = ${input.estimatedCostMicros ?? null},
        effectiveCostMicros = ${input.effectiveCostMicros ?? null},
        currency = COALESCE(${input.currency ?? null}, currency),
        metadataJson = ${JSON.stringify(input.metadata)}
    WHERE idempotencyKey = ${input.idempotencyKey}
      AND invalidatedAt IS NULL
      AND eventState = 'provider_dispatch_started'
  `);
  if (affectedRows(result) > 0) {
    return { finalized: true as const, state: input.eventState };
  }
  return { finalized: false as const, state: (await readUsageEventState(input.idempotencyKey)).state };
}
