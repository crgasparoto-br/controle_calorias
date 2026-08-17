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

function parseThresholds(value: unknown): number[] {
  if (Array.isArray(value)) return value.map(Number).filter(Number.isFinite);
  try {
    const parsed = JSON.parse(String(value ?? "[]"));
    return Array.isArray(parsed) ? parsed.map(Number).filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

export async function getActiveUsagePolicy(input: { userId?: number; now: Date }) {
  const db = await requireDb();
  const userId = input.userId;
  const rows = resultRows<Record<string, unknown>>(
    await db.execute(sql`
      SELECT id, scopeType, scopeId, currency, expectedBudgetMicros, alertThresholdsJson,
             observationStartsAt, observationEndsAt, ruleVersion, reason, createdAt
      FROM billingUsagePolicies
      WHERE activeScopeKey IS NOT NULL
        AND observationStartsAt <= ${input.now}
        AND observationEndsAt > ${input.now}
        AND (
          scopeType = 'global'
          ${userId === undefined ? sql`` : sql`OR (scopeType = 'user' AND scopeId = ${String(userId)})`}
        )
      ORDER BY CASE WHEN scopeType = 'user' THEN 0 ELSE 1 END, createdAt DESC
      LIMIT 1
    `),
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: String(row.id),
    scopeType: String(row.scopeType),
    scopeId: String(row.scopeId),
    currency: String(row.currency),
    expectedBudgetMicros: Number(row.expectedBudgetMicros),
    alertThresholdPercentages: parseThresholds(row.alertThresholdsJson),
    observationStartsAt: asDate(row.observationStartsAt),
    observationEndsAt: asDate(row.observationEndsAt),
    ruleVersion: String(row.ruleVersion),
    reason: String(row.reason),
  };
}

export async function replaceUsagePolicy(input: {
  id: string;
  scopeType: "global" | "user";
  scopeId: string;
  currency: string;
  expectedBudgetMicros: number;
  alertThresholdPercentages: number[];
  observationStartsAt: Date;
  observationEndsAt: Date;
  ruleVersion: string;
  reason: string;
  actorUserId: number;
}) {
  const db = await requireDb();
  const activeScopeKey = `${input.scopeType}:${input.scopeId}`;
  await db.transaction(async tx => {
    await tx.execute(sql`
      UPDATE billingUsagePolicies
      SET activeScopeKey = NULL, revokedAt = NOW(), revokedByUserId = ${input.actorUserId}
      WHERE activeScopeKey = ${activeScopeKey}
    `);
    await tx.execute(sql`
      INSERT INTO billingUsagePolicies (
        id, scopeType, scopeId, currency, expectedBudgetMicros, alertThresholdsJson,
        observationStartsAt, observationEndsAt, activeScopeKey, ruleVersion, createdByUserId, reason
      ) VALUES (
        ${input.id}, ${input.scopeType}, ${input.scopeId}, ${input.currency}, ${input.expectedBudgetMicros},
        ${JSON.stringify(input.alertThresholdPercentages)}, ${input.observationStartsAt}, ${input.observationEndsAt},
        ${activeScopeKey}, ${input.ruleVersion}, ${input.actorUserId}, ${input.reason}
      )
    `);
  });
  return { id: input.id, activeScopeKey };
}
