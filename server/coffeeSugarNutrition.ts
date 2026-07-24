import { roundNutritionValue } from "../shared/mealTotals";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import {
  hasCaloricCoffeeComplement,
  isCoffeeWithAddedSugar,
} from "./foodSemanticCompatibility";
import { normalizeForMatching, splitFoodTextSegments } from "./mealTextParsing";
import type { LlmItem, MealDraftItem } from "./nutritionEngineTypes";

const UNSWEETENED_COFFEE_REFERENCE = FOOD_CATALOG_REFERENCE.find(
  food => food.slug === "cafe-sem-acucar",
);

if (!UNSWEETENED_COFFEE_REFERENCE) {
  throw new Error("A referência canônica de café sem açúcar não está disponível.");
}

const COFFEE_CALORIES_PER_CUP = UNSWEETENED_COFFEE_REFERENCE.calories;
const COFFEE_ML_PER_CUP = UNSWEETENED_COFFEE_REFERENCE.gramsPerServing;
const SUGAR_CALORIES_PER_GRAM = 4;

type ExplicitSugarQuantity = {
  quantity: number;
  unit: "g";
  grams: number;
  sourceUnit: string;
};

export type CoffeeServingQuantity = {
  quantity: number;
  unit: "xícara" | "ml" | "l";
  estimatedMl: number;
  cupsEquivalent: number;
};

function parseLocalizedNumber(value: string) {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function sugarUnitToGrams(quantity: number, unit: string) {
  const normalized = normalizeForMatching(unit).trim();
  if (/^(?:g|gr|grama|gramas)$/.test(normalized)) return quantity;
  if (/^(?:kg|quilo|quilos)$/.test(normalized)) return quantity * 1000;
  if (/^(?:mg|miligrama|miligramas)$/.test(normalized)) return quantity / 1000;
  if (/^(?:colher de cha|colheres de cha)$/.test(normalized)) return quantity * 4;
  if (/^(?:colher de sopa|colheres de sopa)$/.test(normalized)) return quantity * 12;
  if (/^(?:sache|saches|pacote|pacotes)$/.test(normalized)) return quantity * 5;
  return null;
}

export function extractExplicitSugarQuantity(value: string): ExplicitSugarQuantity | null {
  const normalized = normalizeForMatching(value);
  const match = normalized.match(
    /\b(\d+(?:[,.]\d+)?)\s*(g|gr|gramas?|kg|quilos?|mg|miligramas?|colher(?:es)? de cha|colher(?:es)? de sopa|saches?|pacotes?)\s+(?:de\s+)?acucar\b/,
  );
  if (!match) return null;

  const quantity = parseLocalizedNumber(match[1]);
  if (!quantity) return null;
  const grams = sugarUnitToGrams(quantity, match[2]);
  if (!grams || grams <= 0) return null;

  return {
    quantity: roundNutritionValue(quantity),
    unit: "g",
    grams: roundNutritionValue(grams),
    sourceUnit: match[2],
  };
}

function normalizeCoffeeServing(
  quantity: number,
  rawUnit: string,
): CoffeeServingQuantity | null {
  const unit = normalizeForMatching(rawUnit).trim();
  if (/^xicaras?$/.test(unit)) {
    return {
      quantity: roundNutritionValue(quantity),
      unit: "xícara",
      estimatedMl: roundNutritionValue(quantity * COFFEE_ML_PER_CUP),
      cupsEquivalent: roundNutritionValue(quantity),
    };
  }
  if (/^(?:ml|mililitros?)$/.test(unit)) {
    return {
      quantity: roundNutritionValue(quantity),
      unit: "ml",
      estimatedMl: roundNutritionValue(quantity),
      cupsEquivalent: roundNutritionValue(quantity / COFFEE_ML_PER_CUP),
    };
  }
  if (/^(?:l|litros?)$/.test(unit)) {
    const estimatedMl = quantity * 1000;
    return {
      quantity: roundNutritionValue(quantity),
      unit: "l",
      estimatedMl: roundNutritionValue(estimatedMl),
      cupsEquivalent: roundNutritionValue(estimatedMl / COFFEE_ML_PER_CUP),
    };
  }
  return null;
}

export function extractCoffeeServingQuantity(value: string): CoffeeServingQuantity {
  const normalized = normalizeForMatching(value);
  const unitPattern = "xicaras?|ml|mililitros?|l|litros?";
  const beforeCoffee = normalized.match(
    new RegExp(`\\b(\\d+(?:[,.]\\d+)?)\\s*(${unitPattern})\\s+(?:de\\s+)?cafe\\b`),
  );
  const afterCoffee = normalized.match(
    new RegExp(`\\bcafe\\b[^,;]*?\\b(\\d+(?:[,.]\\d+)?)\\s*(${unitPattern})\\b`),
  );
  const match = beforeCoffee ?? afterCoffee;
  const quantity = match ? parseLocalizedNumber(match[1]) : null;
  const parsed = quantity && match ? normalizeCoffeeServing(quantity, match[2]) : null;
  return parsed ?? {
    quantity: 1,
    unit: "xícara",
    estimatedMl: COFFEE_ML_PER_CUP,
    cupsEquivalent: 1,
  };
}

function isUsableSweetenedCoffeeNutrition(item: LlmItem) {
  return item.estimatedCalories > COFFEE_CALORIES_PER_CUP
    && item.estimatedMacros.carbs > 0;
}

function isCoffeeIdentity(value: string) {
  return /\bcafe\b/.test(normalizeForMatching(value));
}

function isExplicitlyUnsweetenedCoffeeIdentity(value: string) {
  const identity = normalizeForMatching(value);
  return /\bcafe\b/.test(identity)
    && (
      /\bsem\s+(?:adicao\s+de\s+)?acucar\b/.test(identity)
      || /\b(?:puro|pura|preto|preta|natural)\b/.test(identity)
    );
}

function isGenericCoffeeIdentity(value: string) {
  return isCoffeeIdentity(value)
    && !isCoffeeWithAddedSugar(value)
    && !isExplicitlyUnsweetenedCoffeeIdentity(value)
    && !hasCaloricCoffeeComplement(value);
}

function getCoffeeSourceSegments(sourceText: string) {
  return splitFoodTextSegments(sourceText).filter(isCoffeeIdentity);
}

function getSweetenedCoffeeSourceSegments(sourceText: string) {
  return getCoffeeSourceSegments(sourceText).filter(isCoffeeWithAddedSugar);
}

function getSweetenedCoffeeSegmentsWithExplicitSugar(sourceText: string) {
  return getSweetenedCoffeeSourceSegments(sourceText).flatMap(segment => {
    const sugar = extractExplicitSugarQuantity(segment);
    return sugar ? [{ segment, sugar }] : [];
  });
}

export function hasUsableSweetenedCoffeeInference(
  items: LlmItem[] | undefined,
  sourceText = "",
) {
  const usableCoffeeItems = items?.filter(item =>
    isCoffeeIdentity(item.foodName) && isUsableSweetenedCoffeeNutrition(item)
  ) ?? [];
  const sourceCoffeeSegments = getCoffeeSourceSegments(sourceText);
  const sweetenedSourceSegments = sourceCoffeeSegments.filter(isCoffeeWithAddedSugar);
  const explicitlySweetenedItems = usableCoffeeItems.filter(item =>
    isCoffeeWithAddedSugar(item.foodName)
  );

  if (
    sweetenedSourceSegments.length > 0
    && explicitlySweetenedItems.length === sweetenedSourceSegments.length
  ) {
    return true;
  }

  return sweetenedSourceSegments.length === 1
    && sourceCoffeeSegments.length === 1
    && usableCoffeeItems.length === 1
    && isGenericCoffeeIdentity(usableCoffeeItems[0].foodName);
}

function isCoffeeDraftItem(item: MealDraftItem) {
  return isCoffeeIdentity(`${item.foodName} ${item.canonicalName}`);
}

function isExplicitlyUnsweetenedCoffee(item: MealDraftItem) {
  return isExplicitlyUnsweetenedCoffeeIdentity(
    `${item.foodName} ${item.canonicalName}`,
  );
}

function isGenericCoffeeDraftItem(item: MealDraftItem) {
  return isGenericCoffeeIdentity(`${item.foodName} ${item.canonicalName}`);
}

function isStandaloneSugarItem(item: MealDraftItem) {
  return [item.foodName, item.canonicalName].some(value => {
    const normalized = normalizeForMatching(value).trim();
    return /^(?:\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?)\s+(?:de\s+)?)?acucar(?:\s+(?:refinado|cristal|mascavo|demerara))?$/.test(normalized);
  });
}

function hasCompanionFoodSegments(sourceText: string) {
  return splitFoodTextSegments(sourceText).length > 1;
}

function createCoffeeWithExplicitSugarItemFromSegment(
  segment: string,
  sugar: ExplicitSugarQuantity,
): MealDraftItem {
  const coffee = extractCoffeeServingQuantity(segment);
  const portionUnit = coffee.unit === "xícara" && coffee.quantity !== 1
    ? "xícaras"
    : coffee.unit;

  return {
    foodName: "Café com açúcar",
    canonicalName: "Café com açúcar",
    quantity: coffee.quantity,
    unit: coffee.unit,
    portionText: `${coffee.quantity} ${portionUnit} com ${sugar.grams} g de açúcar`,
    servings: Math.max(coffee.cupsEquivalent, 0.1),
    estimatedGrams: roundNutritionValue(coffee.estimatedMl + sugar.grams),
    calories: roundNutritionValue(
      coffee.cupsEquivalent * COFFEE_CALORIES_PER_CUP
      + sugar.grams * SUGAR_CALORIES_PER_GRAM,
    ),
    protein: 0,
    carbs: sugar.grams,
    fat: 0,
    confidence: 0.72,
    source: "heuristic",
  };
}

function createExplicitSugarCoffeeItems(sourceText: string) {
  return getSweetenedCoffeeSegmentsWithExplicitSugar(sourceText).map(({ segment, sugar }) =>
    createCoffeeWithExplicitSugarItemFromSegment(segment, sugar)
  );
}

function mergeExplicitSugarCoffeeItems(
  items: MealDraftItem[],
  sourceText: string,
) {
  const explicitItems = createExplicitSugarCoffeeItems(sourceText);
  if (!explicitItems.length || !hasCompanionFoodSegments(sourceText)) return null;

  const remaining = [...explicitItems];
  const merged = items.flatMap(item => {
    if (isStandaloneSugarItem(item)) return [];
    if (!remaining.length || !isCoffeeDraftItem(item)) return [item];

    const identity = `${item.foodName} ${item.canonicalName}`;
    if (isCoffeeWithAddedSugar(identity) || isGenericCoffeeDraftItem(item)) {
      return [remaining.shift()!];
    }
    return [item];
  });

  return [...merged, ...remaining];
}

export function normalizeSweetenedCoffeeDraftItems(
  items: MealDraftItem[],
  sourceText: string,
) {
  if (!isCoffeeWithAddedSugar(sourceText)) return items;

  const mergedExplicitSugar = mergeExplicitSugarCoffeeItems(items, sourceText);
  if (mergedExplicitSugar) return mergedExplicitSugar;

  const coffeeItems = items.filter(isCoffeeDraftItem);
  const sourceCoffeeSegments = getCoffeeSourceSegments(sourceText);
  const sourceCanQualifyGenericCoffee = sourceCoffeeSegments.length === 1
    && isCoffeeWithAddedSugar(sourceCoffeeSegments[0])
    && coffeeItems.length === 1
    && isGenericCoffeeDraftItem(coffeeItems[0]);

  return items.map(item => {
    if (!isCoffeeDraftItem(item)) return item;

    const identity = `${item.foodName} ${item.canonicalName}`;
    const itemIsExplicitlySweetened = isCoffeeWithAddedSugar(identity);
    if (
      !itemIsExplicitlySweetened
      && !(sourceCanQualifyGenericCoffee && isGenericCoffeeDraftItem(item))
    ) {
      return item;
    }

    return {
      ...item,
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
    };
  });
}

export function buildCoffeeWithExplicitSugarItem(sourceText: string): MealDraftItem | null {
  const explicitItems = createExplicitSugarCoffeeItems(sourceText);
  return explicitItems.length === 1 && !hasCompanionFoodSegments(sourceText)
    ? explicitItems[0]
    : null;
}

export function shouldRequestSugarQuantity(sourceText: string, inferredItems: LlmItem[] | undefined) {
  const sweetenedCoffeeSegments = getSweetenedCoffeeSourceSegments(sourceText);
  return sweetenedCoffeeSegments.length > 0
    && sweetenedCoffeeSegments.some(segment => !extractExplicitSugarQuantity(segment))
    && !hasUsableSweetenedCoffeeInference(inferredItems, sourceText);
}

export function appendSugarQuantityToCoffeeText(
  originalText: string,
  quantity: number,
  unit: string,
) {
  const normalizedUnit = normalizeForMatching(unit).trim();
  const quantityText = `${quantity} ${normalizedUnit}`;
  const segments = splitFoodTextSegments(originalText);
  let appended = false;
  const resolvedSegments = segments.map(segment => {
    if (
      !appended
      && isCoffeeWithAddedSugar(segment)
      && !extractExplicitSugarQuantity(segment)
    ) {
      appended = true;
      return `${segment.trim()} (${quantityText} de açúcar)`;
    }
    return segment;
  });

  return appended
    ? resolvedSegments.join(" e ")
    : `${originalText.trim()} (${quantityText} de açúcar)`;
}
