import { roundNutritionValue } from "../shared/mealTotals";
import type { MealDraftItem } from "./nutritionEngineTypes";

function sameNutritionValue(actual: number, expected: number) {
  return Math.abs(actual - expected) <= 0.01;
}

export function isGenericNutritionFallbackItem(item: MealDraftItem) {
  if (item.source !== "heuristic" || item.estimatedGrams <= 0) return false;

  const factor = item.estimatedGrams / 100;
  return sameNutritionValue(item.calories, roundNutritionValue(150 * factor))
    && sameNutritionValue(item.protein, roundNutritionValue(6 * factor))
    && sameNutritionValue(item.carbs, roundNutritionValue(15 * factor))
    && sameNutritionValue(item.fat, roundNutritionValue(5 * factor));
}
