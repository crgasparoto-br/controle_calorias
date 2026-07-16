import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { listMeals } from "../meals/service";
import { getWhatsAppMealGoalProgress } from "./goalProgressService";
import { buildWhatsAppMealContextLine } from "./replyMessages";
import { buildWhatsAppGoalProgressLines } from "./replyTemplates";
import { getWhatsAppOperationTimeZone } from "./timeZoneContext";

const MEAL_TOTAL_TITLE = "*Total da refeição:*";

function replaceOnce(value: string, search: string, replacement: string) {
  const index = value.indexOf(search);
  if (index < 0) return value;
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function prioritizeMealsForReply<T extends { id: number; occurredAt: number | string | Date }>(
  meals: T[],
  mealId: number | null | undefined,
  timeZone: string,
) {
  if (!mealId) return meals;
  const selected = meals.find(meal => meal.id === mealId);
  if (!selected) return meals;

  const selectedDateKey = getDateKeyInTimeZone(new Date(selected.occurredAt), timeZone);
  return [
    selected,
    ...meals.filter(meal => meal.id !== mealId
      && getDateKeyInTimeZone(new Date(meal.occurredAt), timeZone) === selectedDateKey),
  ];
}

function insertProgressAfterMealTotal(input: {
  replyText: string;
  contextLine: string;
  progressBlock: string;
}) {
  const contextIndex = input.replyText.indexOf(input.contextLine);
  if (contextIndex < 0) return input.replyText;

  const titleIndex = input.replyText.indexOf(MEAL_TOTAL_TITLE, contextIndex);
  if (titleIndex < 0) return input.replyText;

  const valuesStart = titleIndex + MEAL_TOTAL_TITLE.length + 1;
  const valuesEnd = input.replyText.indexOf("\n", valuesStart);
  const insertionIndex = valuesEnd < 0 ? input.replyText.length : valuesEnd;
  const valuesLine = input.replyText.slice(valuesStart, insertionIndex);
  if (!valuesLine.startsWith("*") || !valuesLine.endsWith("*")) return input.replyText;

  const suffix = input.replyText.slice(insertionIndex);
  if (suffix.startsWith(`\n\n${input.progressBlock}`)) return input.replyText;

  return `${input.replyText.slice(0, insertionIndex)}\n\n${input.progressBlock}${suffix}`;
}

export async function enrichWhatsAppMealActionReply(input: {
  userId: number;
  replyText: string;
  mealId?: number | null;
  timeZone?: string;
}) {
  if (!input.replyText.includes(MEAL_TOTAL_TITLE) || input.replyText.includes("*Meta:*")) {
    return input.replyText;
  }

  try {
    const timeZone = input.timeZone ?? await getWhatsAppOperationTimeZone(input.userId);
    const meals = prioritizeMealsForReply(await listMeals(input.userId), input.mealId, timeZone);
    const progressByDate = new Map<string, ReturnType<typeof getWhatsAppMealGoalProgress>>();
    let replyText = input.replyText;

    for (const meal of meals) {
      const occurredAt = new Date(meal.occurredAt);
      if (Number.isNaN(occurredAt.getTime())) continue;

      const defaultContextLine = buildWhatsAppMealContextLine(meal.mealLabel, occurredAt, DEFAULT_APP_TIME_ZONE);
      const effectiveContextLine = buildWhatsAppMealContextLine(meal.mealLabel, occurredAt, timeZone);
      if (!replyText.includes(defaultContextLine) && !replyText.includes(effectiveContextLine)) continue;

      if (defaultContextLine !== effectiveContextLine && replyText.includes(defaultContextLine)) {
        replyText = replaceOnce(replyText, defaultContextLine, effectiveContextLine);
      }

      const dateKey = getDateKeyInTimeZone(occurredAt, timeZone);
      let progressPromise = progressByDate.get(dateKey);
      if (!progressPromise) {
        progressPromise = getWhatsAppMealGoalProgress(input.userId, occurredAt, timeZone);
        progressByDate.set(dateKey, progressPromise);
      }

      const progressLines = buildWhatsAppGoalProgressLines(await progressPromise);
      if (!progressLines.length) continue;

      replyText = insertProgressAfterMealTotal({
        replyText,
        contextLine: effectiveContextLine,
        progressBlock: progressLines.join("\n"),
      });
    }

    return replyText;
  } catch {
    // O progresso é complementar; falhas não podem bloquear a resposta da mutação já concluída.
    return input.replyText;
  }
}
