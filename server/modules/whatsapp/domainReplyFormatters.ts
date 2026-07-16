import {
  buildWhatsAppBlock,
  buildWhatsAppCalorieBalanceLine,
  buildWhatsAppMacroProgressLine,
  buildWhatsAppSeparator,
  formatWhatsAppNumber,
} from "./replyTemplates";

function formatSigned(value: number, unit: "kcal" | "g" | "ml" | "kg") {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${formatWhatsAppNumber(rounded)} ${unit}`;
}

export type WhatsAppPeriodProgress = {
  effectiveGoalCalories?: number | null;
  consumedCalories: number;
  exerciseCalories?: number | null;
  consumedProteinGrams?: number | null;
  targetProteinGrams?: number | null;
  consumedCarbsGrams?: number | null;
  targetCarbsGrams?: number | null;
  consumedFatGrams?: number | null;
  targetFatGrams?: number | null;
};

export function buildWhatsAppCanonicalPeriodProgressLines(progress: WhatsAppPeriodProgress) {
  const hasGoal = typeof progress.effectiveGoalCalories === "number"
    && Number.isFinite(progress.effectiveGoalCalories)
    && progress.effectiveGoalCalories > 0;
  const macroLines = [
    buildWhatsAppMacroProgressLine("P", progress.consumedProteinGrams, progress.targetProteinGrams),
    buildWhatsAppMacroProgressLine("C", progress.consumedCarbsGrams, progress.targetCarbsGrams),
    buildWhatsAppMacroProgressLine("G", progress.consumedFatGrams, progress.targetFatGrams),
  ].filter((line): line is string => Boolean(line));
  const balanceLine = hasGoal
    ? buildWhatsAppCalorieBalanceLine({
      consumedCalories: progress.consumedCalories,
      effectiveGoalCalories: progress.effectiveGoalCalories,
      precision: 1,
    })
    : null;

  return [
    hasGoal
      ? `*Meta:* ${formatWhatsAppNumber(progress.effectiveGoalCalories!)} kcal`
      : "*Meta:* não disponível para este período",
    ...(typeof progress.exerciseCalories === "number" && Number.isFinite(progress.exerciseCalories)
      ? [`*Exercícios:* ${formatWhatsAppNumber(progress.exerciseCalories)} kcal`]
      : []),
    `*Consumo:* ${formatWhatsAppNumber(progress.consumedCalories)} kcal`,
    ...(balanceLine ? [balanceLine] : []),
    ...(macroLines.length ? [buildWhatsAppSeparator(), "*Macronutrientes*", ...macroLines] : []),
  ];
}

export function buildWhatsAppCanonicalWaterReply(input: {
  amountMl: number;
  totalMl: number;
  goalMl?: number | null;
  occurredAtLabel: string;
  totalLabel: string;
}) {
  return buildWhatsAppBlock([
    "💧 *Água registrada*",
    buildWhatsAppSeparator(),
    `*Quantidade:* ${formatWhatsAppNumber(input.amountMl)} ml`,
    `*${input.totalLabel}:* ${formatWhatsAppNumber(input.totalMl)} ml`,
    ...(typeof input.goalMl === "number"
      ? [`*Meta:* ${formatWhatsAppNumber(input.goalMl)} ml (${formatSigned(input.totalMl - input.goalMl, "ml")})`]
      : ["*Meta:* não disponível"]),
    `*Data:* ${input.occurredAtLabel}`,
  ]);
}

export function buildWhatsAppCanonicalWeightReply(input: {
  weightKg: number;
  variationKg: number | null;
  occurredAtLabel: string;
}) {
  return buildWhatsAppBlock([
    "⚖️ *Peso registrado*",
    buildWhatsAppSeparator(),
    `*Peso:* ${formatWhatsAppNumber(input.weightKg)} kg`,
    `*Variação:* ${input.variationKg === null ? "primeiro registro" : formatSigned(input.variationKg, "kg")}`,
    `*Data:* ${input.occurredAtLabel}`,
  ]);
}

export function buildWhatsAppCanonicalExerciseReply(input: {
  activity: string;
  durationMinutes?: number | null;
  distanceKm?: number | null;
  calories?: number | null;
  occurredAtLabel: string;
  caloriesEstimated?: boolean;
}) {
  return buildWhatsAppBlock([
    "🏃 *Exercício registrado*",
    buildWhatsAppSeparator(),
    `*Atividade:* ${input.activity}`,
    ...(typeof input.durationMinutes === "number" ? [`*Duração:* ${formatWhatsAppNumber(input.durationMinutes)} min`] : []),
    ...(typeof input.distanceKm === "number" ? [`*Distância:* ${formatWhatsAppNumber(input.distanceKm)} km`] : []),
    ...(typeof input.calories === "number" ? [`*Calorias:* ${formatWhatsAppNumber(input.calories)} kcal`] : []),
    `*Data:* ${input.occurredAtLabel}`,
    ...(input.caloriesEstimated ? [buildWhatsAppSeparator(), "⚠️ Calorias estimadas pelo sistema."] : []),
  ]);
}
