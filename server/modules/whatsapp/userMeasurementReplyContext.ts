import { getUserWaterGoal, listUserWaterLogs, listUserWeightEntries } from "../../db";

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

function logicalDateKey(value: Date | number | string, timeZone = DEFAULT_TIME_ZONE) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const read = (type: string) => parts.find(part => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}

export async function getWhatsAppWaterProgress(userId: number, occurredAt: Date) {
  const [goal, logs] = await Promise.all([
    getUserWaterGoal(userId),
    listUserWaterLogs(userId),
  ]);
  const targetDateKey = logicalDateKey(occurredAt);
  const totalMl = logs
    .filter(log => logicalDateKey(log.occurredAt) === targetDateKey)
    .reduce((total, log) => total + Number(log.amountMl ?? 0), 0);

  return {
    totalMl,
    goalMl: Number(goal.dailyTargetMl),
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
