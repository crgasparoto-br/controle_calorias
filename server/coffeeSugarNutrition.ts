import { roundNutritionValue } from "../shared/mealTotals";
import { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";
import { isCoffeeWithAddedSugar } from "./foodSemanticCompatibility";
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
  if (/^(?:g|grama|gramas)$/.test(normalized)) return quantity;
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
    /\b(\d+(?:[,.]\d+)?)\s*(g|gramas?|kg|quilos?|mg|miligramas?|colher(?:es)? de cha|colher(?:es)? de sopa|saches?|pacotes?)\s+(?:de\s+)?acucar\b/,
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

export function hasUsableSweetenedCoffeeInference(items: LlmItem[] | undefined) {
  return Boolean(items?.some(item => {
    const name = normalizeForMatching(item.foodName);
    return /\bcafe\b/.test(name) && isUsableSweetenedCoffeeNutrition(item);
  }));
}

function isCoffeeDraftItem(item: MealDraftItem) {
  return /\bcafe\b/.test(
    normalizeForMatching(`${item.foodName} ${item.canonicalName}`),
  );
}

function isExplicitlyUnsweetenedCoffee(item: MealDraftItem) {
  const identity = normalizeForMatching(`${item.foodName} ${item.canonicalName}`);
  return /\bcafe\b/.test(identity)
    && (
      /\bsem\s+(?:adicao\s+de\s+)?acucar\b/.test(identity)
      || /\b(?:puro|pura|preto|preta|natural)\b/.test(identity)
    );
}

function isStandaloneSugarItem(item: MealDraftItem) {
  return [item.foodName, item.canonicalName].some(value => {
    const normalized = normalizeForMatching(value).trim();
    return /^(?:\d+(?:[,.]\d+)?\s*(?:g|gramas?)\s+(?:de\s+)?)?acucar(?:\s+(?:refinado|cristal|mascavo|demerara))?$/.test(normalized);
  });
}

function hasCompanionFoodSegments(sourceText: string) {
  return splitFoodTextSegments(sourceText).length > 1;
}

function createCoffeeWithExplicitSugarItem(sourceText: string): MealDraftItem | null {
  if (!isCoffeeWithAddedSugar(sourceText)) return null;
  const sugar = extractExplicitSugarQuantity(sourceText);
  if (!sugar) return null;

  const coffee = extractCoffeeServingQuantity(sourceText);
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

function findExplicitSugarCoffeeTargetIndex(items: MealDraftItem[]) {
  const coffeeIndexes = items
    .map((item, index) => isCoffeeDraftItem(item) ? index : -1)
    .filter(index => index >= 0);
  const explicitlySweetened = coffeeIndexes.filter(index =>
    isCoffeeWithAddedSugar(`${items[index].foodName} ${items[index].canonicalName}`)
  );
  if (explicitlySweetened.length === 1) return explicitlySweetened[0];

  const notExplicitlyUnsweetened = coffeeIndexes.filter(index =>
    !isExplicitlyUnsweetenedCoffee(items[index])
  );
  if (notExplicitlyUnsweetened.length === 1) return notExplicitlyUnsweetened[0];
  return -1;
}

function mergeExplicitSugarCoffeeItem(
  items: MealDraftItem[],
  sourceText: string,
) {
  const explicitItem = createCoffeeWithExplicitSugarItem(sourceText);
  if (!explicitItem || !hasCompanionFoodSegments(sourceText)) return null;

  const targetIndex = findExplicitSugarCoffeeTargetIndex(items);
  const merged = items.flatMap((item, index) => {
    if (index === targetIndex) return [explicitItem];
    if (isStandaloneSugarItem(item)) return [];
    return [item];
  });

  return targetIndex >= 0 ? merged : [...merged, explicitItem];
}

export function normalizeSweetenedCoffeeDraftItems(
  items: MealDraftItem[],
  sourceText: string,
) {
  if (!isCoffeeWithAddedSugar(sourceText)) return items;

  const mergedExplicitSugar = mergeExplicitSugarCoffeeItem(items, sourceText);
  if (mergedExplicitSugar) return mergedExplicitSugar;

  const coffeeItems = items.filter(isCoffeeDraftItem);
  const sourceCanQualifyGenericCoffee = coffeeItems.length === 1;

  return items.map(item => {
    if (!isCoffeeDraftItem(item)) return item;

    const identity = `${item.foodName} ${item.canonicalName}`;
    const itemIsExplicitlySweetened = isCoffeeWithAddedSugar(identity);
    if (!itemIsExplicitlySweetened && !sourceCanQualifyGenericCoffee) return item;

    return {
      ...item,
      foodName: "Café com açúcar",
      canonicalName: "Café com açúcar",
    };
  });
}

export function buildCoffeeWithExplicitSugarItem(sourceText: string): MealDraftItem | null {
  const explicitItem = createCoffeeWithExplicitSugarItem(sourceText);
  return explicitItem && !hasCompanionFoodSegments(sourceText)
    ? explicitItem
    : null;
}

export function shouldRequestSugarQuantity(sourceText: string, inferredItems: LlmItem[] | undefined) {
  return isCoffeeWithAddedSugar(sourceText)
    && !extractExplicitSugarQuantity(sourceText)
    && !hasUsableSweetenedCoffeeInference(inferredItems);
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
