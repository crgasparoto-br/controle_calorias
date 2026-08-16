import { sql } from "drizzle-orm";
import { getDb } from "../db";
import { resultRows } from "./billingRepositorySupport";

export type UsageQuotaReservationInput = {
  userId: number;
  capability: string;
  origin: "web" | "whatsapp" | "admin";
  windowStart: Date;
  maxCalls: number;
  detail: Record<string, unknown>;
};

export type UsageQuotaReservationResult = {
  allowed: boolean;
  used: number;
  limit: number;
};

export type EconomicTelemetryRow = {
  id: number;
  userId: number | null;
  origin: string;
  status: string;
  eventType: string;
  detail: string;
  createdAt: Date;
};

function quotaEventType(capability: string) {
  return `ai.usage_reservation.${capability.toLowerCase()}`.slice(0, 120);
}

async function requireDb() {
  const db = await getDb();
  if (!db || typeof (db as { execute?: unknown }).execute !== "function") {
    throw new Error("usage_governance_persistence_unavailable");
  }
  return db as NonNullable<typeof db>;
}

export async function reserveUsageQuota(
  input: UsageQuotaReservationInput,
): Promise<UsageQuotaReservationResult> {
  const db = await requireDb();
  const eventType = quotaEventType(input.capability);

  return db.transaction(async tx => {
    const owner = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT id FROM users WHERE id = ${input.userId} LIMIT 1 FOR UPDATE
      `),
    )[0];
    if (!owner) {
      throw new Error("usage_governance_user_not_found");
    }

    const countRow = resultRows<Record<string, unknown>>(
      await tx.execute(sql`
        SELECT COUNT(*) AS total
        FROM inferenceLogs
        WHERE userId = ${input.userId}
          AND eventType = ${eventType}
          AND createdAt >= ${input.windowStart}
      `),
    )[0];
    const used = Number(countRow?.total ?? 0);
    const allowed = used < input.maxCalls;

    if (allowed) {
      await tx.execute(sql`
        INSERT INTO inferenceLogs (userId, origin, status, eventType, detail, createdAt)
        VALUES (
          ${input.userId}, ${input.origin}, 'success', ${eventType},
          ${JSON.stringify(input.detail)}, NOW()
        )
      `);
    } else {
      await tx.execute(sql`
        INSERT INTO inferenceLogs (userId, origin, status, eventType, detail, createdAt)
        VALUES (
          ${input.userId}, ${input.origin}, 'warning', 'ai.usage_limit_exceeded',
          ${JSON.stringify({
            capability: input.capability,
            limit: input.maxCalls,
            windowStart: input.windowStart.toISOString(),
          })}, NOW()
        )
      `);
    }

    return {
      allowed,
      used: allowed ? used + 1 : used,
      limit: input.maxCalls,
    };
  });
}

export async function listEconomicTelemetry(input: {
  from: Date;
  to: Date;
  userId?: number;
  limit?: number;
}): Promise<EconomicTelemetryRow[]> {
  const db = await requireDb();
  const limit = Math.min(Math.max(input.limit ?? 20_000, 1), 50_000);
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id, userId, origin, status, eventType, detail, createdAt
      FROM inferenceLogs
      WHERE createdAt >= ${input.from}
        AND createdAt < ${input.to}
        AND eventType IN ('ai.inference_call', 'ai.usage_limit_exceeded')
        ${input.userId === undefined ? sql`` : sql`AND userId = ${input.userId}`}
      ORDER BY createdAt ASC, id ASC
      LIMIT ${limit}
    `),
  );

  return rows.map(row => ({
    id: Number(row.id),
    userId: row.userId === null || row.userId === undefined ? null : Number(row.userId),
    origin: String(row.origin),
    status: String(row.status),
    eventType: String(row.eventType),
    detail: String(row.detail ?? ""),
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(String(row.createdAt)),
  }));
}

export async function purgeExpiredUsageTelemetry(now = new Date()) {
  const db = await requireDb();
  const quotaCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000);
  const detailCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  await db.execute(sql`
    DELETE FROM inferenceLogs
    WHERE createdAt < ${quotaCutoff}
      AND (eventType LIKE 'ai.usage_reservation.%' OR eventType = 'ai.usage_limit_exceeded')
  `);
  await db.execute(sql`
    DELETE FROM inferenceLogs
    WHERE createdAt < ${detailCutoff}
      AND eventType = 'ai.inference_call'
  `);

  return { quotaCutoff, detailCutoff };
}
