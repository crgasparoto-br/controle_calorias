import crypto from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import type {
  BillingAdminOverride,
  BillingSubscriptionSummary,
} from "../modules/billing/types";

export type SqlExecutor = {
  execute(query: SQL): Promise<unknown>;
};

export type TransactionalSqlExecutor = SqlExecutor & {
  transaction<T>(callback: (tx: SqlExecutor) => Promise<T>): Promise<T>;
};

export type DbProvider = () => Promise<unknown | null>;
export type WarningHandler = (scope: string, error: unknown) => void;
export type BillingRepositoryDeps = {
  getDb: DbProvider;
  onWarning: WarningHandler;
};

export class BillingPersistenceUnavailableError extends Error {
  constructor() {
    super("A persistência de billing está temporariamente indisponível.");
    this.name = "BillingPersistenceUnavailableError";
  }
}

export function resultRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    const [rows] = result;
    return Array.isArray(rows) ? (rows as T[]) : (result as T[]);
  }
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? (rows as T[]) : [];
  }
  return [];
}

export function dateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function numberValue(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isDuplicateEntryError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export function stringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

export function earliestDate(...values: Array<unknown>) {
  const dates = values
    .map(dateOrNull)
    .filter((value): value is Date => !!value);
  if (!dates.length) return null;
  return dates.reduce((earliest, current) =>
    current.getTime() < earliest.getTime() ? current : earliest
  );
}

export function mapSubscription(
  row: Record<string, unknown>
): BillingSubscriptionSummary {
  return {
    id: String(row.id),
    provider: String(row.provider),
    planCode: String(row.planCode),
    planName: String(row.planName),
    status: row.status as BillingSubscriptionSummary["status"],
    billingCycle:
      row.billingCycle as BillingSubscriptionSummary["billingCycle"],
    currency: String(row.currency),
    unitAmount: numberValue(row.unitAmount),
    currentPeriodStart: dateOrNull(row.currentPeriodStart),
    currentPeriodEnd: dateOrNull(row.currentPeriodEnd),
    cancelAtPeriodEnd: Boolean(row.cancelAtPeriodEnd),
  };
}

export function mapOverride(
  row: Record<string, unknown>
): BillingAdminOverride {
  return {
    id: String(row.id),
    userId: numberValue(row.userId),
    reason: String(row.reason),
    startsAt: dateOrNull(row.startsAt) ?? new Date(0),
    endsAt: dateOrNull(row.endsAt),
    state: row.state as BillingAdminOverride["state"],
    grantedByUserId:
      row.grantedByUserId === null || row.grantedByUserId === undefined
        ? null
        : numberValue(row.grantedByUserId),
    revokedByUserId:
      row.revokedByUserId === null || row.revokedByUserId === undefined
        ? null
        : numberValue(row.revokedByUserId),
    revokedAt: dateOrNull(row.revokedAt),
    createdAt: dateOrNull(row.createdAt) ?? new Date(0),
    updatedAt: dateOrNull(row.updatedAt) ?? new Date(0),
  };
}

export function authorizationIdFromCoverageKey(coverageKey: string) {
  const prefix = "professional-authorization:";
  return coverageKey.startsWith(prefix)
    ? coverageKey.slice(prefix.length)
    : null;
}

export async function requireDb(
  getDb: DbProvider
): Promise<TransactionalSqlExecutor> {
  const db = await getDb();
  if (!db) throw new BillingPersistenceUnavailableError();
  const candidate = db as TransactionalSqlExecutor;
  if (
    typeof candidate.execute !== "function" ||
    typeof candidate.transaction !== "function"
  ) {
    throw new BillingPersistenceUnavailableError();
  }
  return candidate;
}

export async function insertAuditEvent(
  executor: SqlExecutor,
  input: {
    subjectUserId: number;
    actorUserId?: number | null;
    action:
      | "capacity_reserved"
      | "capacity_released"
      | "override_granted"
      | "override_revoked";
    sourceType: string;
    sourceId: string;
    reason?: string | null;
    metadata?: Record<string, unknown> | null;
  }
) {
  await executor.execute(sql`
    INSERT INTO billingAccessAuditEvents (
      id, subjectUserId, actorUserId, action, sourceType, sourceId,
      reason, metadataJson, occurredAt, createdAt
    ) VALUES (
      ${crypto.randomUUID()}, ${input.subjectUserId}, ${input.actorUserId ?? null},
      ${input.action}, ${input.sourceType}, ${input.sourceId},
      ${input.reason ?? null}, ${input.metadata ? JSON.stringify(input.metadata) : null},
      NOW(), NOW()
    )
  `);
}
