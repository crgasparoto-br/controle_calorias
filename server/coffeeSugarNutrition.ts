import { roundNutritionValue } from "../shared/mealTotals";
import { isCoffeeWithAddedSugar } from "./foodSemanticCompatibility";
import { formatFoodNameTitleCase, normalizeForMatching } from "./mealTextParsing";
import type { LlmItem, MealDraftItem } from "./nutritionEngineTypes";

const COFFEE_CALORIES_PER_CUP = 2;
const COFFEE_ML_PER_CUP = 50;
const SUGAR_CALORIES_PER_GRAM = 4;

type ExplicitSugarQuantity = {
  quantity: number;
  unit: "g";
  grams: number;
  sourceUnit: string;
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
    /\b(\d+(?:[,.]\d+)?)\s*(g|gramas?|kg|quilos?|mg|miligramas?|colheres? de cha|colheres? de sopa|saches?|pacotes?)\s+(?:de\s+)?acucar\b/,
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

function extractCoffeeCups(value: string) {
  const normalized = normalizeForMatching(value);
  const beforeCoffee = normalized.match(/\b(\d+(?:[,.]\d+)?)\s*xicaras?\s+(?:de\s+)?cafe\b/);
  const afterCoffee = normalized.match(/\bcafe\b[^,;]*?\b(\d+(?:[,.]\d+)?)\s*xicaras?\b/);
  const match = beforeCoffee ?? afterCoffee;
  return match ? parseLocalizedNumber(match[1]) ?? 1 : 1;
}

function isUsableSweetenedCoffeeNutrition(item: LlmItem) {
  return item.estimatedCalories > COFFEE_CALORIES_PER_CUP
    || item.estimatedMacros.carbs > 0
    || item.estimatedMacros.protein > 0
    || item.estimatedMacros.fat > 0;
}

export function hasUsableSweetenedCoffeeInference(items: LlmItem[] | undefined) {
  return Boolean(items?.some(item => {
    const name = normalizeForMatching(item.foodName);
    return /\bcafe\b/.test(name) && isUsableSweetenedCoffeeNutrition(item);
  }));
}

export function buildCoffeeWithExplicitSugarItem(sourceText: string): MealDraftItem | null {
  if (!isCoffeeWithAddedSugar(sourceText)) return null;
  const sugar = extractExplicitSugarQuantity(sourceText);
  if (!sugar) return null;

  const cups = extractCoffeeCups(sourceText);
  const coffeeVolumeMl = roundNutritionValue(cups * COFFEE_ML_PER_CUP);
  const cupLabel = cups === 1 ? "xícara" : "xícaras";
  const foodName = formatFoodNameTitleCase(
    sourceText
      .replace(/^.*?\b(\d+(?:[,.]\d+)?)\s*xícaras?\s+de\s+/iu, "")
      .trim() || "Café com açúcar",
  );

  return {
    foodName,
    canonicalName: "Café com açúcar",
    quantity: cups,
    unit: "xícara",
    portionText: `${cups} ${cupLabel} com ${sugar.grams} g de açúcar`,
    servings: Math.max(cups, 0.1),
    estimatedGrams: roundNutritionValue(coffeeVolumeMl + sugar.grams),
    calories: roundNutritionValue(cups * COFFEE_CALORIES_PER_CUP + sugar.grams * SUGAR_CALORIES_PER_GRAM),
    protein: 0,
    carbs: sugar.grams,
    fat: 0,
    confidence: 0.72,
    source: "heuristic",
  };
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
  return `${originalText.trim()} (${quantityText} de açúcar)`;
}
