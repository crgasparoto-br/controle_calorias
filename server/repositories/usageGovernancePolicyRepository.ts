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

function asDate(value: unknown) {
  return value instanceof Date ? value : new Date(String(value));
}

export async function hasActiveUsageExemption(input: { userId: number; professionalId?: number | null; now: Date }) {
  const db = await requireDb();
  const professionalId = input.professionalId ?? null;
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id
      FROM billingUsageAllowanceGrants
      WHERE state = 'active'
        AND grantType = 'temporary_exemption'
        AND startsAt <= ${input.now}
        AND endsAt > ${input.now}
        AND (
          (subjectType = 'user' AND subjectId = ${String(input.userId)})
          ${professionalId === null ? sql`` : sql`OR (subjectType = 'professional' AND subjectId = ${String(professionalId)})`}
        )
      LIMIT 1
    `),
  );
  return rows.length > 0;
}

export async function listUsageLimitationsForCase(abuseCaseId: string) {
  const db = await requireDb();
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id, abuseCaseId, subjectUserId, operationsJson, reason, startsAt, endsAt,
             emergencySecurity, approvedByUserId, secondApprovedByUserId, state, revokedAt
      FROM billingUsageLimitations
      WHERE abuseCaseId = ${abuseCaseId}
      ORDER BY startsAt, createdAt
      LIMIT 10
    `),
  );
  return rows.map(value => ({
    id: String(value.id),
    abuseCaseId: String(value.abuseCaseId),
    subjectUserId: Number(value.subjectUserId),
    operations: Array.isArray(value.operationsJson)
      ? value.operationsJson.map(String)
      : JSON.parse(String(value.operationsJson ?? "[]")) as string[],
    reason: String(value.reason),
    startsAt: asDate(value.startsAt),
    endsAt: asDate(value.endsAt),
    emergencySecurity: Boolean(value.emergencySecurity),
    approvedByUserId: Number(value.approvedByUserId),
    secondApprovedByUserId: value.secondApprovedByUserId == null ? null : Number(value.secondApprovedByUserId),
    state: String(value.state),
    revokedAt: value.revokedAt == null ? null : asDate(value.revokedAt),
  }));
}
