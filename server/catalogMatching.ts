import { getCatalogCache } from "./catalogRuntime";
import { cleanFoodName, formatFoodNameTitleCase, normalizeForMatching, normalizedTokenIncludes, normalizeText } from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type { CatalogFood } from "./nutritionEngineTypes";

const KNOWN_BRANDS = [
  "Nestlé",
  "Nestle",
  "Panco",
  "Wickbold",
  "Coca-Cola",
  "Coca Cola",
  "Molico",
  "Polenghi",
  "Danone",
  "Italac",
  "Piracanjuba",
  "Growth",
];
const CRITICAL_VARIATION_TERMS = [
  "zero",
  "diet",
  "light",
  "integral",
  "desnatado",
  "sem acucar",
  "sem açúcar",
  "tradicional",
  "proteico",
  "frances",
  "francês",
  "sovado",
  "forma",
];
const MATCHING_STOP_WORDS = new Set([
  "a",
  "as",
  "o",
  "os",
  "um",
  "uma",
  "de",
  "da",
  "das",
  "do",
  "dos",
  "com",
  "ao",
  "aos",
  "em",
  "no",
  "na",
  "comi",
  "bebi",
  "tomei",
  "consumi",
  "inclui",
  "incluí",
  "adicionei",
  "registrei",
]);

export function detectKnownBrand(value: string) {
  const normalized = normalizeForMatching(value);
  return KNOWN_BRANDS.find(brand => normalizedTokenIncludes(normalized, brand)) ?? null;
}

export function normalizeBrandName(value: string | null | undefined) {
  const cleaned = cleanFoodName(value ?? "");
  return cleaned ? formatFoodNameTitleCase(cleaned) : null;
}

function detectCatalogBrand(food: CatalogFood, normalizedQuery: string) {
  return food.brandName && normalizedTokenIncludes(normalizedQuery, food.brandName) ? food.brandName : null;
}

function detectCriticalVariations(value: string) {
  const normalized = normalizeForMatching(value);
  return CRITICAL_VARIATION_TERMS.filter(term => normalizedTokenIncludes(normalized, term));
}

function catalogHasVariation(food: CatalogFood, variation: string) {
  const searchable = normalizeForMatching([
    food.name,
    ...food.aliases,
    ...(food.variants ?? []),
  ].join(" "));
  return normalizedTokenIncludes(searchable, variation);
}

function getSignificantWords(value: string) {
  return normalizeForMatching(value)
    .trim()
    .split(/\s+/)
    .filter(word => word.length >= 3 && !MATCHING_STOP_WORDS.has(word));
}

function catalogCoversSignificantWords(food: CatalogFood, normalizedRawQuery: string, mentionedBrand: string | null) {
  const brandWords = new Set(mentionedBrand ? getSignificantWords(mentionedBrand) : []);
  const queryWords = getSignificantWords(normalizedRawQuery).filter(word => !brandWords.has(word));
  if (queryWords.length <= 1) return true;

  const searchable = normalizeForMatching([
    food.name,
    ...food.aliases,
    ...(food.variants ?? []),
    food.brandName ?? "",
  ].join(" "));

  return queryWords.every(word => normalizedTokenIncludes(searchable, word));
}

function isGenericSingleWordAlias(alias: string) {
  return alias.split(/\s+/).filter(Boolean).length === 1;
}

function _catalogAliasesForSearch(food: CatalogFood): string[] {
  return [food.name, ...food.aliases];
}

export function sourceMentionsFood(sourceText: string, foodName: string) {
  const source = normalizeForMatching(sourceText);
  const candidates = new Set<string>();
  const cleanedFoodName = cleanFoodName(foodName);

  const catalogFood = findCatalogFood(cleanedFoodName) ?? findTacoFood(cleanedFoodName);
  candidates.add(cleanedFoodName);
  if (catalogFood) {
    candidates.add(catalogFood.name);
    catalogFood.aliases.forEach(alias => candidates.add(alias));
  }

  const phraseMatch = Array.from(candidates).some(candidate => {
    const normalizedCandidate = normalizeForMatching(candidate).trim();
    return normalizedCandidate.length >= 2 && source.includes(` ${normalizedCandidate} `);
  });
  if (phraseMatch) return true;

  const keywords = normalizeText(cleanedFoodName).split(/\s+/).filter(w => w.length >= 3);
  if (keywords.length > 0 && keywords.every(word => source.includes(word))) {
    return true;
  }

  return false;
}

function scoreCatalogFoodMatch(food: CatalogFood, normalizedQuery: string, normalizedRawQuery: string) {
  const catalogBrand = detectCatalogBrand(food, normalizedRawQuery);
  const mentionedBrand = catalogBrand ?? detectKnownBrand(normalizedRawQuery);
  const queryVariations = detectCriticalVariations(normalizedRawQuery);
  const queryMentionsFullAlias = (alias: string) => normalizedTokenIncludes(normalizedQuery, alias);
  const queryText = normalizedQuery.trim();
  const brandWords = new Set(mentionedBrand ? getSignificantWords(mentionedBrand) : []);
  const queryWordSet = new Set(getSignificantWords(normalizedRawQuery).filter(word => !brandWords.has(word)));
  let bestScore = 0;

  for (const candidate of [food.name, ...food.aliases]) {
    const alias = normalizeForMatching(candidate).trim();
    if (!alias) continue;

    if (queryText === alias) {
      bestScore = Math.max(bestScore, 1000 + alias.length);
      continue;
    }

    if (queryMentionsFullAlias(candidate) && !(isGenericSingleWordAlias(alias) && queryText !== alias)) {
      bestScore = Math.max(bestScore, 700 + alias.length);
      continue;
    }

    const aliasWords = getSignificantWords(alias);
    if (aliasWords.length > 1 && aliasWords.every(word => queryWordSet.has(word))) {
      bestScore = Math.max(bestScore, 600 + alias.length);
      continue;
    }

    if (!food.isBrandedProduct && alias.includes(queryText)) {
      bestScore = Math.max(bestScore, 350 + queryText.length);
    }
  }

  if (!bestScore) return 0;

  if (!catalogCoversSignificantWords(food, normalizedRawQuery, mentionedBrand)) {
    return 0;
  }

  if (queryVariations.length > 0 && queryVariations.some(variation => !catalogHasVariation(food, variation))) {
    return 0;
  }

  if (food.isBrandedProduct) {
    if (food.brandName && catalogBrand) {
      bestScore += 220;
    } else if (food.brandName && mentionedBrand && mentionedBrand !== food.brandName) {
      bestScore -= 300;
    }
  } else if (mentionedBrand) {
    bestScore -= 80;
  }

  bestScore += queryVariations.length * 70;

  return Math.max(bestScore, 0);
}

export function findCatalogFood(foodName: string, userId?: number): CatalogFood | undefined {
  // Consulta aliases pessoais do usuário antes do catálogo global
  if (userId != null) {
    try {
      // Import síncrono via require para evitar async no hot path
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolvePersonalFoodAlias } = require("./modules/whatsapp/personalFoodAliasStore") as typeof import("./modules/whatsapp/personalFoodAliasStore");
      const personalAlias = resolvePersonalFoodAlias({ userId, foodText: foodName });
      if (personalAlias) {
        // Resolve o nome canônico aprendido contra o catálogo global (sem userId para evitar recursão)
        const resolvedFood: CatalogFood | undefined = findCatalogFood(personalAlias.canonicalName);
        if (resolvedFood) return resolvedFood;
      }
    } catch {
      // Falha silenciosa: continua com catálogo global
    }
  }

  const normalized = normalizeForMatching(cleanFoodName(foodName));
  const rawNormalized = normalizeForMatching(foodName);
  const catalogSource = getCatalogCache() as CatalogFood[];

  let bestFood: CatalogFood | undefined;
  let bestScore = 0;

  for (const item of catalogSource) {
    const score = scoreCatalogFoodMatch(item, normalized, rawNormalized);
    if (score > bestScore) {
      bestScore = score;
      bestFood = item;
    }
  }

  return bestFood;
}

export function inferItemBrand(food: CatalogFood, foodName: string, explicitBrand?: string | null) {
  return food.brandName?.trim() || normalizeBrandName(explicitBrand) || detectKnownBrand(foodName);
}
