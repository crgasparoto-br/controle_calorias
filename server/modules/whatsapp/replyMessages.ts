import type { MealProcessingResult } from "../../nutritionEngine";
import { getWhatsAppExerciseCaloriesForDateKey } from "./goalProgressContext";

export type WhatsAppMealGoalProgress = {
  consumedCalories: number;
  goalCalories: number;
  exerciseCalories?: number;
};

export type WhatsAppMealReplyOptions = {
  registeredAt?: Date;
  goalProgress?: WhatsAppMealGoalProgress | null;
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

function formatMacro(value: number) {
  return formatNumber(value);
}

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

function portionUsesWeightUnit(portionText: string) {
  return /\d\s*(?:g|gramas?|kg|quilogramas?)\b/i.test(portionText);
}

function portionUsesVolumeUnit(portionText: string) {
  return /\d\s*(?:ml|m\s*l|l|litros?)\b/i.test(portionText)
    || /\b(?:copo|copos|xicara|xicaras|xícara|xícaras|colher|colheres|dose|doses)\b/i.test(portionText);
}

function shouldShowApproximateGrams(item: MealProcessingResult["items"][number]) {
  return item.estimatedGrams > 0
    && !portionUsesWeightUnit(item.portionText)
    && !portionUsesVolumeUnit(item.portionText);
}

function formatPortionText(item: MealProcessingResult["items"][number]) {
  const gramsLabel = shouldShowApproximateGrams(item) ? ` (aprox. ${formatMacro(item.estimatedGrams)}g)` : "";
  const compactPortion = item.portionText.replace(/(\d+(?:[,.]\d+)?)\s+g\b/gi, "$1g");
  return `${compactPortion}${gramsLabel}`;
}

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  return `${item.foodName}, ${formatPortionText(item)} - ${formatMacro(item.calories)} Kcal`.trim();
}

function formatItemMacros(item: MealProcessingResult["items"][number]) {
  return `Prot. ${formatMacro(item.protein)} g | Carb. ${formatMacro(item.carbs)} g | Gord. ${formatMacro(item.fat)} g`;
}

function buildMealTitle(mealLabel?: string, registeredAt?: Date) {
  const label = mealLabel?.trim();
  const time = formatTimeInSaoPaulo(registeredAt);
  const suffix = time ? ` às ${time}hs.` : ".";

  if (!label || label.toLowerCase() === "refeição") {
    return `Refeição registrada${suffix}`;
  }

  return `${label} Registrado${suffix}`;
}

function buildGoalProgressLines(progress: WhatsAppMealGoalProgress | null | undefined, registeredAt?: Date) {
  if (!progress || progress.goalCalories <= 0) {
    return [];
  }

  const consumedCalories = Math.max(0, Math.round(progress.consumedCalories));
  const goalCalories = Math.round(progress.goalCalories);
  const contextualExerciseCalories = getWhatsAppExerciseCaloriesForDateKey(formatDateKeyInSaoPaulo(registeredAt));
  const exerciseCalories = Math.max(0, Math.round(progress.exerciseCalories ?? contextualExerciseCalories ?? 0));
  const adjustedGoalCalories = goalCalories + exerciseCalories;
  const balanceCalories = adjustedGoalCalories - consumedCalories;
  const balanceLabel = balanceCalories >= 0 ? "Déficit" : "Superávit";

  return [
    "*Meta de hoje:*",
    `• Meta: ${formatNumber(goalCalories)} Kcal`,
    `• Meta ajustada: ${formatNumber(adjustedGoalCalories)} Kcal`,
    `• ${balanceLabel}: ${formatNumber(Math.abs(balanceCalories))} Kcal`,
  ];
}

export function buildWhatsAppMealReplyMessage(processed: MealProcessingResult, options: WhatsAppMealReplyOptions = {}) {
  const title = buildMealTitle(processed.detectedMealLabel, options.registeredAt);
  const goalLines = buildGoalProgressLines(options.goalProgress, options.registeredAt);

  if (!processed.items.length) {
    return [
      title,
      "",
      processed.sourceText || "Não consegui identificar os alimentos com segurança.",
      "",
      "Total da refeição:",
      `${formatMacro(processed.totals.calories)} Kcal`,
      `Prot. ${formatMacro(processed.totals.protein)} g | Carb. ${formatMacro(processed.totals.carbs)} g | Gord. ${formatMacro(processed.totals.fat)} g`,
      ...(goalLines.length ? ["", ...goalLines] : []),
    ].join("\n");
  }

  const itemLines = processed.items.flatMap(item => [
    formatFoodDescription(item),
    formatItemMacros(item),
    "",
  ]);
  if (itemLines.at(-1) === "") {
    itemLines.pop();
  }

  return [
    title,
    "",
    "Itens:",
    ...itemLines,
    "",
    "Total da refeição:",
    `${formatMacro(processed.totals.calories)} Kcal`,
    `Prot. ${formatMacro(processed.totals.protein)} g | Carb. ${formatMacro(processed.totals.carbs)} g | Gord. ${formatMacro(processed.totals.fat)} g`,
    ...(goalLines.length ? ["", ...goalLines] : []),
  ].join("\n");
}
