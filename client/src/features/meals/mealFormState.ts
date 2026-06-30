import { toDateTimeLocalValue } from "@/lib/dateTime";
import { calculateMealTotals, roundNutritionValue } from "@/shared/mealTotals";
import { normalizeMeasurementUnit } from "@shared/measurementUnits";
import type { ManualMealState, MealItemState } from "./types";

const WEIGHT_OR_VOLUME_UNITS = new Set(["g", "ml"]);
const MAX_QUANTITY = 5000;
const MAX_SERVINGS = 20;
const MAX_CALORIES = 10000;
const MAX_MACRO_GRAMS = 1000;

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

function normalizeUnitInput(value: string) {
  return normalizeMeasurementUnit(value.replace(/^\d+(?:[,.]\d+)?\s*/u, ""));
}

function resolveSafeQuantity(value: number) {
  return Number.isFinite(value) && value > 0 ? clampNumber(value, 0.1, MAX_QUANTITY) : 1;
}

function scaleNutritionValue(value: number, factor: number, max = MAX_MACRO_GRAMS) {
  return clampNumber(roundNutritionValue(Number(value || 0) * factor), 0, max);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function parseNumberForSubmit(value: unknown, fallback: number) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : fallback;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;

    const normalized = trimmed.includes(",")
      ? trimmed.replace(/\./g, "").replace(",", ".")
      : trimmed;
    const numberValue = Number(normalized);
    return Number.isFinite(numberValue) ? numberValue : fallback;
  }

  return fallback;
}

function parsePositiveNumberForSubmit(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY) {
  const numberValue = parseNumberForSubmit(value, fallback);
  return numberValue > 0 ? clampNumber(numberValue, 0.1, max) : fallback;
}

function parseNonNegativeNumberForSubmit(value: unknown, fallback = 0, max = Number.POSITIVE_INFINITY) {
  const numberValue = parseNumberForSubmit(value, fallback);
  return numberValue >= 0 ? clampNumber(numberValue, 0, max) : fallback;
}

export function normalizeMealItemForSubmit(item: MealItemState): MealItemState {
  const foodName = item.foodName.trim();
  const canonicalName = item.canonicalName.trim() || foodName;
  const portionText = item.portionText.trim() || "1 porção";
  const servings = parsePositiveNumberForSubmit(item.servings, 1, MAX_SERVINGS);

  return {
    ...item,
    foodName,
    canonicalName,
    portionText,
    portionQuantity: item.portionQuantity === undefined
      ? undefined
      : parsePositiveNumberForSubmit(item.portionQuantity, servings, 100),
    quantity: item.quantity === undefined
      ? undefined
      : parsePositiveNumberForSubmit(item.quantity, servings, MAX_QUANTITY),
    servings,
    estimatedGrams: parseNonNegativeNumberForSubmit(item.estimatedGrams, 0, MAX_QUANTITY),
    calories: parseNonNegativeNumberForSubmit(item.calories, 0, MAX_CALORIES),
    protein: parseNonNegativeNumberForSubmit(item.protein, 0, MAX_MACRO_GRAMS),
    carbs: parseNonNegativeNumberForSubmit(item.carbs, 0, MAX_MACRO_GRAMS),
    fat: parseNonNegativeNumberForSubmit(item.fat, 0, MAX_MACRO_GRAMS),
    confidence: parseNonNegativeNumberForSubmit(item.confidence, 1, 1),
  };
}

export function normalizeMealItemsForSubmit(items: MealItemState[]) {
  return items
    .map(normalizeMealItemForSubmit)
    .filter(item => item.foodName);
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
      servings: clampNumber(Number(item.servings || 1), 0.1, MAX_SERVINGS),
      estimatedGrams: clampNumber(Number(item.estimatedGrams || 0), 0, MAX_QUANTITY),
      calories: clampNumber(Number(item.calories || 0), 0, MAX_CALORIES),
      protein: clampNumber(Number(item.protein || 0), 0, MAX_MACRO_GRAMS),
      carbs: clampNumber(Number(item.carbs || 0), 0, MAX_MACRO_GRAMS),
      fat: clampNumber(Number(item.fat || 0), 0, MAX_MACRO_GRAMS),
    };
  }

  const previousGrams = Number(item.estimatedGrams || 0);
  const nextEstimatedGrams = clampNumber(roundNutritionValue(quantity), 0, MAX_QUANTITY);
  const factor = previousGrams > 0 ? nextEstimatedGrams / previousGrams : 1;

  return {
    ...item,
    quantity,
    unit,
    portionText,
    servings: previousGrams > 0
      ? clampNumber(roundNutritionValue(Number(item.servings || 1) * factor), 0.1, MAX_SERVINGS)
      : clampNumber(Number(item.servings || 1), 0.1, MAX_SERVINGS),
    estimatedGrams: nextEstimatedGrams,
    calories: scaleNutritionValue(item.calories, factor, MAX_CALORIES),
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
