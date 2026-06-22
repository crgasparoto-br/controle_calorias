import { calculateMealTotals } from "../shared/mealTotals";
import { buildHeuristicItem } from "./mealItemBuilders";
import { normalizeText } from "./mealTextParsing";
import type { MealDraftItem } from "./nutritionEngineTypes";

const NON_FOOD_TERMS = [
  "prato",
  "talher",
  "garfo",
  "faca",
  "colher",
  "guardanapo",
  "mesa",
  "bandeja",
  "embalagem",
  "rotulo",
  "rótulo",
  "copo",
  "tigela",
  "pote",
  "panela",
  "travessa",
  "marmita vazia",
  "mesa posta",
  "decoracao",
  "decoração",
];

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

export function isConversationalOnlyText(value: string) {
  const normalized = normalizeText(value).replace(/-/g, " ").replace(/\s+/g, " ");
  return !normalized || CONVERSATIONAL_ONLY_TERMS.has(normalized);
}

export function fallbackFromText(sourceText: string): MealDraftItem[] {
  const parts = sourceText
    .split(/,|\be\b|\+|\n/gi)
    .map(value => value.trim())
    .filter(value => value && !isConversationalOnlyText(value));

  if (parts.length === 0) {
    return [];
  }

  return parts.map(buildHeuristicItem);
}

export function sumTotals(items: MealDraftItem[]) {
  return calculateMealTotals(items);
}

function isLikelyNonFoodNoise(item: MealDraftItem) {
  const normalizedName = normalizeText(`${item.foodName} ${item.canonicalName}`);
  if (isConversationalOnlyText(item.foodName) || isConversationalOnlyText(item.canonicalName)) {
    return true;
  }

  return NON_FOOD_TERMS.some(term => {
    const normalizedTerm = normalizeText(term);
    return normalizedName === normalizedTerm || normalizedName.includes(normalizedTerm);
  });
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
