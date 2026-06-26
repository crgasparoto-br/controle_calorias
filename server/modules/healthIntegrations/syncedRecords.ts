import type { HealthDataType, HealthProvider, ListSyncedHealthRecordsInput } from "./schemas";

export type SyncedHealthRecord = {
  id: string;
  source: HealthProvider;
  dataType: HealthDataType;
  measuredAt: string;
  value: number;
  unit: string;
  activityType?: string;
  metadata?: unknown;
};

type SyncedRecordTotals = {
  steps: number;
  energyBurnedCalories: number;
  activityMinutes: number;
  activityCount: number;
  sleepMinutes: number;
};

type RecordMetadata = Record<string, unknown>;

type ActivityGroup = {
  activity?: SyncedHealthRecord;
  energy?: SyncedHealthRecord;
};

function normalizeSearchValue(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function normalizeActivityTypeValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase();
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

function isMetadataObject(value: unknown): value is RecordMetadata {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getMetadata(record: SyncedHealthRecord): RecordMetadata {
  return isMetadataObject(record.metadata) ? record.metadata : {};
}

function getPositiveMetadataNumber(metadata: RecordMetadata, key: string) {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function getStringMetadata(metadata: RecordMetadata, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function getRecordExternalActivityKey(record: SyncedHealthRecord) {
  const metadata = getMetadata(record);
  const externalId = metadata.externalId;
  if (typeof externalId === "string" && externalId.trim()) {
    return `${record.source}:external:${externalId.trim()}`;
  }

  const suffixMatch = record.id.match(/^(.*):(activity|energy)$/);
  if (suffixMatch?.[1]) {
    return `${record.source}:id:${suffixMatch[1]}`;
  }

  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  return [record.source, record.measuredAt, record.activityType ?? "", name].join(":");
}

function shouldMergeIntoActivity(record: SyncedHealthRecord) {
  return record.dataType === "activity" || record.dataType === "energy_burned";
}

function mergeActivityGroup(group: ActivityGroup) {
  if (!group.activity) return group.energy ? [group.energy] : [];

  const activity = group.activity;
  const activityMetadata = getMetadata(activity);
  const energyMetadata = group.energy ? getMetadata(group.energy) : {};
  const metadataCalories = getPositiveMetadataNumber(activityMetadata, "calories") ?? getPositiveMetadataNumber(energyMetadata, "calories");
  const energyCalories = group.energy && group.energy.value > 0 ? group.energy.value : null;
  const calories = metadataCalories ?? energyCalories;
  const metadata = {
    ...energyMetadata,
    ...activityMetadata,
    ...(calories ? { calories } : {}),
    caloriesSource: activityMetadata.caloriesSource ?? energyMetadata.caloriesSource ?? (energyCalories ? "synced_energy" : null),
    estimatedCalories: activityMetadata.estimatedCalories ?? energyMetadata.estimatedCalories ?? false,
  };

  return [{
    ...activity,
    metadata,
  }];
}

function consolidateActivityRecords(records: SyncedHealthRecord[]) {
  const groups = new Map<string, ActivityGroup>();
  const passthrough: SyncedHealthRecord[] = [];

  for (const record of records) {
    if (!shouldMergeIntoActivity(record)) {
      passthrough.push(record);
      continue;
    }

    const key = getRecordExternalActivityKey(record);
    const group = groups.get(key) ?? {};
    if (record.dataType === "activity") {
      group.activity = record;
    } else {
      group.energy = record;
    }
    groups.set(key, group);
  }

  return [...Array.from(groups.values()).flatMap(mergeActivityGroup), ...passthrough];
}

function recordMatchesDataType(record: SyncedHealthRecord, dataType: HealthDataType | undefined) {
  if (!dataType) return true;
  if (record.dataType === dataType) return true;
  if (dataType === "energy_burned" && record.dataType === "activity") {
    return Boolean(getPositiveMetadataNumber(getMetadata(record), "calories"));
  }
  return false;
}

function getActivityTypeSearchValues(record: SyncedHealthRecord) {
  const metadata = getMetadata(record);
  return [
    record.activityType,
    getStringMetadata(metadata, "sportType"),
    getStringMetadata(metadata, "workoutType"),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeActivityTypeValue);
}

function recordMatchesActivityType(record: SyncedHealthRecord, activityType: string | undefined) {
  if (!activityType) return true;
  if (record.dataType !== "activity") return false;
  const normalizedActivityType = normalizeActivityTypeValue(activityType);
  return getActivityTypeSearchValues(record).includes(normalizedActivityType);
}

function getRecordCalories(record: SyncedHealthRecord) {
  if (record.dataType === "energy_burned") return record.value;
  if (record.dataType !== "activity") return 0;
  return getPositiveMetadataNumber(getMetadata(record), "calories") ?? 0;
}

function calculateTotals(records: SyncedHealthRecord[]): SyncedRecordTotals {
  return records.reduce<SyncedRecordTotals>((totals, record) => {
    if (record.dataType === "steps") totals.steps += record.value;
    totals.energyBurnedCalories += getRecordCalories(record);
    if (record.dataType === "activity") {
      totals.activityMinutes += record.value;
      totals.activityCount += 1;
    }
    if (record.dataType === "sleep") totals.sleepMinutes += record.value;
    return totals;
  }, {
    steps: 0,
    energyBurnedCalories: 0,
    activityMinutes: 0,
    activityCount: 0,
    sleepMinutes: 0,
  });
}

export function listSyncedHealthRecords(records: SyncedHealthRecord[], input: ListSyncedHealthRecordsInput) {
  const fromTimestamp = parseOptionalDate(input.from, Number.NEGATIVE_INFINITY);
  const toTimestamp = parseOptionalDate(input.to, Number.POSITIVE_INFINITY);
  const query = normalizeSearchValue(input.q ?? "");
  const consolidatedRecords = consolidateActivityRecords(records);

  const filtered = consolidatedRecords
    .filter(record => !input.provider || record.source === input.provider)
    .filter(record => recordMatchesDataType(record, input.dataType))
    .filter(record => recordMatchesActivityType(record, input.activityType))
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
  const availableDataTypes = new Set(consolidatedRecords.map(record => record.dataType));
  if (consolidatedRecords.some(record => getRecordCalories(record) > 0)) {
    availableDataTypes.add("energy_burned");
  }
  const dataTypes = Array.from(availableDataTypes).sort();

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
