import type { MealProcessingResult } from "../../nutritionEngine";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";
import {
  buildWhatsAppBlock,
  buildWhatsAppFoodLines,
  buildWhatsAppGoalProgressLines,
  buildWhatsAppMealTotalLines,
  buildWhatsAppSeparator,
  buildWhatsAppTitle,
  type WhatsAppFoodReplyItem,
  type WhatsAppNutritionTotals,
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

export type WhatsAppConsolidatedMealReplyInput = {
  mealLabel?: string | null;
  occurredAt?: number | string | Date | null;
  items: WhatsAppFoodReplyItem[];
};

export type WhatsAppMealActionReplyOptions = WhatsAppMealReplyOptions & {
  title: string;
  actionLines?: string[];
};

export type WhatsAppAuxiliaryReplyOptions = {
  title: string;
  lines?: Array<string | null | undefined>;
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

function normalizeReplyDate(date?: Date | number | string | null) {
  if (!date) {
    return undefined;
  }
  const parsed = date instanceof Date ? date : new Date(date);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function buildMealTitle(mealLabel?: string | null, registeredAt?: Date, consolidated = false) {
  const label = mealLabel?.trim();
  const time = formatTimeInSaoPaulo(registeredAt);
  const suffix = time ? ` às ${time}hs.` : ".";

  if (!label || label.toLowerCase() === "refeição") {
    return buildWhatsAppTitle(`${consolidated ? "Refeição atualizada" : "Refeição registrada"}${suffix}`, { bold: true });
  }

  return buildWhatsAppTitle(`${label} ${consolidated ? "Atualizado" : "Registrado"}${suffix}`, { bold: true });
}

function buildMealGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined, registeredAt?: Date) {
  const contextualExerciseCalories = getWhatsAppExerciseCaloriesForDateKey(formatDateKeyInSaoPaulo(registeredAt));
  return buildWhatsAppGoalProgressLines(progress
    ? { ...progress, exerciseCalories: progress.exerciseCalories ?? contextualExerciseCalories ?? 0 }
    : null);
}

function sumReplyItems(items: WhatsAppFoodReplyItem[]): WhatsAppNutritionTotals {
  return items.reduce(
    (totals, item) => ({
      calories: totals.calories + Number(item.calories || 0),
      protein: totals.protein + Number(item.protein || 0),
      carbs: totals.carbs + Number(item.carbs || 0),
      fat: totals.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

function buildMealItemLines(items: WhatsAppFoodReplyItem[]) {
  return items.flatMap((item, index) => [
    ...buildWhatsAppFoodLines(item),
    ...(index < items.length - 1 ? [buildWhatsAppSeparator()] : []),
  ]);
}

function buildMealReplyBody(input: {
  title: string;
  sourceText?: string | null;
  items: WhatsAppFoodReplyItem[];
  totals: WhatsAppNutritionTotals;
  goalLines: string[];
}) {
  if (!input.items.length) {
    return buildWhatsAppBlock([
      input.title,
      buildWhatsAppSeparator(),
      input.sourceText || "Não consegui identificar os alimentos com segurança.",
      buildWhatsAppSeparator(),
      ...buildWhatsAppMealTotalLines(input.totals),
      ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
    ]);
  }

  return buildWhatsAppBlock([
    input.title,
    buildWhatsAppSeparator(),
    "Itens:",
    ...buildMealItemLines(input.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(input.totals),
    ...(input.goalLines.length ? [buildWhatsAppSeparator(), ...input.goalLines] : []),
  ]);
}

export function buildWhatsAppAuxiliaryReplyMessage(options: WhatsAppAuxiliaryReplyOptions) {
  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    buildWhatsAppSeparator(),
    ...(options.lines ?? []),
  ]);
}

export function buildWhatsAppClarificationReplyMessage(message: string) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Preciso de uma informação",
    lines: [message],
  });
}

export function buildWhatsAppWaterLoggedReplyMessage(params: { amountLabel: string; occurredAtLabel: string }) {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Água registrada",
    lines: [`Registrei ${params.amountLabel} ml de água em ${params.occurredAtLabel}.`],
  });
}

export function buildWhatsAppSnackSuggestionReplyMessage() {
  return buildWhatsAppAuxiliaryReplyMessage({
    title: "Sugestão para o lanche da tarde",
    lines: [
      "• Iogurte natural com banana e aveia",
      "  Aproximadamente 280 kcal | boa proteína e energia para a tarde",
      buildWhatsAppSeparator(),
      "Outra opção:",
      "• Pão integral com queijo branco e tomate",
      "  Aproximadamente 300 kcal | simples, saciante e fácil de montar",
      buildWhatsAppSeparator(),
      "Se quiser, envie o que você tem em casa que eu sugiro uma opção mais certeira.",
    ],
  });
}

export function buildWhatsAppPeriodReportReplyMessage(params: {
  periodLabel: string;
  mealCount: number;
  mealBreakdownLines: string[];
  goalSummaryLines: string[];
}) {
  if (params.mealCount <= 0) {
    return buildWhatsAppAuxiliaryReplyMessage({
      title: `Resumo de ${params.periodLabel}`,
      lines: ["Não encontrei refeições registradas nesse período."],
    });
  }

  return buildWhatsAppAuxiliaryReplyMessage({
    title: `Resumo de ${params.periodLabel}`,
    lines: [
      `Refeições registradas: ${params.mealCount}`,
      buildWhatsAppSeparator(),
      ...params.mealBreakdownLines,
      ...(params.goalSummaryLines.length ? [buildWhatsAppSeparator(), ...params.goalSummaryLines] : []),
    ],
  });
}

export function buildWhatsAppMealReplyMessage(processed: MealProcessingResult, options: WhatsAppMealReplyOptions = {}) {
  const title = buildMealTitle(processed.detectedMealLabel, options.registeredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, options.registeredAt);

  return buildMealReplyBody({
    title,
    sourceText: processed.sourceText,
    items: processed.items,
    totals: processed.totals,
    goalLines,
  });
}

export function buildWhatsAppConsolidatedMealReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealReplyOptions = {}) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const title = buildMealTitle(meal.mealLabel, registeredAt, true);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt);

  return buildMealReplyBody({
    title,
    items: meal.items,
    totals: sumReplyItems(meal.items),
    goalLines,
  });
}

export function buildWhatsAppMealActionReplyMessage(meal: WhatsAppConsolidatedMealReplyInput, options: WhatsAppMealActionReplyOptions) {
  const registeredAt = options.registeredAt ?? normalizeReplyDate(meal.occurredAt);
  const goalLines = buildMealGoalProgressLines(options.goalProgress, registeredAt);
  const actionLines = options.actionLines?.filter(Boolean) ?? [];

  return buildWhatsAppBlock([
    buildWhatsAppTitle(options.title, { bold: true }),
    ...(actionLines.length ? [buildWhatsAppSeparator(), ...actionLines] : []),
    buildWhatsAppSeparator(),
    "Refeição atualizada:",
    ...buildMealItemLines(meal.items),
    buildWhatsAppSeparator(),
    ...buildWhatsAppMealTotalLines(sumReplyItems(meal.items)),
    ...(goalLines.length ? [buildWhatsAppSeparator(), ...goalLines] : []),
  ]);
}
