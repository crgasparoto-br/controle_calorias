import { getUserWaterGoal, listUserWaterLogs, listUserWeightEntries } from "../../db";
import { getDateKeyInTimeZone } from "../../../shared/timeZone";
import { getWhatsAppOperationTimeZone } from "./timeZoneContext";

export async function getWhatsAppUserTimeZone(userId: number) {
  return getWhatsAppOperationTimeZone(userId);
}

export async function getWhatsAppWaterProgress(
  userId: number,
  occurredAt: Date,
  explicitTimeZone?: string,
) {
  const timeZone = explicitTimeZone ?? await getWhatsAppOperationTimeZone(userId);
  const [goal, logs] = await Promise.all([
    getUserWaterGoal(userId),
    listUserWaterLogs(userId),
  ]);
  const targetDateKey = getDateKeyInTimeZone(occurredAt, timeZone);
  const totalMl = logs
    .filter(log => getDateKeyInTimeZone(log.occurredAt, timeZone) === targetDateKey)
    .reduce((total, log) => total + Number(log.amountMl ?? 0), 0);
  const rawGoal = Number(goal.dailyTargetMl);

  return {
    totalMl,
    goalMl: Number.isFinite(rawGoal) ? rawGoal : null,
    timeZone,
    dateKey: targetDateKey,
  };
}

export async function getWhatsAppWeightVariation(
  userId: number,
  occurredAt: Date,
  currentWeightKg: number,
) {
  const previousEntry = (await listUserWeightEntries(userId))
    .filter(entry => new Date(entry.measuredAt).getTime() < occurredAt.getTime())
    .sort((first, second) => new Date(second.measuredAt).getTime() - new Date(first.measuredAt).getTime())[0];

  if (!previousEntry) return { variationKg: null, previousWeightKg: null };
  return {
    variationKg: Math.round((currentWeightKg - Number(previousEntry.weightKg)) * 10) / 10,
    previousWeightKg: Number(previousEntry.weightKg),
  };
}
