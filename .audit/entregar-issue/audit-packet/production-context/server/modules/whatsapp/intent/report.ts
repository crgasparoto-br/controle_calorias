import type { MealDraftItem } from "../../../nutritionEngine";
import { sumMealItems, toMealItemInputs } from "./mealItemHelpers";
import type { NutritionTotals } from "./types";
import { formatWhatsAppMacroLine } from "../replyTemplates";

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
    lines.push(`• *${label}*`);
    lines.push(formatWhatsAppMacroLine(totals));
  }
  return lines;
}
