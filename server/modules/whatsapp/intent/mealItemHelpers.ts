import { roundNutritionValue } from "../../../../shared/mealTotals";
import { normalizeMeasurementUnit } from "../../../../shared/measurementUnits";
import { getCatalogCache } from "../../../catalogRuntime";
import type { MealItemInput } from "../../meals/schemas";
import type { MealDraftItem } from "../../../nutritionEngine";
import { findCatalogFood } from "./catalogLookup";
import { endOfZonedDay, startOfZonedDay } from "./dateTime";
import { formatNumber, normalizeIntentText } from "./textUtils";
import type { NutritionTotals, QuantityCorrectionIntent } from "./types";
import { formatMealItemTargetOptions, resolveMealItemTarget, type MealItemTargetMatch } from "../mealItemTargetMatcher";

export const MIN_FOOD_GRAMS = 1;
const UNSWEETENED_COFFEE_CUP_ML = 50;
const UNSWEETENED_COFFEE_CALORIES_PER_CUP = 2;
const COFFEE_CAPSULE_ML = 40;
const COFFEE_CAPSULE_CALORIES_PER_CAPSULE = 2;
const HEURISTIC_REPLACEMENT_NUTRITION_PER_100G = {
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

type TargetMealItemResolution = MealItemTargetMatch<MealItemInput>;

export function normalizeAdditionUnit(unit: string | null) {
  return unit ? normalizeMeasurementUnit(unit) : "g";
}

export function quantityToEstimatedGrams(quantity: number, unit: string) {
  switch (normalizeAdditionUnit(unit)) {
    case "kg":
      return quantity * 1000;
    case "mg":
      return quantity / 1000;
    case "g":
    case "ml":
      return quantity;
    case "l":
      return quantity * 1000;
    default:
      return quantity;
  }
}

function deriveQuantityFromPortionText(portionText: string) {
  const match = portionText.trim().match(/^(\d+(?:[,.]\d+)?)/u);
  if (!match) {
    return null;
  }

  const value = Number(match[1].replace(",", "."));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function deriveUnitFromPortionText(portionText: string) {
  const normalized = portionText
    .trim()
    .replace(/^\d+(?:[,.]\d+)?\s*/u, "")
    .trim();

  return normalized || "porção";
}

export function toMealItemInput(item: MealDraftItem): MealItemInput {
  const quantityUnit = item as MealDraftItem & Partial<Pick<MealItemInput, "quantity" | "unit" | "brand">>;

  return {
    ...item,
    ...(quantityUnit.brand ? { brand: quantityUnit.brand } : {}),
    quantity: quantityUnit.quantity ?? deriveQuantityFromPortionText(item.portionText) ?? item.servings,
    unit: quantityUnit.unit?.trim() || deriveUnitFromPortionText(item.portionText),
  };
}

export function toMealItemInputs(items: MealDraftItem[] | undefined): MealItemInput[] {
  return (items ?? []).map(toMealItemInput);
}

export function scaleMealItem(item: MealItemInput, nextGrams: number): MealItemInput {
  const previousGrams = Number(item.estimatedGrams || 0);
  const ratio = previousGrams > 0 ? nextGrams / previousGrams : 1;
  return {
    ...item,
    estimatedGrams: nextGrams,
    portionText: `${formatNumber(nextGrams)} g`,
    quantity: nextGrams,
    unit: "g",
    servings: Math.max(Number(item.servings || 1) * ratio, 0.1),
    calories: Number((Number(item.calories || 0) * ratio).toFixed(1)),
    protein: Number((Number(item.protein || 0) * ratio).toFixed(1)),
    carbs: Number((Number(item.carbs || 0) * ratio).toFixed(1)),
    fat: Number((Number(item.fat || 0) * ratio).toFixed(1)),
  };
}

export function scaleMealItemQuantity(item: MealItemInput, nextQuantity: number, nextUnit: string): MealItemInput {
  const normalizedUnit = normalizeAdditionUnit(nextUnit);
  const nextEstimatedGrams = quantityToEstimatedGrams(nextQuantity, normalizedUnit);
  return {
    ...scaleMealItem(item, nextEstimatedGrams),
    quantity: nextQuantity,
    unit: normalizedUnit,
    portionText: `${formatNumber(nextQuantity)} ${normalizedUnit}`,
  };
}

function buildCatalogMealItem(item: MealItemInput, nextFoodName: string, nextGrams: number, catalogFood: ReturnType<typeof getCatalogCache>[number]): MealItemInput {
  const factor = nextGrams / catalogFood.gramsPerServing;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: catalogFood.name,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(nextGrams / catalogFood.gramsPerServing, 0.1),
    calories: roundNutritionValue(catalogFood.calories * factor),
    protein: roundNutritionValue(catalogFood.protein * factor),
    carbs: roundNutritionValue(catalogFood.carbs * factor),
    fat: roundNutritionValue(catalogFood.fat * factor),
    confidence: Math.min(Math.max(Number(item.confidence || 0.8), 0.1), 0.95),
    source: "catalog",
  };
}

function buildHeuristicReplacementItem(item: MealItemInput, nextFoodName: string, nextGrams: number): MealItemInput {
  const factor = nextGrams / 100;
  return {
    ...item,
    foodName: nextFoodName,
    canonicalName: nextFoodName,
    estimatedGrams: nextGrams,
    portionText: item.portionText || `${formatNumber(nextGrams)} g`,
    quantity: item.quantity ?? nextGrams,
    unit: item.unit ?? "g",
    servings: Math.max(Number(item.servings || 1), 0.1),
    calories: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.calories * factor),
    protein: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.protein * factor),
    carbs: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.carbs * factor),
    fat: roundNutritionValue(HEURISTIC_REPLACEMENT_NUTRITION_PER_100G.fat * factor),
    confidence: Math.min(Number(item.confidence || 0.8), 0.7),
    source: "heuristic",
  };
}

export function replaceMealItemFood(item: MealItemInput, nextFoodName: string): MealItemInput {
  const nextGrams = Math.max(Number(item.estimatedGrams || 0), MIN_FOOD_GRAMS);
  const catalogFood = findCatalogFood(nextFoodName);
  if (catalogFood) {
    return buildCatalogMealItem(item, nextFoodName, nextGrams, catalogFood);
  }

  return buildHeuristicReplacementItem(item, nextFoodName, nextGrams);
}

export function buildFoodAdditionItem(foodName: string, quantity: number, unit = "g"): MealItemInput {
  const normalizedUnit = normalizeAdditionUnit(unit);
  const estimatedGrams = quantityToEstimatedGrams(quantity, normalizedUnit);
  const catalogFood = findCatalogFood(foodName);
  const item = catalogFood
    ? buildCatalogMealItem({ quantity, unit: normalizedUnit } as MealItemInput, foodName, estimatedGrams, catalogFood)
    : buildHeuristicReplacementItem({ quantity, unit: normalizedUnit } as MealItemInput, foodName, estimatedGrams);

  return {
    ...item,
    quantity,
    unit: normalizedUnit,
    portionText: `${formatNumber(quantity)} ${normalizedUnit}`,
  };
}

export function buildUnsweetenedCoffeeItem(cups: number): MealItemInput {
  const volumeMl = Math.round(cups * UNSWEETENED_COFFEE_CUP_ML);
  const calories = Math.round(cups * UNSWEETENED_COFFEE_CALORIES_PER_CUP);
  const cupLabel = cups === 1 ? "xícara" : "xícaras";

  return {
    foodName: "Café sem açúcar",
    canonicalName: "Café preto sem açúcar",
    quantity: cups,
    unit: "xícara",
    portionText: `${formatNumber(cups)} ${cupLabel} (${formatNumber(volumeMl)} ml)`,
    servings: Math.max(cups, 0.1),
    estimatedGrams: volumeMl,
    calories,
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.8,
    source: "heuristic",
  };
}

export function buildCoffeeLorCapsuleItem(quantity: number): MealItemInput {
  const capsuleLabel = quantity === 1 ? "cápsula" : "cápsulas";
  return {
    foodName: "Café em cápsula L'Or",
    canonicalName: "Café em cápsula L'Or",
    quantity,
    unit: "unidade",
    portionText: `${formatNumber(quantity)} ${capsuleLabel}`,
    servings: Math.max(quantity, 0.1),
    estimatedGrams: Math.round(quantity * COFFEE_CAPSULE_ML),
    calories: Math.round(quantity * COFFEE_CAPSULE_CALORIES_PER_CAPSULE),
    protein: 0,
    carbs: 0,
    fat: 0,
    confidence: 0.85,
    source: "heuristic",
  };
}

export function sumMealItems(items: MealItemInput[]): NutritionTotals {
  return items.reduce(
    (acc, item) => ({
      calories: acc.calories + Number(item.calories || 0),
      protein: acc.protein + Number(item.protein || 0),
      carbs: acc.carbs + Number(item.carbs || 0),
      fat: acc.fat + Number(item.fat || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function formatTotalsLine(totals: NutritionTotals) {
  return `${formatNumber(totals.calories)} kcal | Prot. ${formatNumber(totals.protein)} g | Carb. ${formatNumber(totals.carbs)} g | Gord. ${formatNumber(totals.fat)} g`;
}

export function formatAddedItemsList(items: MealItemInput[]) {
  const labels = items.map(item => `${item.portionText} de ${item.foodName}`);
  if (labels.length <= 1) {
    return labels[0] ?? "";
  }

  return `${labels.slice(0, -1).join(", ")} e ${labels[labels.length - 1]}`;
}

export function resolveTargetMealItem(items: MealItemInput[], targetFood: string | null): TargetMealItemResolution {
  return resolveMealItemTarget(items, targetFood);
}

export function formatTargetMealItemOptions(candidates: Extract<TargetMealItemResolution, { kind: "ambiguous" }>["candidates"]) {
  return formatMealItemTargetOptions(candidates);
}

export function findTargetMealItem(items: MealItemInput[], targetFood: string | null) {
  const target = resolveTargetMealItem(items, targetFood);
  return target.kind === "matched" ? { item: target.item, index: target.index } : null;
}

export function findMealByLabel<T extends { mealLabel: string; occurredAt: number | string | Date }>(meals: T[], mealLabel: string, referenceDate: Date) {
  const normalizedLabel = normalizeIntentText(mealLabel);
  const dayStart = startOfZonedDay(referenceDate).getTime();
  const dayEnd = endOfZonedDay(referenceDate).getTime();
  const matches = meals.filter(meal => {
    const candidate = normalizeIntentText(meal.mealLabel);
    return candidate === normalizedLabel || candidate.includes(normalizedLabel) || normalizedLabel.includes(candidate);
  });

  return matches.find(meal => {
    const occurredAt = new Date(meal.occurredAt).getTime();
    return occurredAt >= dayStart && occurredAt <= dayEnd;
  }) ?? matches[0] ?? null;
}

export function parseItemQuantity(item: MealItemInput) {
  if (item.quantity && item.unit) {
    return {
      quantity: item.quantity,
      unit: normalizeAdditionUnit(item.unit),
    };
  }

  const match = item.portionText?.match(/(\d+(?:[,.]\d+)?)\s*(g|gramas?|ml|mililitros?|l|litros?)\b/i);
  if (!match) {
    return null;
  }

  return {
    quantity: Number(match[1].replace(",", ".")),
    unit: normalizeAdditionUnit(normalizeIntentText(match[2])),
  };
}

function itemMatchesQuantity(item: MealItemInput, quantity: number, unit: string | null) {
  const normalizedUnit = normalizeAdditionUnit(unit);
  const parsedPortion = parseItemQuantity(item);
  if (parsedPortion?.quantity === quantity && (!unit || parsedPortion.unit === normalizedUnit)) {
    return true;
  }

  const estimatedTarget = quantityToEstimatedGrams(quantity, normalizedUnit);
  return Number(item.estimatedGrams || 0) === estimatedTarget;
}

export function findQuantityCorrectionTargets(items: MealItemInput[], correction: QuantityCorrectionIntent) {
  if (correction.previousQuantity) {
    return items
      .map((item, index) => ({ item, index }))
      .filter(candidate => itemMatchesQuantity(candidate.item, correction.previousQuantity!, correction.previousUnit));
  }

  const lastItemIndex = items.length - 1;
  return lastItemIndex >= 0 ? [{ item: items[lastItemIndex], index: lastItemIndex }] : [];
}

export function formatCorrectionOptions(targets: Array<{ item: MealItemInput }>) {
  return targets
    .map((target, index) => `${index + 1}. ${target.item.foodName}`)
    .join(" ");
}
