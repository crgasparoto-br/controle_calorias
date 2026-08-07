import { roundNutritionValue } from "../shared/mealTotals";
import { detectKnownBrand, findCatalogFood, inferItemBrand, normalizeBrandName, sourceMentionsFood } from "./catalogMatching";
import {
  buildPortionText,
  cleanFoodName,
  extractExplicitQuantities,
  extractExplicitQuantityFoodSegments,
  formatFoodNameTitleCase,
  normalizeText,
  normalizeUnit,
  parseFoodText,
  parseQuantityUnitFromPortionText,
} from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type { CatalogFood, ExplicitQuantity, LlmItem, MealDraftItem } from "./nutritionEngineTypes";

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

const ZERO_BEVERAGE_ESTIMATED_REFERENCE: CatalogFood = {
  slug: "zero-beverage-estimate",
  name: "Bebida zero estimada",
  aliases: [],
  servingLabel: "100 ml",
  gramsPerServing: 100,
  calories: 0,
  protein: 0,
  carbs: 0,
  fat: 0,
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
  const brand = inferItemBrand(food, llmItem.foodName, llmItem.brand);
  const usedGenericForMentionedBrand = Boolean(brand && !food.brandName);

  return {
    foodName: formatFoodNameTitleCase(llmItem.foodName),
    canonicalName: formatFoodNameTitleCase(food.name),
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
    classification: llmItem.foodClassification ?? null,
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
  const foodName = formatFoodNameTitleCase(llmItem.foodName);

  return {
    foodName,
    canonicalName: foodName,
    brand: normalizeBrandName(llmItem.brand) ?? detectKnownBrand(llmItem.foodName),
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
    classification: llmItem.foodClassification ?? null,
  };
}

export function hasUsableNutrition(item: LlmItem) {
  return item.estimatedCalories > 0
    || item.estimatedMacros.protein > 0
    || item.estimatedMacros.carbs > 0
    || item.estimatedMacros.fat > 0;
}

function normalizeFoodDescription(foodName: string) {
  return normalizeText(cleanFoodName(foodName)).replace(/-/g, " ").replace(/\s+/g, " ");
}

function hasExplicitZeroSugarMarker(normalizedFoodName: string) {
  return /\bzero(?:\s+acucar)?\b/.test(normalizedFoodName)
    || /\bdiet\b/.test(normalizedFoodName)
    || /\bsem\s+(?:adicao\s+de\s+)?acucar\b/.test(normalizedFoodName);
}

const EXPLICIT_BEVERAGE_CORE_PATTERN = /^(?:agua tonica|tonica|refrigerante|refri|bebida gaseificada|bebida carbonatada)\b/;
const AMBIGUOUS_BEVERAGE_CORE_PATTERN = /^(?:soda|cola|guarana)\b/;
const CARBONATED_BEVERAGE_BRAND_AT_START_PATTERN = /^(?:coca(?: cola)?|pepsi|sprite|fanta|schweppes|kuat)\b/;
const CARBONATED_BEVERAGE_VARIANT_PATTERN = /^(?:citrus|limao|laranja|uva|original|tradicional|ginger ale)$/;

function isVolumeUnit(unit?: string | null) {
  const normalizedUnit = normalizeUnit(unit ?? "");
  return normalizedUnit === "ml" || normalizedUnit === "l";
}

function removeExplicitZeroSugarMarkers(normalizedFoodName: string) {
  return normalizedFoodName
    .replace(/\bzero(?:\s+acucar)?\b/g, " ")
    .replace(/\bdiet\b/g, " ")
    .replace(/\bsem\s+(?:adicao\s+de\s+)?acucar\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAmbiguousBeverageCore(description: string, unit?: string | null) {
  if (!AMBIGUOUS_BEVERAGE_CORE_PATTERN.test(description)) {
    return false;
  }

  const standaloneCore = /^(?:soda|cola|guarana)(?:\s+antarctica)?$/.test(description);
  return standaloneCore || isVolumeUnit(unit);
}

function removeLeadingCarbonatedBeverageBrand(description: string) {
  const brandMatch = description.match(CARBONATED_BEVERAGE_BRAND_AT_START_PATTERN);
  if (!brandMatch) {
    return null;
  }

  return description.slice(brandMatch[0].length).trim();
}

function hasPositiveZeroBeverageEvidence(description: string, unit?: string | null) {
  if (EXPLICIT_BEVERAGE_CORE_PATTERN.test(description)) {
    return true;
  }
  if (isAmbiguousBeverageCore(description, unit)) {
    return true;
  }

  const afterBrand = removeLeadingCarbonatedBeverageBrand(description);
  if (afterBrand === null) {
    return false;
  }
  if (!afterBrand) {
    return true;
  }
  if (EXPLICIT_BEVERAGE_CORE_PATTERN.test(afterBrand) || isAmbiguousBeverageCore(afterBrand, unit)) {
    return true;
  }

  return isVolumeUnit(unit) || CARBONATED_BEVERAGE_VARIANT_PATTERN.test(afterBrand);
}

function isExplicitZeroBeverage(foodName: string, unit?: string | null) {
  const normalized = normalizeFoodDescription(foodName);
  if (!hasExplicitZeroSugarMarker(normalized)) {
    return false;
  }

  const descriptionWithoutZeroMarker = removeExplicitZeroSugarMarkers(normalized);
  return hasPositiveZeroBeverageEvidence(descriptionWithoutZeroMarker, unit);
}

function isLikelyBakeryBreadProduct(foodName: string) {
  const normalized = normalizeFoodDescription(foodName);
  if (!/\bpao\b/.test(normalized)) {
    return false;
  }

  return !/\bpao de queijo\b/.test(normalized);
}

function isKnownZeroBeverage(foodName: string, unit?: string | null) {
  const normalized = normalizeFoodDescription(foodName);
  return isExplicitZeroBeverage(foodName, unit)
    || /\bagua com gas\b/.test(normalized)
    || /\b(cafe|cha)\b/.test(normalized) && /\bsem\b.*\bacucar\b/.test(normalized);
}

function isLikelyCompositePreparation(foodName: string, unit?: string | null) {
  if (isKnownZeroBeverage(foodName, unit)) {
    return false;
  }

  const normalized = normalizeFoodDescription(foodName);
  const wordCount = normalized.split(/\s+/).filter(Boolean).length;
  return wordCount >= 3 && /\b(com|rechead[ao]s?|recheio|cobertura|molho|calda)\b/.test(normalized);
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
  if (isExplicitZeroBeverage(item.foodName, item.unit)) {
    return {
      reference: { ...ZERO_BEVERAGE_ESTIMATED_REFERENCE, name: item.foodName },
      confidenceCap: 0.5,
    };
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

function applyExplicitQuantityToItem(item: MealDraftItem, explicit: ExplicitQuantity) {
  const nextEstimatedGrams = explicit.estimatedGrams ?? item.estimatedGrams;
  const currentGrams = item.estimatedGrams > 0 ? item.estimatedGrams : nextEstimatedGrams;
  const factor = nextEstimatedGrams && currentGrams > 0 ? nextEstimatedGrams / currentGrams : 1;

  return {
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
  };
}

function explicitSegmentMatchesItem(foodName: string, item: MealDraftItem) {
  const normalizedFood = normalizeText(foodName);
  const normalizedItem = normalizeText(item.foodName);
  const normalizedCanonical = normalizeText(item.canonicalName);

  return normalizedFood === normalizedItem
    || normalizedFood === normalizedCanonical
    || sourceMentionsFood(foodName, item.foodName)
    || sourceMentionsFood(foodName, item.canonicalName)
    || sourceMentionsFood(item.foodName, foodName)
    || sourceMentionsFood(item.canonicalName, foodName);
}

export function applyExplicitQuantities(items: MealDraftItem[], sourceText: string) {
  if (items.length === 1) {
    const explicitQuantities = extractExplicitQuantities(sourceText);
    return explicitQuantities.length === 1
      ? [applyExplicitQuantityToItem(items[0], explicitQuantities[0])]
      : items;
  }

  const explicitSegments = extractExplicitQuantityFoodSegments(sourceText);
  if (!explicitSegments.length) {
    return items;
  }

  const usedSegments = new Set<number>();
  return items.map(item => {
    const matches = explicitSegments
      .map((segment, index) => ({ segment, index }))
      .filter(({ index, segment }) => !usedSegments.has(index) && explicitSegmentMatchesItem(segment.foodName, item));
    const match = matches.length === 1 ? matches[0] : null;

    if (!match) {
      return item;
    }

    usedSegments.add(match.index);
    return applyExplicitQuantityToItem(item, match.segment);
  });
}

export function applyExplicitSingleGramQuantity(items: MealDraftItem[], sourceText: string) {
  return applyExplicitQuantities(items, sourceText);
}

export function buildHeuristicItem(foodName: string): MealDraftItem {
  const parsed = parseFoodText(foodName);
  const allowCatalogFallback = !isLikelyCompositePreparation(parsed.foodName, parsed.unit);
  const explicitZeroBeverage = isExplicitZeroBeverage(parsed.foodName, parsed.unit);
  const directCatalog = allowCatalogFallback ? findCatalogFood(parsed.foodName) : null;
  const tacoCatalog = allowCatalogFallback && !directCatalog ? findTacoFood(parsed.foodName) : null;
  const catalog = directCatalog ?? (
    tacoCatalog && (!explicitZeroBeverage || isExplicitZeroBeverage(tacoCatalog.name))
      ? tacoCatalog
      : null
  );
  const quantity = parsed.quantity ?? 1;
  const unit = parsed.unit ?? "porção";
  const estimatedGrams = parsed.estimatedGrams ?? 100;
  const formattedFoodName = formatFoodNameTitleCase(parsed.foodName);

  if (catalog) {
    return buildItemFromCatalog(catalog, {
      foodName: formattedFoodName,
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

  if (explicitZeroBeverage) {
    return buildEstimatedNutritionFallbackItem({
      foodName: formattedFoodName,
      quantity,
      unit,
      portionText: parsed.portionText ?? buildPortionText(quantity, unit),
      servings: parsed.estimatedGrams ? Math.max(parsed.estimatedGrams / 100, 0.25) : 1,
      estimatedGrams,
      estimatedCalories: 0,
      estimatedMacros: {
        protein: 0,
        carbs: 0,
        fat: 0,
      },
      confidence: parsed.estimatedGrams ? 0.45 : 0.35,
    });
  }

  const factor = estimatedGrams / 100;

  return {
    foodName: formattedFoodName,
    canonicalName: formattedFoodName,
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
