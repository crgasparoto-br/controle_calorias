import { calculateMealTotals } from "../shared/mealTotals";
import { normalizeKnownFoodText } from "./foodTextNormalization";
import { buildHeuristicItem } from "./mealItemBuilders";
import { normalizeForMatching, normalizeText, QUANTITY_UNIT_PATTERN, splitFoodTextSegments } from "./mealTextParsing";
import { isGenericNutritionFallbackItem } from "./mealNutritionFallback";
import { isContainerObjectOnlyDescription } from "./mealContainerNoise";
import type { MealDraftItem } from "./nutritionEngineTypes";

const CONVERSATIONAL_ONLY_TERMS = new Set([
  "oi",
  "ola",
  "olá",
  "hello",
  "hi",
  "bom dia",
  "boa tarde",
  "boa noite",
  "tudo bem",
  "ola tudo bem",
  "olá tudo bem",
  "oi tudo bem",
  "obrigado",
  "obrigada",
  "valeu",
  "teste",
]);

type NutritionFallbackObserver = (reason: "catalog_miss" | "generic_nutrition_fallback") => void;

export function isConversationalOnlyText(value: string) {
  const normalized = normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ");
  return !normalized || CONVERSATIONAL_ONLY_TERMS.has(normalized);
}

function coalesceTrailingQuantityParts(parts: string[]) {
  const standaloneQuantity = new RegExp(`^\\d+(?:[,.]\\d+)?\\s*(?:${QUANTITY_UNIT_PATTERN})$`, "i");
  const coalesced: string[] = [];

  for (const part of parts) {
    if (standaloneQuantity.test(part.trim()) && coalesced.length > 0) {
      coalesced[coalesced.length - 1] = `${coalesced[coalesced.length - 1]} ${part.trim()}`;
      continue;
    }
    coalesced.push(part);
  }

  return coalesced;
}

function observeHeuristicFallback(item: MealDraftItem, observer?: NutritionFallbackObserver) {
  if (!observer || item.source !== "heuristic") return;
  observer("catalog_miss");
  if (isGenericNutritionFallbackItem(item)) {
    observer("generic_nutrition_fallback");
  }
}

export function fallbackFromText(sourceText: string, observer?: NutritionFallbackObserver): MealDraftItem[] {
  const parts = coalesceTrailingQuantityParts(splitFoodTextSegments(sourceText))
    .filter(value => value && !isConversationalOnlyText(value));

  if (parts.length === 0) {
    return [];
  }

  return parts.map(value => {
    const item = buildHeuristicItem(normalizeKnownFoodText(value));
    observeHeuristicFallback(item, observer);
    return item;
  });
}

export function sumTotals(items: MealDraftItem[]) {
  return calculateMealTotals(items);
}

function isLikelyNonFoodNoise(item: MealDraftItem) {
  if (isConversationalOnlyText(item.foodName) || isConversationalOnlyText(item.canonicalName)) {
    return true;
  }

  const normalizedNames = [item.foodName, item.canonicalName]
    .map(value => normalizeForMatching(value).trim().replace(/\s+/g, " "))
    .filter(Boolean);

  return normalizedNames.length > 0
    && normalizedNames.every(value => isContainerObjectOnlyDescription(value));
}

export function cleanMealItems(items: MealDraftItem[]) {
  const deduplicated = new Map<string, MealDraftItem>();

  for (const item of items) {
    if (item.confidence < 0.25 || isLikelyNonFoodNoise(item)) {
      continue;
    }

    const key = normalizeText(`${item.brand ?? ""} ${item.canonicalName || item.foodName} ${item.foodName}`);
    const current = deduplicated.get(key);
    if (!current || item.confidence > current.confidence) {
      deduplicated.set(key, item);
    }
  }

  return Array.from(deduplicated.values());
}
