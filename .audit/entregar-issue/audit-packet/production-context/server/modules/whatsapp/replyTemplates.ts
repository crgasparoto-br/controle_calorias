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
  consumedCalories?: number | null;
  /** Meta final aplicável, já calculada fora do formatter conforme a configuração da #756. */
  effectiveGoalCalories?: number | null;
  /** Alias legado temporário; deve conter a meta efetiva, nunca a meta-base. */
  goalCalories?: number | null;
  exerciseCalories?: number | null;
  includeExerciseCalories?: boolean;
  consumedProteinGrams?: number | null;
  targetProteinGrams?: number | null;
  consumedCarbsGrams?: number | null;
  targetCarbsGrams?: number | null;
  consumedFatGrams?: number | null;
  targetFatGrams?: number | null;
};

export type WhatsAppProgressPrecision = 0 | 1;

export function formatWhatsAppNumber(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 1,
  }).format(value);
}

export function formatWhatsAppMacroValue(value: number) {
  return formatWhatsAppNumber(value);
}

export function formatWhatsAppMacroLine(totals: WhatsAppNutritionTotals) {
  return `${formatWhatsAppNumber(totals.calories)} kcal | P ${formatWhatsAppMacroValue(totals.protein)} g | C ${formatWhatsAppMacroValue(totals.carbs)} g | G ${formatWhatsAppMacroValue(totals.fat)} g`;
}

export function formatWhatsAppNutritionTotalsLine(totals: WhatsAppNutritionTotals) {
  return formatWhatsAppMacroLine(totals);
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
  return `${item.foodName ?? "Alimento"} — ${formatWhatsAppPortionText(item)}`.trim();
}

export function formatWhatsAppFoodLine(item: WhatsAppFoodReplyItem) {
  return `• ${resolveFoodIcon(item)} ${formatWhatsAppFoodDescription(item)}`;
}

export function isWhatsAppEstimatedFoodItem(item: WhatsAppFoodReplyItem) {
  return item.source !== "catalog";
}

export function buildWhatsAppFoodLines(item: WhatsAppFoodReplyItem) {
  return [
    formatWhatsAppFoodLine(item),
    formatWhatsAppMacroLine(item),
  ];
}

export function buildWhatsAppMealTotalLines(totals: WhatsAppNutritionTotals) {
  return [
    buildWhatsAppTitle("Total da refeição:", { bold: true }),
    buildWhatsAppTitle(formatWhatsAppNutritionTotalsLine(totals), { bold: true }),
  ];
}

function roundToPrecision(value: number, precision: WhatsAppProgressPrecision) {
  const factor = precision === 0 ? 1 : 10;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function normalizeProgressValue(value: number, precision: WhatsAppProgressPrecision) {
  return roundToPrecision(Math.max(0, value), precision);
}

function formatSignedPercentage(difference: number, percentage: number) {
  if (difference === 0) return "0%";
  const sign = difference > 0 ? "+" : "-";
  return `${sign}${Math.abs(percentage)}%`;
}

export function buildWhatsAppCalorieBalanceLine(input: {
  consumedCalories?: number | null;
  effectiveGoalCalories?: number | null;
  precision: WhatsAppProgressPrecision;
}) {
  if (typeof input.consumedCalories !== "number" || !Number.isFinite(input.consumedCalories)) return null;
  if (typeof input.effectiveGoalCalories !== "number" || !Number.isFinite(input.effectiveGoalCalories) || input.effectiveGoalCalories <= 0) return null;

  const consumedCalories = normalizeProgressValue(input.consumedCalories, input.precision);
  const effectiveGoalCalories = normalizeProgressValue(input.effectiveGoalCalories, input.precision);
  if (effectiveGoalCalories <= 0) return null;

  const difference = roundToPrecision(consumedCalories - effectiveGoalCalories, input.precision);
  const percentage = Math.round((difference / effectiveGoalCalories) * 100);
  const label = difference > 0 ? "Superávit" : difference < 0 ? "Déficit" : "Equilíbrio";

  return `*${label}:* ${formatWhatsAppNumber(Math.abs(difference))} kcal (${formatSignedPercentage(difference, percentage)})`;
}

export function buildWhatsAppMacroProgressLine(
  label: "P" | "C" | "G",
  consumed: number | null | undefined,
  target: number | null | undefined,
) {
  if (typeof consumed !== "number" || !Number.isFinite(consumed)) return null;
  if (typeof target !== "number" || !Number.isFinite(target) || target <= 0) return null;

  const normalizedConsumed = normalizeProgressValue(consumed, 1);
  const normalizedTarget = normalizeProgressValue(target, 1);
  if (normalizedTarget <= 0) return null;

  const difference = roundToPrecision(normalizedConsumed - normalizedTarget, 1);
  const percentage = Math.round((difference / normalizedTarget) * 100);
  const signedDifference = difference > 0 ? `+${formatWhatsAppNumber(difference)}` : formatWhatsAppNumber(difference);

  return `• ${label} ${formatWhatsAppNumber(normalizedConsumed)} g (${signedDifference} g/${formatSignedPercentage(difference, percentage)})`;
}

export function buildWhatsAppGoalProgressLines(progress: WhatsAppGoalProgressInput | null | undefined) {
  const effectiveGoalCalories = progress?.effectiveGoalCalories ?? progress?.goalCalories;
  if (!progress || typeof effectiveGoalCalories !== "number" || !Number.isFinite(effectiveGoalCalories) || effectiveGoalCalories <= 0) {
    return [];
  }

  const consumedCalories = typeof progress.consumedCalories === "number" && Number.isFinite(progress.consumedCalories)
    ? normalizeProgressValue(progress.consumedCalories, 0)
    : null;
  const finalGoalCalories = normalizeProgressValue(effectiveGoalCalories, 0);
  const exerciseCalories = typeof progress.exerciseCalories === "number" && Number.isFinite(progress.exerciseCalories)
    ? normalizeProgressValue(progress.exerciseCalories, 0)
    : null;
  const balanceLine = buildWhatsAppCalorieBalanceLine({
    consumedCalories,
    effectiveGoalCalories: finalGoalCalories,
    precision: 0,
  });
  const macroLines = [
    buildWhatsAppMacroProgressLine("P", progress.consumedProteinGrams, progress.targetProteinGrams),
    buildWhatsAppMacroProgressLine("C", progress.consumedCarbsGrams, progress.targetCarbsGrams),
    buildWhatsAppMacroProgressLine("G", progress.consumedFatGrams, progress.targetFatGrams),
  ].filter((line): line is string => Boolean(line));

  return [
    `*Meta:* ${formatWhatsAppNumber(finalGoalCalories)} kcal`,
    ...(exerciseCalories !== null ? [`*Exercícios:* ${formatWhatsAppNumber(exerciseCalories)} kcal`] : []),
    ...(consumedCalories === null ? [] : [`*Consumo:* ${formatWhatsAppNumber(consumedCalories)} kcal`]),
    ...(balanceLine ? [balanceLine] : []),
    ...(macroLines.length ? [buildWhatsAppSeparator(), "*Macronutrientes*", ...macroLines] : []),
  ];
}
