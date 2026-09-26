import { getCatalogCache } from "./catalogRuntime";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import { extractCommercialVariant } from "./commercialProductIdentity";
import { detectKnownBrand } from "./foodBrandDetection";
import {
  cleanFoodName,
  formatFoodNameTitleCase,
  normalizeForMatching,
  normalizedTokenIncludes,
  normalizeText,
  parseFoodText,
} from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type { CatalogFood } from "./nutritionEngineTypes";

const CRITICAL_VARIATION_TERMS = [
  "zero lactose",
  "sem lactose",
  "semi desnatado",
  "semidesnatado",
  "desnatado",
  "integral",
  "zero",
  "diet",
  "light",
  "sem acucar",
  "sem açúcar",
  "sem adicao de acucar",
  "sem adição de açúcar",
  "tradicional",
  "proteico",
  "grego",
  "natural",
  "frescal",
  "cremoso",
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
  "xicara",
  "xicaras",
  "copo",
  "copos",
  "colher",
  "colheres",
  "porcao",
  "porcoes",
  "unidade",
  "unidades",
  "grama",
  "gramas",
  "quilo",
  "quilos",
  "mililitro",
  "mililitros",
  "litro",
  "litros",
]);

const COMMERCIAL_IDENTITY_CONNECTOR_PREFIXES = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "em",
  "e",
  "sem",
]);

const COMMERCIAL_BRAND_CONNECTOR_PREFIXES = new Set([
  "da",
  "das",
  "de",
  "do",
  "dos",
]);

const CULINARY_COMPOSITION_CONNECTORS = new Set(["com", "sem"]);

const NON_BRAND_PRODUCT_DESCRIPTORS = new Set([
  "artesanal",
  "artesanais",
  "assada",
  "assado",
  "cozidas",
  "cozidos",
  "caseira",
  "caseiro",
  "cozida",
  "cozido",
  "fatiada",
  "fatiado",
  "fresca",
  "fresco",
  "grelhada",
  "grelhado",
  "picada",
  "picado",
  "rodelas",
  "torrada",
  "torrado",
]);

/** Tokens that complete generic food descriptions but are not brand evidence. */
const NON_BRAND_REMAINDER_TOKENS = new Set([
  "acucar",
  "agua",
  "caseira",
  "caseiro",
  "chocolate",
  "com",
  "bovina",
  "bovino",
  "crua",
  "cru",
  "desnatada",
  "desnatado",
  "extra",
  "fazenda",
  "forma",
  "frango",
  "frances",
  "integral",
  "leite",
  "light",
  "magra",
  "magro",
  "manha",
  "mineral",
  "moida",
  "natural",
  "mussarela",
  "original",
  "pote",
  "refrigerante",
  "sabor",
  "sal",
  "salgada",
  "salgado",
  "sem",
  "suina",
  "suino",
  "tipo",
  "tonica",
  "tradicional",
  "zero",
]);

type UnresolvedCommercialIdentityHint = {
  brand: string | null;
  productVariant: string | null;
};

const NON_NATURAL_PRODUCE_QUALIFIER_TOKENS = new Set([
  "barra",
  "calda",
  "chips",
  "chip",
  "com",
  "doce",
  "desidratada",
  "desidratado",
  "frita",
  "frito",
  "geleia",
  "suco",
]);

export function isNaturalProduceCatalogFood(
  food: CatalogFood | null | undefined,
) {
  if (!food || food.brandName?.trim() || food.isBrandedProduct) return false;
  if (food.isFruit || food.isVegetable) return true;

  // TACO entries for produce without an explicit classification flag still
  // carry the canonical raw-preparation marker in their identity (e.g.
  // "Pêra, Park, crua"). This is a source-derived marker, not a list of
  // cultivars or a fallback for arbitrary food names.
  const identity = normalizeForMatching(
    [food.name, ...food.aliases].join(" "),
  );
  return /\b(?:cru|crua|in natura)\b/u.test(identity) && !food.isUltraProcessed;
}

export function findNaturalProduceCatalogFood(foodName: string) {
  const sourceTokens = normalizedWords(foodName);
  if (sourceTokens.some(token => NON_NATURAL_PRODUCE_QUALIFIER_TOKENS.has(token))) {
    return null;
  }

  const direct = findCatalogFood(foodName) ?? findTacoFood(foodName);
  if (direct) return isNaturalProduceCatalogFood(direct) ? direct : null;

  for (let length = sourceTokens.length - 1; length >= 1; length -= 1) {
    const candidateName = sourceTokens.slice(0, length).join(" ");
    const candidate = findCatalogFood(candidateName) ?? findTacoFood(candidateName);
    if (isNaturalProduceCatalogFood(candidate)) return candidate;
  }

  return null;
}

function singularNaturalProduceToken(token: string) {
  return token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token;
}

/**
 * Returns a source-derived food-base hint for quantity research only.
 * It never proves a cultivar/brand and is only emitted after a prefix resolves
 * to a canonical natural-produce catalog entry.
 */
export function findNaturalProduceQuantityReferenceName(foodName: string) {
  const sourceTokens = normalizedWords(foodName);
  if (
    !sourceTokens.length ||
    sourceTokens.some(token => NON_NATURAL_PRODUCE_QUALIFIER_TOKENS.has(token))
  ) {
    return null;
  }

  for (let length = 1; length <= sourceTokens.length; length += 1) {
    const prefixTokens = sourceTokens.slice(0, length);
    const candidates = [
      prefixTokens.join(" "),
      [...prefixTokens.slice(0, -1), singularNaturalProduceToken(prefixTokens.at(-1) ?? "")].join(" "),
    ].filter((value, index, values) => value && values.indexOf(value) === index);

    for (const candidateName of candidates) {
      const candidate = findCatalogFood(candidateName) ?? findTacoFood(candidateName);
      if (isNaturalProduceCatalogFood(candidate)) return candidateName;
    }
  }

  return null;
}

function normalizedWords(value: string) {
  return normalizeText(value)
    .replace(/\b(?:mucarela|mozarela|mussarela)\b/g, "mussarela")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Reuse critical-variation policy so qualifiers cannot become brand evidence. */
const NON_BRAND_VARIATION_TOKENS = new Set(
  CRITICAL_VARIATION_TERMS.flatMap(term => normalizedWords(term))
);

function genericIdentityCandidates(foodName: string) {
  const candidates: string[][] = [];
  const seen = new Set<string>();
  const genericFoods = (getCatalogCache() as CatalogFood[]).filter(
    food => !food.isBrandedProduct && !food.brandName?.trim()
  );

  const sourceTokens = normalizedWords(foodName);
  for (let start = 0; start < sourceTokens.length; start += 1) {
    for (let length = 1; length <= sourceTokens.length - start; length += 1) {
      const tacoFood = findTacoFood(
        sourceTokens.slice(start, start + length).join(" ")
      );
      if (tacoFood) {
        genericFoods.push(tacoFood as CatalogFood);
      }
    }
  }

  for (const food of genericFoods) {
    for (const candidate of [food.name, ...food.aliases]) {
      const tokens = normalizedWords(candidate);
      if (!tokens.length || (tokens.length === 1 && tokens[0].length < 3))
        continue;
      const key = tokens.join(" ");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push(tokens);
    }
  }

  return candidates;
}

function findOrderedTokenSequence(haystack: string[], needle: string[]) {
  if (!needle.length || needle.length > haystack.length) return null;

  const indexes: number[] = [];
  let nextIndex = 0;
  for (const token of needle) {
    const index = haystack.indexOf(token, nextIndex);
    if (index < 0) return null;
    indexes.push(index);
    nextIndex = index + 1;
  }
  return indexes;
}

/**
 * Preserves an explicit commercial identity signal when the AI extractor is
 * unavailable. It only derives a hint from tokens left outside an exact
 * unbranded catalog identity; generic culinary complements remain outside this
 * heuristic so they can continue through the normal measure fallback.
 */
export function inferUnresolvedCommercialIdentityHint(
  foodName: string
): UnresolvedCommercialIdentityHint | null {
  // `normalizedWords` trata hífen como separador. Use a mesma segmentação na
  // representação que conserva a grafia para que os índices do match genérico
  // continuem alinhados ao texto original: "Koala-extra" -> ["Koala", "extra"].
  const originalTokens = cleanFoodName(foodName)
    .split(/\s+/)
    .flatMap(token => token.split("-").filter(Boolean));
  const sourceTokens = normalizedWords(cleanFoodName(foodName));
  if (!sourceTokens.length) return null;

  let bestMatch: { indexes: number[]; length: number } | null = null;
  for (const candidateTokens of genericIdentityCandidates(foodName)) {
    const indexes = findOrderedTokenSequence(sourceTokens, candidateTokens);
    if (!indexes) continue;
    if (!bestMatch || candidateTokens.length > bestMatch.length) {
      bestMatch = { indexes, length: candidateTokens.length };
    }
  }
  if (!bestMatch) return null;

  const matchedIndexes = new Set(bestMatch.indexes);
  const remainderTokens = originalTokens.filter(
    (_, index) => !matchedIndexes.has(index)
  );
  if (!remainderTokens.length) return null;

  const normalizedRemainder = remainderTokens.map(token =>
    normalizeText(token)
  );

  const hasExplicitBrandMarker = normalizedRemainder.includes("marca");
  // Um match genérico de uma única palavra não comprova que os tokens
  // restantes sejam uma marca. Em descrições como "sleepy koala chocolate",
  // o prefixo pode ser apenas o nome específico informado pelo usuário para
  // o alimento genérico. A forma explícita "marca X" continua autorizada.
  if (bestMatch.length === 1 && !hasExplicitBrandMarker) {
    const firstMatchedIndex = Math.min(...bestMatch.indexes);
    const lastMatchedIndex = Math.max(...bestMatch.indexes);
    const genericIdentityIsLeading = firstMatchedIndex === 0;
    const remainderFollowsIdentity = lastMatchedIndex < sourceTokens.length - 1;
    if (!genericIdentityIsLeading || !remainderFollowsIdentity) return null;
  }

  const remainderText = remainderTokens.join(" ");
  const productVariant = extractCommercialVariant(remainderText);
  const firstRemainderToken = normalizedRemainder[0];
  const variantTokens = new Set(normalizedWords(productVariant ?? ""));
  const brandTokens: string[] = [];
  for (const [index, token] of remainderTokens.entries()) {
    const normalized = normalizedRemainder[index];
    if (!normalized || normalized === "marca") continue;
    if (
      variantTokens.has(normalized) ||
      MATCHING_STOP_WORDS.has(normalized) ||
      NON_BRAND_PRODUCT_DESCRIPTORS.has(normalized) ||
      NON_BRAND_REMAINDER_TOKENS.has(normalized) ||
      NON_BRAND_VARIATION_TOKENS.has(normalized)
    ) {
      if (brandTokens.length) break;
      continue;
    }
    if (normalized.length < 3) continue;
    brandTokens.push(token);
  }
  const brand = brandTokens.length
    ? formatFoodNameTitleCase(brandTokens.join(" "))
    : null;

  // A possessive/prepositional connector can introduce an unknown brand
  // (e.g. "manteiga da Batavo"). Culinary conjunctions and other connectors
  // remain fail-closed so preparations such as "café com leite" cannot turn
  // the complement into a brand.
  if (COMMERCIAL_IDENTITY_CONNECTOR_PREFIXES.has(firstRemainderToken)) {
    if (
      CULINARY_COMPOSITION_CONNECTORS.has(firstRemainderToken) ||
      !COMMERCIAL_BRAND_CONNECTOR_PREFIXES.has(firstRemainderToken) ||
      !brand
    ) {
      return null;
    }

    // A preposição "de" também introduz composições alimentares ("manteiga
    // de amendoim", "queijo de cabra"). Se o primeiro complemento é um
    // alimento reconhecido, ele não é evidência de uma marca desconhecida.
    if (
      !hasExplicitBrandMarker &&
      firstRemainderToken === "de" &&
      remainderTokens.slice(1).some((_, index) => {
        const candidate = remainderTokens.slice(1, index + 2).join(" ");
        return Boolean(candidate && findTacoFood(candidate));
      })
    ) {
      return null;
    }

    // Without the explicit "marca" marker, a connector may introduce only
    // one immediate brand token. This prevents descriptions such as
    // "bolo de pote ninho cremoso" from being read as brand "Pote Ninho".
    const firstRemainderIdentityIndex = normalizedRemainder.findIndex(
      (token, index) => index > 0 && !MATCHING_STOP_WORDS.has(token)
    );
    if (
      !hasExplicitBrandMarker &&
      (brandTokens.length !== 1 ||
        firstRemainderIdentityIndex < 0 ||
        normalizedRemainder[firstRemainderIdentityIndex] !==
          normalizeText(brandTokens[0]))
    ) {
      return null;
    }
  }

  const normalizedProductVariant = normalizedWords(productVariant ?? "");
  // A flavor/qualifier without a brand is still a generic food description;
  // it is not sufficient evidence for a commercial identity.
  if (!brand && normalizedProductVariant.length > 0) return null;

  if (!brand && !productVariant) return null;
  return { brand, productVariant };
}

export function normalizeBrandName(value: string | null | undefined) {
  const cleaned = cleanFoodName(value ?? "");
  return cleaned ? formatFoodNameTitleCase(cleaned) : null;
}

function detectCatalogBrand(food: CatalogFood, normalizedQuery: string) {
  return food.brandName &&
    normalizedTokenIncludes(normalizedQuery, food.brandName)
    ? food.brandName
    : null;
}

export function detectCriticalVariations(value: string) {
  const normalized = normalizeForMatching(value);
  return CRITICAL_VARIATION_TERMS.filter(term =>
    normalizedTokenIncludes(normalized, term)
  );
}

function catalogHasVariation(food: CatalogFood, variation: string) {
  const searchable = normalizeForMatching(
    [food.name, ...food.aliases, ...(food.variants ?? [])].join(" ")
  );
  return normalizedTokenIncludes(searchable, variation);
}

export function isCatalogFoodSemanticallyCompatible(
  food: CatalogFood,
  sourceText: string
) {
  return isFoodCandidateSemanticallyCompatible(sourceText, [
    food.name,
    ...food.aliases,
    ...(food.variants ?? []),
  ]);
}

function getSignificantWords(value: string) {
  return normalizeForMatching(value)
    .trim()
    .split(/\s+/)
    .filter(word => word.length >= 3 && !MATCHING_STOP_WORDS.has(word));
}

function catalogCoversSignificantWords(
  food: CatalogFood,
  normalizedRawQuery: string,
  mentionedBrand: string | null
) {
  const brandWords = new Set(
    mentionedBrand ? getSignificantWords(mentionedBrand) : []
  );
  const queryWords = getSignificantWords(normalizedRawQuery).filter(
    word => !brandWords.has(word)
  );
  if (queryWords.length <= 1) return true;

  const searchable = normalizeForMatching(
    [
      food.name,
      ...food.aliases,
      ...(food.variants ?? []),
      food.brandName ?? "",
    ].join(" ")
  );

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

  const catalogFood =
    findCatalogFood(cleanedFoodName) ?? findTacoFood(cleanedFoodName);
  candidates.add(cleanedFoodName);
  if (catalogFood) {
    candidates.add(catalogFood.name);
    catalogFood.aliases.forEach(alias => candidates.add(alias));
  }

  const phraseMatch = Array.from(candidates).some(candidate => {
    const normalizedCandidate = normalizeForMatching(candidate).trim();
    return (
      normalizedCandidate.length >= 2 &&
      source.includes(` ${normalizedCandidate} `)
    );
  });
  if (phraseMatch) return true;

  const keywords = normalizeText(cleanedFoodName)
    .split(/\s+/)
    .filter(w => w.length >= 3);
  if (keywords.length > 0 && keywords.every(word => source.includes(word))) {
    return true;
  }

  return false;
}

function scoreCatalogFoodMatch(
  food: CatalogFood,
  normalizedQuery: string,
  normalizedRawQuery: string
) {
  if (!isCatalogFoodSemanticallyCompatible(food, normalizedRawQuery)) return 0;

  const catalogBrand = detectCatalogBrand(food, normalizedRawQuery);
  const mentionedBrand = catalogBrand ?? detectKnownBrand(normalizedRawQuery);
  const queryVariations = detectCriticalVariations(normalizedRawQuery);
  const queryMentionsFullAlias = (alias: string) =>
    normalizedTokenIncludes(normalizedQuery, alias);
  const queryText = normalizedQuery.trim();
  const brandWords = new Set(
    mentionedBrand ? getSignificantWords(mentionedBrand) : []
  );
  const queryWordSet = new Set(
    getSignificantWords(normalizedRawQuery).filter(
      word => !brandWords.has(word)
    )
  );
  let bestScore = 0;

  for (const candidate of [food.name, ...food.aliases]) {
    const alias = normalizeForMatching(candidate).trim();
    if (!alias) continue;

    if (queryText === alias) {
      bestScore = Math.max(bestScore, 1000 + alias.length);
      continue;
    }

    if (
      queryMentionsFullAlias(candidate) &&
      !(isGenericSingleWordAlias(alias) && queryText !== alias)
    ) {
      bestScore = Math.max(bestScore, 700 + alias.length);
      continue;
    }

    const aliasWords = getSignificantWords(alias).filter(
      word => !brandWords.has(word)
    );
    if (
      aliasWords.length > 1 &&
      aliasWords.every(word => queryWordSet.has(word))
    ) {
      bestScore = Math.max(bestScore, 600 + alias.length);
      continue;
    }

    if (!food.isBrandedProduct && alias.includes(queryText)) {
      bestScore = Math.max(bestScore, 350 + queryText.length);
    }
  }

  if (!bestScore) return 0;

  if (
    !catalogCoversSignificantWords(food, normalizedRawQuery, mentionedBrand)
  ) {
    return 0;
  }

  if (
    queryVariations.length > 0 &&
    queryVariations.some(variation => !catalogHasVariation(food, variation))
  ) {
    return 0;
  }

  if (food.isBrandedProduct) {
    if (food.brandName && catalogBrand) {
      bestScore += 220;
    } else if (
      food.brandName &&
      mentionedBrand &&
      mentionedBrand !== food.brandName
    ) {
      bestScore -= 300;
    }
  } else if (mentionedBrand) {
    bestScore -= 80;
  }

  bestScore += queryVariations.length * 70;

  return Math.max(bestScore, 0);
}

export function findCatalogFood(
  foodName: string,
  userId?: number
): CatalogFood | undefined {
  // Consulta aliases pessoais do usuário antes do catálogo global.
  if (userId != null) {
    try {
      // Import síncrono via require para evitar async no hot path.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolvePersonalFoodAlias } =
        require("./modules/whatsapp/personalFoodAliasStore") as typeof import("./modules/whatsapp/personalFoodAliasStore");
      const personalAlias = resolvePersonalFoodAlias({
        userId,
        foodText: foodName,
      });
      if (personalAlias) {
        // O alias aprendido não pode contornar o guard aplicado ao texto original.
        const resolvedFood: CatalogFood | undefined = findCatalogFood(
          personalAlias.canonicalName
        );
        if (
          resolvedFood &&
          isCatalogFoodSemanticallyCompatible(resolvedFood, foodName)
        ) {
          return resolvedFood;
        }
      }
    } catch {
      // Falha silenciosa: continua com catálogo global.
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

const GENERIC_CATALOG_STRUCTURAL_TOKENS = new Set([
  "a",
  "as",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "o",
  "os",
  "tipo",
]);

const GENERIC_CATALOG_PRESENTATION_TOKENS = new Set([
  "em",
  "fatia",
  "fatias",
  "fatiada",
  "fatiadas",
  "fatiado",
  "fatiados",
]);

const BROAD_GENERIC_FOOD_TOKENS = new Set([
  "bebida",
  "biscoito",
  "bolacha",
  "bombom",
  "carne",
  "chocolate",
  "iogurte",
  "manteiga",
  "pao",
  "queijo",
  "refrigerante",
]);

export function containsBroadGenericFoodToken(value: string) {
  return normalizedWords(value).some(token => BROAD_GENERIC_FOOD_TOKENS.has(token));
}

function genericCatalogIdentityTokens(value: string) {
  return normalizedWords(value).filter(
    token => !GENERIC_CATALOG_STRUCTURAL_TOKENS.has(token),
  );
}

function genericCatalogIdentityMatchesQuery(
  food: CatalogFood,
  foodName: string,
) {
  const queryTokens = genericCatalogIdentityTokens(foodName);
  if (!queryTokens.length) return false;
  if (queryTokens.length === 1 && containsBroadGenericFoodToken(queryTokens[0])) {
    return false;
  }

  const queryTokenSet = new Set(queryTokens);
  return [food.name, ...food.aliases].some(alias => {
    const candidateTokens = genericCatalogIdentityTokens(alias);
    const candidateSpecificTokens = candidateTokens.filter(
      token => !BROAD_GENERIC_FOOD_TOKENS.has(token),
    );
    const querySpecificTokens = queryTokens.filter(
      token => !BROAD_GENERIC_FOOD_TOKENS.has(token),
    );
    const candidateIdentityMatches = candidateSpecificTokens.every(token =>
      queryTokenSet.has(token)
    );
    const queryIdentityMatches = querySpecificTokens.every(token =>
      candidateTokens.includes(token)
    );
    const queryPresentationOnly = queryTokens.every(token =>
      candidateTokens.includes(token)
      || GENERIC_CATALOG_PRESENTATION_TOKENS.has(token)
    );
    return candidateIdentityMatches && queryIdentityMatches && queryPresentationOnly;
  });
}

/**
 * Finds one unbranded catalog/TACO reference only when the whole food identity
 * is compatible. Broad aliases and competing local/TACO references remain
 * unresolved so a generic reference cannot silently stand in for a different
 * product or an ambiguous category.
 */
export function findGenericCatalogFood(foodName: string): CatalogFood | null {
  const normalizedFoodName = parseFoodText(foodName).foodName || foodName;
  const candidates = [findCatalogFood(normalizedFoodName), findTacoFood(normalizedFoodName)]
    .filter((food): food is CatalogFood => Boolean(food))
    .filter((food, index, all) =>
      all.findIndex(candidate => candidate.slug === food.slug) === index
    )
    .filter(food => !food.isBrandedProduct && !food.brandName?.trim())
    .filter(food => isCatalogFoodSemanticallyCompatible(food, normalizedFoodName))
    .filter(food => genericCatalogIdentityMatchesQuery(food, normalizedFoodName));

  return candidates.length === 1 ? candidates[0] : null;
}

export function inferItemBrand(
  food: CatalogFood,
  foodName: string,
  explicitBrand?: string | null
) {
  return (
    food.brandName?.trim() ||
    normalizeBrandName(explicitBrand) ||
    detectKnownBrand(foodName)
  );
}
