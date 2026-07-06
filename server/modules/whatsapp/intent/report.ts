import type { MealDraftItem } from "../../../nutritionEngine";
import { sumMealItems, toMealItemInputs } from "./mealItemHelpers";
import { formatNumber } from "./textUtils";
import type { NutritionTotals } from "./types";

export function buildMealBreakdownLines(meals: Array<{ mealLabel?: string | null; items?: MealDraftItem[] }>) {
  const groups = new Map<string, NutritionTotals>();
  for (const meal of [...meals].reverse()) {
    const label = meal.mealLabel?.trim() || "Refeição";
    const itemTotals = sumMealItems(toMealItemInputs(meal.items));
    const existing = groups.get(label) ?? { calories: 0, protein: 0, carbs: 0, fat: 0 };
    groups.set(label, {
      calories: existing.calories + itemTotals.calories,
      protein: existing.protein + itemTotals.protein,
      carbs: existing.carbs + itemTotals.carbs,
      fat: existing.fat + itemTotals.fat,
    });
  }
  const lines: string[] = [];
  for (const [label, totals] of groups) {
    if (lines.length > 0) lines.push("");
    lines.push(`${label}: ${formatNumber(totals.calories)} kcal`);
    lines.push(`* Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`);
  }
  return lines;
}

export function buildPeriodGoalSummaryLines(goalCalories: number, diff: number) {
  if (goalCalories <= 0) {
    return [];
  }

  const balanceLabel = diff > 0 ? "Superávit" : "Déficit";
  const balanceDetail = diff > 0 ? "da meta estimada do período" : "para a meta estimada do período";
  const pct = Math.round((Math.abs(diff) / goalCalories) * 100);
  const pctStr = diff > 0 ? `(+${pct}%)` : `(-${pct}%)`;

  return [
    "*Análise sobre a Meta:*",
    `• Meta estimada: ${formatNumber(goalCalories)} kcal`,
    `• ${balanceLabel}: ${formatNumber(Math.abs(diff))} kcal ${pctStr} ${balanceDetail}`,
  ];
}
