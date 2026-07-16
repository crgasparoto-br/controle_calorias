import { calculateMealTotals } from "../../../shared/mealTotals";
import { DEFAULT_APP_TIME_ZONE, getDateKeyInTimeZone } from "../../../shared/timeZone";
import { listMeals } from "../meals/service";
import { getWhatsAppMealGoalProgress } from "./goalProgressService";
import { buildWhatsAppMealContextLine } from "./replyMessages";
import { buildWhatsAppGoalProgressLines, buildWhatsAppMealTotalLines } from "./replyTemplates";
import { getWhatsAppOperationTimeZone } from "./timeZoneContext";

function replaceOnce(value: string, search: string, replacement: string) {
  const index = value.indexOf(search);
  if (index < 0) return value;
  return `${value.slice(0, index)}${replacement}${value.slice(index + search.length)}`;
}

function prioritizeMeal<T extends { id: number }>(meals: T[], mealId?: number | null) {
  if (!mealId) return meals;
  const selected = meals.find(meal => meal.id === mealId);
  return selected ? [selected, ...meals.filter(meal => meal.id !== mealId)] : meals;
}

function insertProgressAfterMealTotal(input: {
  replyText: string;
  contextLine: string;
  totalBlock: string;
  progressBlock: string;
}) {
  const contextIndex = input.replyText.indexOf(input.contextLine);
  if (contextIndex < 0) return input.replyText;

  const totalIndex = input.replyText.indexOf(input.totalBlock, contextIndex);
  if (totalIndex < 0) return input.replyText;

  const insertionIndex = totalIndex + input.totalBlock.length;
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
  if (!input.replyText.includes("*Total da refeição:*") || input.replyText.includes("*Meta:*")) {
    return input.replyText;
  }

  try {
    const timeZone = input.timeZone ?? await getWhatsAppOperationTimeZone(input.userId);
    const meals = prioritizeMeal(await listMeals(input.userId), input.mealId);
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

      const totalBlock = buildWhatsAppMealTotalLines(calculateMealTotals(meal.items ?? [])).join("\n");
      replyText = insertProgressAfterMealTotal({
        replyText,
        contextLine: effectiveContextLine,
        totalBlock,
        progressBlock: progressLines.join("\n"),
      });
    }

    return replyText;
  } catch {
    // O progresso é complementar; falhas não podem bloquear a resposta da mutação já concluída.
    return input.replyText;
  }
}
