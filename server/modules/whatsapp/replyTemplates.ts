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
  /** Meta final aplicável, já calculada pelo domínio conforme a configuração da #756. */
  effectiveGoalCalories: number | null;
  exerciseCalories?: number | null;
  consumedProteinGrams?: number | null;
  targetProteinGrams?: number | null;
  consumedCarbsGrams?: number | null;
  targetCarbsGrams?: number | null;
  consumedFatGrams?: number | null;
  targetFatGrams?: number | null;
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

/** Item cuja nutrição não veio integralmente do catálogo confiável e foi estimada pela IA (issue #783). */
export function isWhatsAppEstimatedFoodItem(item: WhatsAppFoodReplyItem) {
  return item.source !== "catalog";
}

export const WHATSAPP_ESTIMATED_NUTRITION_WARNING = "⚠️ Valores nutricionais estimados pela IA.";

export function buildWhatsAppFoodLines(item: WhatsAppFoodReplyItem) {
  return [
    formatWhatsAppFoodLine(item),
    formatWhatsAppMacroLine(item),
    ...(isWhatsAppEstimatedFoodItem(item) ? [WHATSAPP_ESTIMATED_NUTRITION_WARNING] : []),
  ];
}

export function buildWhatsAppMealTotalLines(totals: WhatsAppNutritionTotals) {
  return [
    "*Total da refeição*",
    formatWhatsAppNutritionTotalsLine(totals),
  ];
}

function formatSignedDifference(value: number, unit: "kcal" | "g") {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${formatWhatsAppNumber(rounded)} ${unit}`;
}

function buildMacroProgressLine(label: "P" | "C" | "G", consumed: number | null | undefined, target: number | null | undefined) {
  if (typeof consumed !== "number" || typeof target !== "number") return null;
  return `• ${label} ${formatWhatsAppNumber(consumed)} g (${formatSignedDifference(consumed - target, "g")})`;
}

export function buildWhatsAppGoalProgressLines(progress: WhatsAppGoalProgressInput | null | undefined) {
  const effectiveGoalCalories = progress?.effectiveGoalCalories;
  if (!progress || typeof effectiveGoalCalories !== "number" || effectiveGoalCalories <= 0) {
    return [];
  }

  const consumedCalories = typeof progress.consumedCalories === "number"
    ? Math.max(0, Math.round(progress.consumedCalories))
    : null;
  const finalGoalCalories = Math.round(effectiveGoalCalories);
  const calorieDifference = consumedCalories === null ? null : consumedCalories - finalGoalCalories;
  const exerciseCalories = typeof progress.exerciseCalories === "number"
    ? Math.max(0, Math.round(progress.exerciseCalories))
    : null;
  const macroLines = [
    buildMacroProgressLine("P", progress.consumedProteinGrams, progress.targetProteinGrams),
    buildMacroProgressLine("C", progress.consumedCarbsGrams, progress.targetCarbsGrams),
    buildMacroProgressLine("G", progress.consumedFatGrams, progress.targetFatGrams),
  ].filter((line): line is string => Boolean(line));

  return [
    `*Meta:* ${formatWhatsAppNumber(finalGoalCalories)} kcal`,
    ...(exerciseCalories !== null ? [`*Exercícios:* ${formatWhatsAppNumber(exerciseCalories)} kcal`] : []),
    ...(consumedCalories === null
      ? []
      : [`*Consumo:* ${formatWhatsAppNumber(consumedCalories)} kcal (${formatSignedDifference(calorieDifference!, "kcal")})`]),
    ...(macroLines.length ? [buildWhatsAppSeparator(), "*Macronutrientes*", ...macroLines] : []),
  ];
}
