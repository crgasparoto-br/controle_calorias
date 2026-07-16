import { getUserWaterGoal, listUserWaterLogs, listUserWeightEntries } from "../../db";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { getUserOnboardingProfile } from "../onboarding/profileRead";

export async function getWhatsAppUserTimeZone(userId: number) {
  try {
    return (await getUserOnboardingProfile(userId))?.timezone ?? DEFAULT_APP_TIME_ZONE;
  } catch {
    return DEFAULT_APP_TIME_ZONE;
  }
}

export async function getWhatsAppWaterProgress(userId: number, occurredAt: Date) {
  const [goal, logs, timeZone] = await Promise.all([
    getUserWaterGoal(userId),
    listUserWaterLogs(userId),
    getWhatsAppUserTimeZone(userId),
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
