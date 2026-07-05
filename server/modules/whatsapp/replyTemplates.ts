import { resolveFoodIcon, type FoodIconInput } from "./foodIcons";

export type WhatsAppNutritionTotals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type WhatsAppFoodReplyItem = FoodIconInput & WhatsAppNutritionTotals & {
  portionText: string;
  estimatedGrams: number;
  source?: string | null;
};

export type WhatsAppGoalProgressInput = {
  consumedCalories: number;
  goalCalories: number;
  exerciseCalories?: number;
};

export function formatWhatsAppNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

export function formatWhatsAppMacroValue(value: number) {
  return formatWhatsAppNumber(value);
}

export function formatWhatsAppMacroLine(totals: WhatsAppNutritionTotals) {
  return `Prot. ${formatWhatsAppMacroValue(totals.protein)} g | Carb. ${formatWhatsAppMacroValue(totals.carbs)} g | Gord. ${formatWhatsAppMacroValue(totals.fat)} g`;
}

export function formatWhatsAppNutritionTotalsLine(totals: WhatsAppNutritionTotals) {
  return `${formatWhatsAppNumber(totals.calories)} kcal | ${formatWhatsAppMacroLine(totals)}`;
}

export function buildWhatsAppTitle(title: string, options: { bold?: boolean } = {}) {
  const normalizedTitle = title.trim();
  return options.bold ? `*${normalizedTitle}*` : normalizedTitle;
}

export function buildWhatsAppSeparator() {
  return "";
}

export function buildWhatsAppBlock(lines: Array<string | null | undefined>) {
  return lines.filter((line): line is string => line !== null && line !== undefined).join("\n");
}

export function buildWhatsAppBulletList(lines: string[]) {
  return lines.map(line => `• ${line}`);
}

function portionUsesWeightUnit(portionText: string) {
  return /\d\s*(?:g|gramas?|kg|quilogramas?)\b/i.test(portionText);
}

function portionUsesVolumeUnit(portionText: string) {
  return /\d\s*(?:ml|m\s*l|l|litros?)\b/i.test(portionText)
    || /\b(?:copo|copos|xicara|xicaras|xícara|xícaras|colher|colheres|dose|doses)\b/i.test(portionText);
}

function shouldShowApproximateGrams(item: WhatsAppFoodReplyItem) {
  return item.estimatedGrams > 0
    && !portionUsesWeightUnit(item.portionText)
    && !portionUsesVolumeUnit(item.portionText);
}

export function formatWhatsAppPortionText(item: WhatsAppFoodReplyItem) {
  const gramsLabel = shouldShowApproximateGrams(item) ? ` (aprox. ${formatWhatsAppMacroValue(item.estimatedGrams)}g)` : "";
  const compactPortion = item.portionText.replace(/(\d+(?:[,.]\d+)?)\s+g\b/gi, "$1g");
  return `${compactPortion}${gramsLabel}`;
}

export function formatWhatsAppFoodDescription(item: WhatsAppFoodReplyItem) {
  const estimationLabel = item.source === "heuristic" ? " (estimado)" : "";
  return `${item.foodName ?? "Alimento"}, ${formatWhatsAppPortionText(item)}${estimationLabel} - ${formatWhatsAppMacroValue(item.calories)} Kcal`.trim();
}

export function formatWhatsAppFoodLine(item: WhatsAppFoodReplyItem) {
  return `• ${resolveFoodIcon(item)} ${formatWhatsAppFoodDescription(item)}`;
}

export function buildWhatsAppFoodLines(item: WhatsAppFoodReplyItem) {
  return [
    formatWhatsAppFoodLine(item),
    formatWhatsAppMacroLine(item),
  ];
}

export function buildWhatsAppMealTotalLines(totals: WhatsAppNutritionTotals) {
  return [
    "Total da refeição:",
    `${formatWhatsAppMacroValue(totals.calories)} Kcal`,
    formatWhatsAppMacroLine(totals),
  ];
}

export function buildWhatsAppGoalProgressLines(progress: WhatsAppGoalProgressInput | null | undefined) {
  if (!progress || progress.goalCalories <= 0) {
    return [];
  }

  const consumedCalories = Math.max(0, Math.round(progress.consumedCalories));
  const goalCalories = Math.round(progress.goalCalories);
  const exerciseCalories = Math.max(0, Math.round(progress.exerciseCalories ?? 0));
  const adjustedGoalCalories = goalCalories + exerciseCalories;
  const balanceCalories = adjustedGoalCalories - consumedCalories;
  const balanceLabel = balanceCalories >= 0 ? "Déficit" : "Superávit";

  return [
    "Meta de hoje:",
    `* Meta estimada: ${formatWhatsAppNumber(goalCalories)} kcal`,
    ...(exerciseCalories > 0 ? [`* Exercícios: ${formatWhatsAppNumber(exerciseCalories)} kcal`] : []),
    `* Meta ajustada: ${formatWhatsAppNumber(adjustedGoalCalories)} kcal`,
    `* Consumo: ${formatWhatsAppNumber(consumedCalories)} kcal`,
    `* ${balanceLabel}: ${formatWhatsAppNumber(Math.abs(balanceCalories))} kcal`,
  ];
}
