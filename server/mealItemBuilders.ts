import { roundNutritionValue } from "../shared/mealTotals";
import { detectKnownBrand, findCatalogFood, inferItemBrand } from "./catalogMatching";
import {
  buildPortionText,
  cleanFoodName,
  extractExplicitQuantities,
  normalizeText,
  normalizeUnit,
  parseFoodText,
  parseQuantityUnitFromPortionText,
} from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type { CatalogFood, LlmItem, MealDraftItem } from "./nutritionEngineTypes";

const GENERIC_ESTIMATED_FOOD_REFERENCE: CatalogFood = {
  slug: "generic-food-estimate",
  name: "Alimento estimado",
  aliases: [],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 150,
  protein: 6,
  carbs: 15,
  fat: 5,
};

const BAKERY_BREAD_REFERENCE: CatalogFood = {
  slug: "bakery-bread-estimate",
  name: "Pão de padaria",
  aliases: ["pão", "pão caseiro", "pão comum", "pão artesanal", "pão da fazenda"],
  servingLabel: "100 g",
  gramsPerServing: 100,
  calories: 300,
  protein: 8,
  carbs: 56,
  fat: 4,
};

export function clampConfidence(value: number) {
  return Math.min(Math.max(value || 0.6, 0.1), 0.99);
}

export function buildItemFromCatalog(food: CatalogFood, llmItem: LlmItem): MealDraftItem {
  const servings = Math.max(llmItem.servings || 1, 0.25);
  const estimatedGrams = llmItem.estimatedGrams > 0
    ? llmItem.estimatedGrams
    : food.gramsPerServing * servings;
  const factor = estimatedGrams / food.gramsPerServing;
  const portionText = llmItem.portionText || food.servingLabel;
  const quantityUnit = parseQuantityUnitFromPortionText(portionText) ?? {
    quantity: roundNutritionValue(estimatedGrams),
    unit: "g",
  };
  const llmQuantity = Number(llmItem.quantity);
  const quantity = Number.isFinite(llmQuantity) && llmQuantity > 0
    ? roundNutritionValue(llmQuantity)
    : quantityUnit.quantity;
  const unit = normalizeUnit(llmItem.unit || quantityUnit.unit);
  const brand = inferItemBrand(food, llmItem.foodName);
  const usedGenericForMentionedBrand = Boolean(brand && !food.brandName);

  return {
    foodName: llmItem.foodName,
    canonicalName: food.name,
    brand,
    portionText,
    quantity,
    unit,
    servings,
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(food.calories * factor),
    protein: roundNutritionValue(food.protein * factor),
    carbs: roundNutritionValue(food.carbs * factor),
    fat: roundNutritionValue(food.fat * factor),
    confidence: usedGenericForMentionedBrand ? Math.min(clampConfidence(llmItem.confidence), 0.62) : clampConfidence(llmItem.confidence),
    source: usedGenericForMentionedBrand ? "heuristic" : "catalog",
  };
}

export function buildHybridItem(llmItem: LlmItem): MealDraftItem {
  const quantityUnit = parseQuantityUnitFromPortionText(llmItem.portionText) ?? {
    quantity: Math.max(llmItem.servings || 1, 0.25),
    unit: "porção",
  };
  const llmQuantity = Number(llmItem.quantity);
  const quantity = Number.isFinite(llmQuantity) && llmQuantity > 0
    ? roundNutritionValue(llmQuantity)
    : quantityUnit.quantity;
  const unit = normalizeUnit(llmItem.unit || quantityUnit.unit);

  return {
    foodName: llmItem.foodName,
    canonicalName: llmItem.foodName,
    brand: detectKnownBrand(llmItem.foodName),
    portionText: llmItem.portionText,
    quantity,
    unit,
    servings: Math.max(llmItem.servings || 1, 0.25),
    estimatedGrams: roundNutritionValue(Math.max(llmItem.estimatedGrams || 0, 0)),
    calories: roundNutritionValue(llmItem.estimatedCalories),
    protein: roundNutritionValue(llmItem.estimatedMacros.protein),
    carbs: roundNutritionValue(llmItem.estimatedMacros.carbs),
    fat: roundNutritionValue(llmItem.estimatedMacros.fat),
    confidence: clampConfidence(llmItem.confidence),
    source: "hybrid",
  };
}

export function hasUsableNutrition(item: LlmItem) {
  return item.estimatedCalories > 0
    || item.estimatedMacros.protein > 0
    || item.estimatedMacros.carbs > 0
    || item.estimatedMacros.fat > 0;
}

function isLikelyBakeryBreadProduct(foodName: string) {
  const normalized = normalizeText(cleanFoodName(foodName)).replace(/-/g, " ").replace(/\s+/g, " ");
  if (!/\bpao\b/.test(normalized)) {
    return false;
  }

  return !/\bpao de queijo\b/.test(normalized);
}

function resolveEstimatedNutritionReference(
  item: LlmItem,
  similarFood?: CatalogFood,
): { reference: CatalogFood; confidenceCap: number } {
  if (isLikelyBakeryBreadProduct(item.foodName)) {
    return { reference: BAKERY_BREAD_REFERENCE, confidenceCap: 0.72 };
  }
  if (similarFood) {
    return { reference: similarFood, confidenceCap: 0.65 };
  }
  return { reference: { ...GENERIC_ESTIMATED_FOOD_REFERENCE, name: item.foodName }, confidenceCap: 0.55 };
}

export function buildEstimatedNutritionFallbackItem(llmItem: LlmItem, similarFood?: CatalogFood): MealDraftItem {
  const { reference, confidenceCap } = resolveEstimatedNutritionReference(llmItem, similarFood);
  const item = buildItemFromCatalog(reference, {
    ...llmItem,
    estimatedCalories: reference.calories,
    estimatedMacros: {
      protein: reference.protein,
      carbs: reference.carbs,
      fat: reference.fat,
    },
    confidence: Math.min(clampConfidence(llmItem.confidence), confidenceCap),
  });

  return {
    ...item,
    source: "heuristic",
  };
}

export function applyExplicitSingleGramQuantity(items: MealDraftItem[], sourceText: string) {
  const explicitQuantities = extractExplicitQuantities(sourceText);
  if (items.length !== 1 || explicitQuantities.length !== 1) {
    return items;
  }

  const [item] = items;
  const [explicit] = explicitQuantities;
  const nextEstimatedGrams = explicit.estimatedGrams ?? item.estimatedGrams;
  const currentGrams = item.estimatedGrams > 0 ? item.estimatedGrams : nextEstimatedGrams;
  const factor = nextEstimatedGrams && currentGrams > 0 ? nextEstimatedGrams / currentGrams : 1;

  return [{
    ...item,
    quantity: explicit.quantity,
    unit: explicit.unit,
    portionText: buildPortionText(explicit.quantity, explicit.unit),
    estimatedGrams: nextEstimatedGrams,
    servings: nextEstimatedGrams ? Math.max(nextEstimatedGrams / 100, 0.25) : item.servings,
    calories: roundNutritionValue(item.calories * factor),
    protein: roundNutritionValue(item.protein * factor),
    carbs: roundNutritionValue(item.carbs * factor),
    fat: roundNutritionValue(item.fat * factor),
  }];
}

export function buildHeuristicItem(foodName: string): MealDraftItem {
  const parsed = parseFoodText(foodName);
  const catalog = findCatalogFood(parsed.foodName)
    ?? findTacoFood(parsed.foodName);
  const quantity = parsed.quantity ?? 1;
  const unit = parsed.unit ?? "porção";
  const estimatedGrams = parsed.estimatedGrams ?? 100;

  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName: parsed.foodName,
      quantity,
      unit,
      portionText: parsed.portionText ?? catalog.servingLabel,
      servings: parsed.estimatedGrams ? parsed.estimatedGrams / catalog.gramsPerServing : 1,
      estimatedGrams: parsed.estimatedGrams ?? catalog.gramsPerServing,
      estimatedCalories: catalog.calories,
      estimatedMacros: {
        protein: catalog.protein,
        carbs: catalog.carbs,
        fat: catalog.fat,
      },
      confidence: parsed.estimatedGrams ? 0.55 : 0.45,
    });
  }

  const factor = estimatedGrams / 100;

  return {
    foodName: parsed.foodName,
    canonicalName: parsed.foodName,
    brand: detectKnownBrand(parsed.foodName),
    quantity,
    unit,
    portionText: parsed.portionText ?? "1 porção",
    servings: Math.max(factor, 0.25),
    estimatedGrams: roundNutritionValue(estimatedGrams),
    calories: roundNutritionValue(150 * factor),
    protein: roundNutritionValue(6 * factor),
    carbs: roundNutritionValue(15 * factor),
    fat: roundNutritionValue(5 * factor),
    confidence: parsed.estimatedGrams ? 0.45 : 0.35,
    source: "heuristic",
  };
}
