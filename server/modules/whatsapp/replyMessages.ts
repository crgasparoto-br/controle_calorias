import type { MealProcessingResult } from "../../nutritionEngine";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppGoalProgressLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
} from "./replyTemplates";

export type WhatsAppMealGoalProgress = {
  consumedCalories: number;
  goalCalories: number;
  exerciseCalories?: number;
};

export type WhatsAppMealReplyOptions = {
  registeredAt?: Date;
  goalProgress?: WhatsAppMealGoalProgress | null;
};

function formatDateKeyInSaoPaulo(date?: Date) {
  if (!date) {
    return undefined;
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatTimeInSaoPaulo(date?: Date) {
  if (!date) {
    return undefined;
  }

  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function buildMealTitle(mealLabel?: string, registeredAt?: Date) {
  const label = mealLabel?.trim();
  const time = formatTimeInSaoPaulo(registeredAt);
  const suffix = time ? ` às ${time}hs.` : ".";

  if (!label || label.toLowerCase() === "refeição") {
    return buildWhatsAppTitle(`Refeição registrada${suffix}`);
  }

  return buildWhatsAppTitle(`${label} Registrado${suffix}`);
}

function buildMealGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined, registeredAt?: Date) {
  const contextualExerciseCalories = getWhatsAppExerciseCaloriesForDateKey(formatDateKeyInSaoPaulo(registeredAt));
  return buildWhatsAppGoalProgressLines(progress
    ? { ...progress, exerciseCalories: progress.exerciseCalories ?? contextualExerciseCalories ?? 0 }
    : null);
}

export function buildWhatsAppMealReplyMessage(processed: MealProcessingResult, options: WhatsAppMealReplyOptions = {}) {
  const title = buildMealTitle(processed.detectedMealLabel, options.registeredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, options.registeredAt);
  const totalLines = buildWhatsAppMealTotalLines(processed.totals);

  if (!processed.items.length) {
    return buildWhatsAppBlock([
      title,
      buildWhatsAppSeparator(),
      processed.sourceText || "Não consegui identificar os alimentos com segurança.",
      buildWhatsAppSeparator(),
      ...totalLines,
      ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
    ]);
  }

  const itemLines = processed.items.flatMap((item, index) => [
    ...buildWhatsAppFoodLines(item),
    ...(index < processed.items.length - 1 ? [buildWhatsAppSeparator()] : []),
  ]);

  return buildWhatsAppBlock([
    title,
    buildWhatsAppSeparator(),
    "Itens:",
    ...itemLines,
    buildWhatsAppSeparator(),
    ...totalLines,
    ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
  ]);
}
