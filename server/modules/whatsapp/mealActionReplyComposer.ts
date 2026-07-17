import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { buildWhatsAppMealActionReplyMessage } from "./replyMessages";
import { getWhatsAppOperationTimeZone } from "./timeZoneContext";

type MealActionReplyMeal = Parameters<typeof buildWhatsAppMealActionReplyMessage>[0];
type MealActionReplyOptions = Parameters<typeof buildWhatsAppMealActionReplyMessage>[1];
type MealGoalProgressResolver = (typeof import("./goalProgressService"))["getWhatsAppMealGoalProgress"];
type MealGoalProgress = Awaited<ReturnType<MealGoalProgressResolver>>;

export type WhatsAppMealActionReplyEntry = {
  meal: MealActionReplyMeal;
  options: MealActionReplyOptions;
};

async function resolveReplyTimeZone(userId: number, explicitTimeZone?: string) {
  if (explicitTimeZone) return explicitTimeZone;
  try {
    return await getWhatsAppOperationTimeZone(userId);
  } catch {
    return DEFAULT_APP_TIME_ZONE;
  }
}

async function resolveMealGoalProgress(userId: number, occurredAt: Date, timeZone: string): Promise<MealGoalProgress> {
  try {
    const { getWhatsAppMealGoalProgress } = await import("./goalProgressService");
    return await getWhatsAppMealGoalProgress(userId, occurredAt, timeZone);
  } catch {
    return null;
  }
}

function normalizeMealDate(meal: MealActionReplyMeal) {
  const occurredAt = meal.occurredAt instanceof Date ? meal.occurredAt : new Date(meal.occurredAt ?? Number.NaN);
  return Number.isNaN(occurredAt.getTime()) ? null : occurredAt;
}

export async function composeWhatsAppMealActionReplies(input: {
  userId: number;
  entries: WhatsAppMealActionReplyEntry[];
  timeZone?: string;
}) {
  if (!input.entries.length) return "";

  const timeZone = await resolveReplyTimeZone(input.userId, input.timeZone);
  const progressByDate = new Map<string, Promise<MealGoalProgress>>();
  const replies: string[] = [];

  for (const entry of input.entries) {
    const occurredAt = normalizeMealDate(entry.meal);
    let goalProgress: MealGoalProgress = null;

    if (occurredAt) {
      const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
      let progressPromise = progressByDate.get(dateKey);
      if (!progressPromise) {
        progressPromise = resolveMealGoalProgress(input.userId, occurredAt, timeZone);
        progressByDate.set(dateKey, progressPromise);
      }
      goalProgress = await progressPromise;
    }

    replies.push(buildWhatsAppMealActionReplyMessage(entry.meal, {
      ...entry.options,
      timeZone,
      goalProgress,
    }));
  }

  return replies.join("\n\n");
}

export async function composeWhatsAppMealActionReply(input: {
  userId: number;
  meal: MealActionReplyMeal;
  options: MealActionReplyOptions;
  timeZone?: string;
}) {
  return composeWhatsAppMealActionReplies({
    userId: input.userId,
    entries: [{ meal: input.meal, options: input.options }],
    timeZone: input.timeZone,
  });
}
