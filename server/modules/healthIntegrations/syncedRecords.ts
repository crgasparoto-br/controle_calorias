import type { HealthDataType, HealthProvider, ListSyncedHealthRecordsInput } from "./schemas";

export type SyncedHealthRecord = {
  id: string;
  source: HealthProvider;
  dataType: HealthDataType;
  measuredAt: string;
  value: number;
  unit: string;
  activityType?: string;
  metadata?: Record<string, unknown> | null;
};

type SyncedRecordTotals = {
  steps: number;
  energyBurnedCalories: number;
  activityMinutes: number;
  sleepMinutes: number;
};

function normalizeSearchValue(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseOptionalDate(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function metadataSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (["string", "number", "boolean"].includes(typeof value)) return String(value);
  if (Array.isArray(value)) return value.map(metadataSearchText).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(metadataSearchText).join(" ");
  return "";
}

function recordSearchText(record: SyncedHealthRecord) {
  return normalizeSearchValue([
    record.id,
    record.source,
    record.dataType,
    record.activityType,
    metadataSearchText(record.metadata),
  ].filter(Boolean).join(" "));
}

function recordMeasuredAtTimestamp(record: SyncedHealthRecord) {
  const timestamp = Date.parse(record.measuredAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function calculateTotals(records: SyncedHealthRecord[]): SyncedRecordTotals {
  return records.reduce<SyncedRecordTotals>((totals, record) => {
    if (record.dataType === "steps") totals.steps += record.value;
    if (record.dataType === "energy_burned") totals.energyBurnedCalories += record.value;
    if (record.dataType === "activity") totals.activityMinutes += record.value;
    if (record.dataType === "sleep") totals.sleepMinutes += record.value;
    return totals;
  }, {
    steps: 0,
    energyBurnedCalories: 0,
    activityMinutes: 0,
    sleepMinutes: 0,
  });
}

export function listSyncedHealthRecords(records: SyncedHealthRecord[], input: ListSyncedHealthRecordsInput) {
  const fromTimestamp = parseOptionalDate(input.from, Number.NEGATIVE_INFINITY);
  const toTimestamp = parseOptionalDate(input.to, Number.POSITIVE_INFINITY);
  const query = normalizeSearchValue(input.q ?? "");

  const filtered = records
    .filter(record => !input.provider || record.source === input.provider)
    .filter(record => !input.dataType || record.dataType === input.dataType)
    .filter(record => {
      const measuredAt = recordMeasuredAtTimestamp(record);
      return measuredAt >= fromTimestamp && measuredAt <= toTimestamp;
    })
    .filter(record => !query || recordSearchText(record).includes(query))
    .sort((left, right) => recordMeasuredAtTimestamp(right) - recordMeasuredAtTimestamp(left));

  const offset = input.offset;
  const limit = input.limit;
  const items = filtered.slice(offset, offset + limit);
  const nextOffset = offset + limit < filtered.length ? offset + limit : null;
  const sources = Array.from(new Set(records.map(record => record.source))).sort();
  const dataTypes = Array.from(new Set(records.map(record => record.dataType))).sort();

  return {
    items,
    total: filtered.length,
    limit,
    offset,
    nextOffset,
    sources,
    dataTypes,
    totals: calculateTotals(filtered),
  };
}
