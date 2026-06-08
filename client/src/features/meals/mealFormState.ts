import { toDateTimeLocalValue } from "@/lib/dateTime";
import { calculateMealTotals, roundNutritionValue } from "@/shared/mealTotals";
import { normalizeMeasurementUnit } from "@shared/measurementUnits";
import type { ManualMealState, MealItemState } from "./types";

const WEIGHT_OR_VOLUME_UNITS = new Set(["g", "ml"]);

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function normalizeUnitInput(value: string) {
  return normalizeMeasurementUnit(value.replace(/^\d+(?:[,.]\d+)?\s*/u, ""));
}

function resolveSafeQuantity(value: number) {
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function scaleNutritionValue(value: number, factor: number) {
  return roundNutritionValue(Number(value || 0) * factor);
}

export function recalculateMealItemQuantityUnit(
  item: MealItemState,
  nextQuantity: number,
  nextUnit: string,
): MealItemState {
  const quantity = resolveSafeQuantity(nextQuantity);
  const unit = normalizeUnitInput(nextUnit) || "porção";
  const portionText = `${formatQuantity(quantity)} ${unit}`;

  if (!WEIGHT_OR_VOLUME_UNITS.has(unit)) {
    return {
      ...item,
      quantity,
      unit,
      portionText,
    };
  }

  const previousGrams = Number(item.estimatedGrams || 0);
  const nextEstimatedGrams = roundNutritionValue(quantity);
  const factor = previousGrams > 0 ? nextEstimatedGrams / previousGrams : 1;

  return {
    ...item,
    quantity,
    unit,
    portionText,
    servings: previousGrams > 0
      ? roundNutritionValue(Number(item.servings || 1) * factor)
      : item.servings,
    estimatedGrams: nextEstimatedGrams,
    calories: scaleNutritionValue(item.calories, factor),
    protein: scaleNutritionValue(item.protein, factor),
    carbs: scaleNutritionValue(item.carbs, factor),
    fat: scaleNutritionValue(item.fat, factor),
  };
}

export function createEmptyItem(): MealItemState {
  return {
    foodName: "",
    canonicalName: "",
    portionText: "1 porção",
    quantity: 1,
    unit: "porção",
    servings: 1,
    estimatedGrams: 0,
    calories: 0,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 1,
    source: "heuristic",
  };
}

export function createManualMealState(
  mealLabel = "almoço",
  occurredAt = toDateTimeLocalValue(),
): ManualMealState {
  return {
    mealId: undefined,
    mealLabel,
    occurredAt,
    notes: "",
    items: [createEmptyItem()],
  };
}

export async function fileToBase64(file: File) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function sumItems(items: MealItemState[]) {
  return calculateMealTotals(items);
}
