import { and, eq } from "drizzle-orm";
import { userPreferences } from "../../../drizzle/schema";
import { getDb } from "../../db";
import { safeLogDetail } from "../../privacy";
import type { MealScheduleItemInput, SuggestMealScheduleInput, UpdateMealSchedulesInput } from "./schemas";

const MEAL_SCHEDULE_PREFERENCE_KEY = "meal_schedule";

const DEFAULT_MEAL_SCHEDULES: MealScheduleItemInput[] = [
  { mealLabel: "café da manhã", startTime: "05:00", endTime: "10:59", enabled: true },
  { mealLabel: "almoço", startTime: "11:00", endTime: "14:59", enabled: true },
  { mealLabel: "lanche da tarde", startTime: "15:00", endTime: "17:29", enabled: true },
  { mealLabel: "pré-treino", startTime: "17:30", endTime: "18:29", enabled: true },
  { mealLabel: "jantar", startTime: "18:30", endTime: "22:59", enabled: true },
  { mealLabel: "ceia", startTime: "23:00", endTime: "04:59", enabled: true },
];

const memoryMealSchedules = new Map<number, MealScheduleItemInput[]>();

function minutesFromTime(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours * 60) + minutes;
}

function isTimeWithinRange(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  const end = minutesFromTime(endTime);
  if (start <= end) {
    return timeMinutes >= start && timeMinutes <= end;
  }

  return timeMinutes >= start || timeMinutes <= end;
}

function rangeCenterDistance(timeMinutes: number, startTime: string, endTime: string) {
  const start = minutesFromTime(startTime);
  let end = minutesFromTime(endTime);
  let current = timeMinutes;
  if (end < start) end += 1440;
  if (current < start) current += 1440;
  const center = start + ((end - start) / 2);
  return Math.abs(current - center);
}

function normalizeSchedules(schedules: MealScheduleItemInput[]) {
  return schedules.map(schedule => ({
    mealLabel: schedule.mealLabel.trim(),
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    enabled: schedule.enabled,
  }));
}

function parseStoredSchedules(value: string | null | undefined) {
  if (!value) return DEFAULT_MEAL_SCHEDULES;
  try {
    const parsed = JSON.parse(value) as MealScheduleItemInput[];
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_MEAL_SCHEDULES;
    return normalizeSchedules(parsed);
  } catch {
    return DEFAULT_MEAL_SCHEDULES;
  }
}

function localTimeMinutes(input: SuggestMealScheduleInput) {
  const occurredAt = new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) return null;

  const formatter = new Intl.DateTimeFormat("pt-BR", {
    timeZone: input.timeZone || "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(occurredAt);
  const hour = Number(parts.find(part => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find(part => part.type === "minute")?.value ?? "0");
  return (hour * 60) + minute;
}

async function loadSchedulesFromDb(userId: number) {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db
      .select()
      .from(userPreferences)
      .where(and(eq(userPreferences.userId, userId), eq(userPreferences.preferenceKey, MEAL_SCHEDULE_PREFERENCE_KEY)))
      .limit(1);
    return parseStoredSchedules(rows[0]?.preferenceValue);
  } catch (error) {
    console.warn("[Database] Meal schedule read skipped:", safeLogDetail(error));
    return null;
  }
}

async function persistSchedulesToDb(userId: number, schedules: MealScheduleItemInput[]) {
  const db = await getDb();
  if (!db) return;

  try {
    await db.insert(userPreferences).values({
      userId,
      preferenceKey: MEAL_SCHEDULE_PREFERENCE_KEY,
      preferenceValue: JSON.stringify(schedules),
    }).onDuplicateKeyUpdate({
      set: {
        preferenceValue: JSON.stringify(schedules),
        updatedAt: new Date(),
      },
    });
  } catch (error) {
    console.warn("[Database] Meal schedule persistence skipped:", safeLogDetail(error));
  }
}

export async function listMealSchedules(userId: number) {
  const dbSchedules = await loadSchedulesFromDb(userId);
  const schedules = dbSchedules ?? memoryMealSchedules.get(userId) ?? DEFAULT_MEAL_SCHEDULES;
  memoryMealSchedules.set(userId, schedules);
  return schedules;
}

export async function updateMealSchedules(userId: number, input: UpdateMealSchedulesInput) {
  const schedules = normalizeSchedules(input.schedules);
  memoryMealSchedules.set(userId, schedules);
  await persistSchedulesToDb(userId, schedules);
  return schedules;
}

export async function suggestMealLabelForTime(userId: number, input: SuggestMealScheduleInput) {
  const schedules = (await listMealSchedules(userId)).filter(schedule => schedule.enabled);
  const timeMinutes = localTimeMinutes(input);
  if (timeMinutes === null || !schedules.length) {
    return {
      mealLabel: "outro" as const,
      matchedSchedule: null,
      confidence: 0,
    };
  }

  const directMatches = schedules
    .filter(schedule => isTimeWithinRange(timeMinutes, schedule.startTime, schedule.endTime))
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime));

  const matchedSchedule = directMatches[0] ?? schedules
    .slice()
    .sort((a, b) => rangeCenterDistance(timeMinutes, a.startTime, a.endTime) - rangeCenterDistance(timeMinutes, b.startTime, b.endTime))[0];

  return {
    mealLabel: matchedSchedule?.mealLabel ?? "outro",
    matchedSchedule: matchedSchedule ?? null,
    confidence: directMatches.length ? 1 : 0.6,
  };
}

export const defaultMealSchedules = DEFAULT_MEAL_SCHEDULES;
