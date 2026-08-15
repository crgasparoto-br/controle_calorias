import { calculateMealTotals } from "../shared/mealTotals";
import { normalizeKnownFoodText } from "./foodTextNormalization";
import { buildHeuristicItem } from "./mealItemBuilders";
import { normalizeForMatching, normalizeText, QUANTITY_UNIT_PATTERN, splitFoodTextSegments } from "./mealTextParsing";
import { isGenericNutritionFallbackItem } from "./mealNutritionFallback";
import { findTacoFood } from "./tacoLookup";
import type { MealDraftItem } from "./nutritionEngineTypes";

const NON_FOOD_OBJECT_TERMS = new Set([
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
  "copo",
  "tigela",
  "pote",
  "panela",
  "travessa",
  "marmita",
]);

const FOOD_SERVING_CONTAINER_TERMS = new Set([
  "copo",
  "tigela",
  "pote",
  "prato",
  "marmita",
  "bandeja",
  "travessa",
  "panela",
]);

const FOOD_CONTENT_CONNECTORS = new Set(["de", "da", "das", "do", "dos", "com"]);
const NON_FOOD_CONNECTORS = new Set(["a", "as", "o", "os", ...FOOD_CONTENT_CONNECTORS, "sem"]);
const EXPLICIT_NON_FOOD_PHRASES = new Set(["marmita vazia", "mesa posta", "decoracao"]);
const NON_FOOD_CONTAINER_CONTENT_HEADS = new Set([
  "plastico",
  "vidro",
  "metal",
  "papel",
  "papelao",
  "ceramica",
  "porcelana",
  "madeira",
  "aco",
  "aluminio",
  "pressao",
  "tampa",
  "canudo",
  "talher",
  "garfo",
  "faca",
  "colher",
  "guardanapo",
  "rotulo",
  "etiqueta",
  "embalagem",
]);

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

function hasKnownFoodSignal(value: string) {
  const normalized = normalizeForMatching(value).trim().replace(/\s+/g, " ");
  if (!normalized) return false;

  const candidate = findTacoFood(value);
  if (!candidate) return false;

  return [candidate.name, ...candidate.aliases].some(term => {
    const normalizedTerm = normalizeForMatching(term).trim().replace(/\s+/g, " ");
    return normalizedTerm.length >= 3
      && (` ${normalized} `).includes(` ${normalizedTerm} `);
  });
}

function isObjectOnlyDescription(normalizedName: string) {
  const normalized = normalizedName.trim();
  if (!normalized) return false;
  if (EXPLICIT_NON_FOOD_PHRASES.has(normalized)) return true;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  const headIndex = tokens.findIndex(token => !NON_FOOD_CONNECTORS.has(token));
  if (headIndex < 0) return false;

  const head = tokens[headIndex];
  if (!NON_FOOD_OBJECT_TERMS.has(head)) return false;

  // Objetos que não representam recipientes/porções alimentares continuam sendo
  // ruído mesmo quando recebem modificadores arbitrários (ex.: "mesa redonda").
  if (!FOOD_SERVING_CONTAINER_TERMS.has(head)) return true;

  // Para recipientes que também podem descrever uma porção ("copo de açaí",
  // "prato com arroz"), um adjetivo arbitrário não é evidência de alimento.
  // Isso evita depender de uma enumeração fechada de descritores como
  // "vazio", "descartável", "quebrado", "azul" etc.
  const connectorIndex = tokens.findIndex((token, index) =>
    index > headIndex && FOOD_CONTENT_CONNECTORS.has(token),
  );
  if (connectorIndex < 0) return true;

  const contentTokens = tokens.slice(connectorIndex + 1)
    .filter(token => !NON_FOOD_CONNECTORS.has(token));
  if (!contentTokens.length) return true;

  const content = contentTokens.join(" ");
  if (hasKnownFoodSignal(content)) return false;

  // O catálogo local é evidência positiva, não pré-requisito para reconhecer
  // conteúdo alimentar. Um recipiente seguido por um conector de conteúdo deve
  // poder carregar preparações válidas ainda ausentes da TACO (por exemplo,
  // "copo de smoothie de pitaya" ou "tigela com bubble tea"). Mantemos a
  // rejeição quando o complemento descreve material/componente do próprio
  // recipiente, enquanto descritores sem conector continuam rejeitados de
  // forma estrutural e aberta pelo ramo acima.
  return NON_FOOD_CONTAINER_CONTENT_HEADS.has(contentTokens[0]);
}

function isLikelyNonFoodNoise(item: MealDraftItem) {
  if (isConversationalOnlyText(item.foodName) || isConversationalOnlyText(item.canonicalName)) {
    return true;
  }

  const normalizedNames = [item.foodName, item.canonicalName]
    .map(value => normalizeForMatching(value).trim().replace(/\s+/g, " "))
    .filter(Boolean);
  if (normalizedNames.some(value => EXPLICIT_NON_FOOD_PHRASES.has(value))) {
    return true;
  }

  return normalizedNames.length > 0
    && normalizedNames.every(value => isObjectOnlyDescription(value));
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
