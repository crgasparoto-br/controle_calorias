import { buildWhatsAppBlock, buildWhatsAppSeparator, formatWhatsAppNumber } from "./replyTemplates";

function formatSigned(value: number, unit: "kcal" | "g" | "ml") {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${formatWhatsAppNumber(rounded)} ${unit}`;
}

export type WhatsAppPeriodProgress = {
  effectiveGoalCalories: number;
  consumedCalories: number;
  exerciseCalories?: number | null;
  consumedProteinGrams?: number | null;
  targetProteinGrams?: number | null;
  consumedCarbsGrams?: number | null;
  targetCarbsGrams?: number | null;
  consumedFatGrams?: number | null;
  targetFatGrams?: number | null;
};

function macroLine(label: "P" | "C" | "G", consumed?: number | null, target?: number | null) {
  if (typeof consumed !== "number" || typeof target !== "number") return null;
  return `• ${label} ${formatWhatsAppNumber(consumed)} g (${formatSigned(consumed - target, "g")})`;
}

export function buildWhatsAppCanonicalPeriodProgressLines(progress: WhatsAppPeriodProgress) {
  const macroLines = [
    macroLine("P", progress.consumedProteinGrams, progress.targetProteinGrams),
    macroLine("C", progress.consumedCarbsGrams, progress.targetCarbsGrams),
    macroLine("G", progress.consumedFatGrams, progress.targetFatGrams),
  ].filter((line): line is string => Boolean(line));

  return [
    `*Meta:* ${formatWhatsAppNumber(progress.effectiveGoalCalories)} kcal`,
    ...(typeof progress.exerciseCalories === "number"
      ? [`*Exercícios:* ${formatWhatsAppNumber(progress.exerciseCalories)} kcal`]
      : []),
    `*Consumo:* ${formatWhatsAppNumber(progress.consumedCalories)} kcal (${formatSigned(progress.consumedCalories - progress.effectiveGoalCalories, "kcal")})`,
    ...(macroLines.length ? [buildWhatsAppSeparator(), "*Macronutrientes*", ...macroLines] : []),
  ];
}

export function buildWhatsAppCanonicalWaterReply(input: {
  amountMl: number;
  totalMl: number;
  goalMl: number;
  occurredAtLabel: string;
  totalLabel: string;
}) {
  return buildWhatsAppBlock([
    "💧 *Água registrada*",
    buildWhatsAppSeparator(),
    `*Quantidade:* ${formatWhatsAppNumber(input.amountMl)} ml`,
    `*${input.totalLabel}:* ${formatWhatsAppNumber(input.totalMl)} ml`,
    `*Meta:* ${formatWhatsAppNumber(input.goalMl)} ml (${formatSigned(input.totalMl - input.goalMl, "ml")})`,
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
    `*Variação:* ${input.variationKg === null ? "primeiro registro" : formatSigned(input.variationKg, "g").replace(" g", " kg")}`,
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
