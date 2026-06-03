import type { MealProcessingResult } from "../../nutritionEngine";

export type WhatsAppMealGoalProgress = {
  consumedCalories: number;
  goalCalories: number;
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

function formatFoodDescription(item: MealProcessingResult["items"][number]) {
  const portionHasGrams = /\d\s*g\b/i.test(item.portionText);
  const gramsLabel = !portionHasGrams && item.estimatedGrams > 0 ? ` (aprox. ${formatMacro(item.estimatedGrams)} g)` : "";
  return `${item.foodName}, ${item.portionText}${gramsLabel}`.trim();
}

function formatItemMacros(item: MealProcessingResult["items"][number]) {
  return `${formatMacro(item.calories)} kcal | Prot. ${formatMacro(item.protein)} g | Carb. ${formatMacro(item.carbs)} g | Gord. ${formatMacro(item.fat)} g`;
}

function buildMealTitle(mealLabel?: string) {
  const label = mealLabel?.trim();
  if (!label || label === "Refeição") {
    return "Refeição registrada.";
  }

  if (label.toLowerCase() === "refeição") {
    return "Refeição registrada.";
  }

  return `${label} registrado.`;
}

function buildGoalProgressLines(progress?: WhatsAppMealGoalProgress | null) {
  if (!progress || progress.goalCalories <= 0) {
    return [];
  }

  const consumedCalories = Math.max(0, Math.round(progress.consumedCalories));
  const goalCalories = Math.round(progress.goalCalories);
  const diff = consumedCalories - goalCalories;
  const statusLine = diff > 0
    ? `Passou ${formatNumber(diff)} kcal da sua meta.`
    : `Faltam ${formatNumber(Math.abs(diff))} kcal para sua meta.`;

  return [
    "Meta de hoje:",
    `Você já consumiu ${formatNumber(consumedCalories)} de ${formatNumber(goalCalories)} kcal.`,
    statusLine,
  ];
}

export function buildWhatsAppMealReplyMessage(processed: MealProcessingResult, options: WhatsAppMealReplyOptions = {}) {
  const title = buildMealTitle(processed.detectedMealLabel);
  const goalLines = buildGoalProgressLines(options.goalProgress);

  if (!processed.items.length) {
    return [
      title,
      "",
      processed.sourceText || "Não consegui identificar os alimentos com segurança.",
      "",
      "Total da refeição:",
      `${formatMacro(processed.totals.calories)} kcal`,
      `Prot. ${formatMacro(processed.totals.protein)} g | Carb. ${formatMacro(processed.totals.carbs)} g | Gord. ${formatMacro(processed.totals.fat)} g`,
      ...(goalLines.length ? ["", ...goalLines] : []),
    ].join("\n");
  }

  const itemLines = processed.items.flatMap(item => [
    `• ${formatFoodDescription(item)}`,
    `  ${formatItemMacros(item)}`,
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
    `${formatMacro(processed.totals.calories)} kcal`,
    `Prot. ${formatMacro(processed.totals.protein)} g | Carb. ${formatMacro(processed.totals.carbs)} g | Gord. ${formatMacro(processed.totals.fat)} g`,
    ...(goalLines.length ? ["", ...goalLines] : []),
  ].join("\n");
}
