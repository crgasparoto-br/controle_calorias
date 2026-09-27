import { roundNutritionValue } from "../shared/mealTotals";
import type { MealDraftItem } from "./nutritionEngineTypes";

function sameNutritionValue(actual: number, expected: number) {
  return Math.abs(actual - expected) <= 0.01;
}

/**
 * The visual/text inference contract uses this profile as a placeholder when
 * it could not ground an item's nutrition. It is not evidence that the food
 * really has these values, even when the item carries a non-zero confidence.
 */
export function isGenericNutritionPlaceholder(item: {
  estimatedGrams: number;
  estimatedCalories: number;
  estimatedMacros: {
    protein: number;
    carbs: number;
    fat: number;
  };
}) {
  const scale = item.estimatedGrams > 0 ? item.estimatedGrams / 100 : 1;
  const matches = (
    calories: number,
    protein: number,
    carbs: number,
    fat: number,
  ) => sameNutritionValue(item.estimatedCalories, calories)
    && sameNutritionValue(item.estimatedMacros.protein, protein)
    && sameNutritionValue(item.estimatedMacros.carbs, carbs)
    && sameNutritionValue(item.estimatedMacros.fat, fat);

  return matches(150, 6, 15, 5)
    || matches(150 * scale, 6 * scale, 15 * scale, 5 * scale);
}

export function isGenericNutritionFallbackItem(item: MealDraftItem) {
  if (item.source !== "heuristic" || item.estimatedGrams <= 0) return false;

  const factor = item.estimatedGrams / 100;
  return sameNutritionValue(item.calories, roundNutritionValue(150 * factor))
    && sameNutritionValue(item.protein, roundNutritionValue(6 * factor))
    && sameNutritionValue(item.carbs, roundNutritionValue(15 * factor))
    && sameNutritionValue(item.fat, roundNutritionValue(5 * factor));
}
