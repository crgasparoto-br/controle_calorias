import { sql, type SQL } from "drizzle-orm";
import { getDb } from "../db";
import type { HealthDataType, HealthProvider } from "../modules/healthIntegrations/schemas";
import type { SyncedHealthRecord } from "../modules/healthIntegrations/syncedRecords";

type PersistedSyncedRecord = SyncedHealthRecord & {
  userId: number;
  provider: HealthProvider;
  energyKind?: "burned";
  createdAt: number;
};

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

type HealthSyncedRecordRow = {
  externalRecordId: string;
  provider: HealthProvider;
  dataType: HealthDataType;
  measuredAt: Date | string;
  value: number;
  unit: string;
  activityType: string | null;
  energyKind: "burned" | null;
  metadataJson: string | null;
  createdAt: Date | string;
};

function isSqlExecutor(value: unknown): value is SqlExecutor {
  return Boolean(value && typeof value === "object" && typeof (value as { execute?: unknown }).execute === "function");
}

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    const [rows] = result;
    return Array.isArray(rows) ? rows as T[] : result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }

  return [];
}

function toDate(value: string | number | Date) {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function toTimestamp(value: Date | string) {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function parseMetadata(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapRow(row: HealthSyncedRecordRow): PersistedSyncedRecord {
  return {
    id: row.externalRecordId,
    userId: 0,
    provider: row.provider,
    source: row.provider,
    dataType: row.dataType,
    measuredAt: toTimestamp(row.measuredAt),
    value: Number(row.value),
    unit: row.unit,
    activityType: row.activityType ?? undefined,
    energyKind: row.energyKind ?? undefined,
    metadata: parseMetadata(row.metadataJson),
    createdAt: toDate(row.createdAt).getTime(),
  };
}

export async function upsertHealthSyncedRecords(records: PersistedSyncedRecord[]) {
  if (!records.length) return false;

  const db = await getDb();
  if (!isSqlExecutor(db)) return false;

  try {
    for (const record of records) {
      await db.execute(sql`
        INSERT INTO healthSyncedRecords (
          userId,
          provider,
          externalRecordId,
          dataType,
          measuredAt,
          value,
          unit,
          activityType,
          energyKind,
          metadataJson,
          createdAt
        ) VALUES (
          ${record.userId},
          ${record.provider},
          ${record.id},
          ${record.dataType},
          ${toDate(record.measuredAt)},
          ${record.value},
          ${record.unit},
          ${record.activityType ?? null},
          ${record.energyKind ?? null},
          ${record.metadata ? JSON.stringify(record.metadata) : null},
          ${toDate(record.createdAt)}
        ) ON DUPLICATE KEY UPDATE
          measuredAt = VALUES(measuredAt),
          value = VALUES(value),
          unit = VALUES(unit),
          activityType = VALUES(activityType),
          energyKind = VALUES(energyKind),
          metadataJson = VALUES(metadataJson)
      `);
    }
    return true;
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to persist synced health records:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function listHealthSyncedRecords(userId: number) {
  const db = await getDb();
  if (!isSqlExecutor(db)) return null;

  try {
    const result = await db.execute(sql`
      SELECT
        externalRecordId,
        provider,
        dataType,
        measuredAt,
        value,
        unit,
        activityType,
        energyKind,
        metadataJson,
        createdAt
      FROM healthSyncedRecords
      WHERE userId = ${userId}
      ORDER BY measuredAt DESC
      LIMIT 1000
    `);
    return extractRows<HealthSyncedRecordRow>(result).map(row => ({ ...mapRow(row), userId }));
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to list persisted synced health records:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function deleteHealthSyncedRecords(userId: number, provider: HealthProvider) {
  const db = await getDb();
  if (!isSqlExecutor(db)) return false;

  try {
    await db.execute(sql`
      DELETE FROM healthSyncedRecords
      WHERE userId = ${userId} AND provider = ${provider}
    `);
    return true;
  } catch (error) {
    console.warn("[HealthIntegrations] Failed to delete persisted synced health records:", error instanceof Error ? error.message : error);
    return false;
  }
}
