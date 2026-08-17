import { toDateInputValue } from "@/lib/dateTime";

export type HabitRecordGroup<TRecord> = {
  date: string;
  records: TRecord[];
};

export type WaterLogLike = {
  amountMl: number;
  occurredAt: string | number | Date;
};

export type ExerciseLogLike = {
  durationMinutes: number;
  caloriesBurned: number;
  occurredAt: string | number | Date;
};

export type WaterLogDayGroup<TRecord extends WaterLogLike> = HabitRecordGroup<TRecord> & {
  totalMl: number;
};

export type ExerciseDayGroup<TRecord extends ExerciseLogLike> = HabitRecordGroup<TRecord> & {
  totalCalories: number;
  totalMinutes: number;
  activityCount: number;
};

function toRecordDate(value: string | number | Date) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return new Date(Number(trimmed));
  return new Date(trimmed);
}

function sortByOccurredAtDesc<TRecord extends { occurredAt: string | number | Date }>(records: TRecord[]) {
  return records.slice().sort((first, second) => toRecordDate(second.occurredAt).getTime() - toRecordDate(first.occurredAt).getTime());
}

export function buildHabitRecordDayGroups<TRecord extends { occurredAt: string | number | Date }>(
  records: TRecord[],
  options: {
    timeZone?: string;
    sortDirection?: "asc" | "desc";
  } = {},
): HabitRecordGroup<TRecord>[] {
  const recordsByDate = new Map<string, TRecord[]>();

  for (const record of records) {
    const dateKey = toDateInputValue(toRecordDate(record.occurredAt), options.timeZone);
    const current = recordsByDate.get(dateKey) ?? [];
    current.push(record);
    recordsByDate.set(dateKey, current);
  }

  const direction = options.sortDirection ?? "desc";
  const sortedDates = Array.from(recordsByDate.keys()).sort((left, right) => {
    if (left === right) return 0;
    return direction === "asc" ? left.localeCompare(right) : right.localeCompare(left);
  });

  return sortedDates.map(date => ({
    date,
    records: sortByOccurredAtDesc(recordsByDate.get(date) ?? []),
  }));
}

export function buildWaterLogDayGroups<TRecord extends WaterLogLike>(
  records: TRecord[],
  options: {
    timeZone?: string;
    sortDirection?: "asc" | "desc";
  } = {},
): WaterLogDayGroup<TRecord>[] {
  return buildHabitRecordDayGroups(records, options).map(group => ({
    ...group,
    totalMl: group.records.reduce((total, record) => total + Number(record.amountMl || 0), 0),
  }));
}

export function buildExerciseDayGroups<TRecord extends ExerciseLogLike>(
  records: TRecord[],
  options: {
    timeZone?: string;
    sortDirection?: "asc" | "desc";
  } = {},
): ExerciseDayGroup<TRecord>[] {
  return buildHabitRecordDayGroups(records, options).map(group => ({
    ...group,
    totalCalories: group.records.reduce((total, record) => total + Number(record.caloriesBurned || 0), 0),
    totalMinutes: group.records.reduce((total, record) => total + Number(record.durationMinutes || 0), 0),
    activityCount: group.records.length,
  }));
}
