/**
 * Semantic catalog search using OpenAI embeddings.
 *
 * This module provides semantic and web-backed fallbacks for `findCatalogFood`
 * when the standard exact/substring text matching fails to find a catalog entry.
 * Every final candidate is validated by the shared semantic-compatibility guard.
 */

import { getCatalogCache } from "./catalogRuntime";
import { isCommercialProductIdentityCompatible } from "./commercialProductIdentity";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import type { CatalogFood } from "./nutritionEngine";
import { executeResolvedCapability, type ResolvedCapabilityAttemptContext } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig, type ResolvedCapabilityConfig } from "./_core/ai/configResolver";
import { createDomainTextResponse } from "./_core/ai/domainTextResponse";
import { AiOperationalError } from "./_core/ai/policyExecutor";
import type { AiWebSearchResult } from "./_core/aiProvider";

// The default embedding model/provider (OpenAI text-embedding-3-small) is
// owned by configResolverCore (AI_EMBEDDING_MODEL / EMBEDDING capability).
const SIMILARITY_THRESHOLD = 0.82;
const WEB_NUTRITION_CONFIDENCE_THRESHOLD = 0.72;

type NutritionSearchCategory = "chocolate" | "cookie" | "branded_product";
type PackagedSnackCategory = Exclude<NutritionSearchCategory, "branded_product">;

type SearchedNutritionResult = {
  found: boolean;
  matchedProductName: string;
  brandName: string;
  servingLabel: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  sourceUrl: string;
  evidence: string;
};

const PACKAGED_CHOCOLATE_FALLBACK: CatalogFood = {
  slug: "packaged-chocolate-estimate",
  name: "Chocolate embalado estimado",
  aliases: [
    "chocolate embalado",
    "barra de chocolate",
    "bombom",
    "wafer coberto",
    "wafer chocolate",
  ],
  servingLabel: "1 unidade",
  gramsPerServing: 40,
  calories: 212,
  protein: 2.4,
  carbs: 23.2,
  fat: 12.4,
};

const PACKAGED_COOKIE_FALLBACK: CatalogFood = {
  slug: "packaged-cookie-estimate",
  name: "Biscoito doce embalado estimado",
  aliases: [
    "biscoito doce embalado",
    "bolacha doce embalada",
    "cookie embalado",
    "biscoito recheado",
  ],
  servingLabel: "1 porção",
  gramsPerServing: 30,
  calories: 140,
  protein: 2,
  carbs: 21,
  fat: 5,
};

const searchedNutritionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    matchedProductName: { type: "string" },
    brandName: { type: "string" },
    servingLabel: { type: "string" },
    gramsPerServing: { type: "number", minimum: 0, maximum: 1000 },
    calories: { type: "number", minimum: 0, maximum: 5000 },
    protein: { type: "number", minimum: 0, maximum: 500 },
    carbs: { type: "number", minimum: 0, maximum: 500 },
    fat: { type: "number", minimum: 0, maximum: 500 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    sourceUrl: { type: "string" },
    evidence: { type: "string" },
  },
  required: [
    "found",
    "matchedProductName",
    "brandName",
    "servingLabel",
    "gramsPerServing",
    "calories",
    "protein",
    "carbs",
    "fat",
    "confidence",
    "sourceUrl",
    "evidence",
  ],
} as const;

type CatalogEmbeddingEntry = {
  food: CatalogFood;
  embedding: number[];
};

type EmbeddingFetchResult = {
  embeddings: number[][];
  sourceKey: string;
};

type EmbeddingCacheResult = {
  entries: CatalogEmbeddingEntry[];
  sourceKey: string;
};

let embeddingCache: CatalogEmbeddingEntry[] | null = null;
let cachedCatalogSize = 0;
let cachedEmbeddingSourceKey: string | null = null;
let cachedEmbeddingPolicyKey: string | null = null;

function embeddingPolicyKey(policy: ResolvedCapabilityConfig): string | null {
  const target = policy.primary;
  return target ? `${target.provider}:${target.model}` : null;
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasAnyTerm(normalizedText: string, terms: string[]) {
  const padded = ` ${normalizedText} `;
  return terms.some(term => padded.includes(` ${term} `));
}

function detectPackagedSnackCategory(foodName: string): PackagedSnackCategory | null {
  const normalized = normalizeText(foodName);
  if (!normalized) return null;

  const chocolateTerms = [
    "chocolate",
    "bombom",
    "wafer",
    "kit kat",
    "kitkat",
    "smash",
    "trento",
    "prestigio",
    "charge",
    "chokito",
    "suflair",
    "alpino",
    "bis",
    "twix",
    "snickers",
    "talento",
    "baton",
    "kinder",
    "ferrero",
  ];
  if (hasAnyTerm(normalized, chocolateTerms)) return "chocolate";

  const cookieTerms = ["biscoito", "bolacha", "cookie", "cookies", "recheado", "recheada"];
  if (hasAnyTerm(normalized, cookieTerms)) return "cookie";

  return null;
}

function buildPackagedSnackFallback(foodName: string, category: PackagedSnackCategory): CatalogFood {
  if (category === "chocolate") {
    return {
      ...PACKAGED_CHOCOLATE_FALLBACK,
      name: `${foodName.trim()} (estimativa de chocolate embalado)`,
      aliases: [foodName, ...PACKAGED_CHOCOLATE_FALLBACK.aliases],
    };
  }

  return {
    ...PACKAGED_COOKIE_FALLBACK,
    name: `${foodName.trim()} (estimativa de biscoito doce embalado)`,
    aliases: [foodName, ...PACKAGED_COOKIE_FALLBACK.aliases],
  };
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === "number" && Number.isFinite(item));
}

function parseNutritionAttemptOutput(outputText: string): SearchedNutritionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new AiOperationalError("Nutrition search provider returned invalid JSON", error, "invalid_json");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AiOperationalError("Nutrition search provider returned an invalid payload", undefined, "invalid_payload");
  }
  const result = parsed as Partial<SearchedNutritionResult>;
  if (result.found === false) return result as SearchedNutritionResult;
  if (result.found !== true) {
    throw new AiOperationalError("Nutrition search provider omitted the found flag", undefined, "invalid_payload");
  }

  const stringFields: Array<keyof SearchedNutritionResult> = [
    "matchedProductName", "brandName", "servingLabel", "sourceUrl", "evidence",
  ];
  const numberFields: Array<keyof SearchedNutritionResult> = [
    "gramsPerServing", "calories", "protein", "carbs", "fat", "confidence",
  ];
  if (stringFields.some(field => typeof result[field] !== "string")) {
    throw new AiOperationalError("Nutrition search provider returned an invalid string field", undefined, "invalid_payload");
  }
  if (numberFields.some(field => typeof result[field] !== "number" || !Number.isFinite(result[field] as number))) {
    throw new AiOperationalError("Nutrition search provider returned an invalid numeric field", undefined, "invalid_payload");
  }
  if (!result.matchedProductName?.trim()) {
    throw new AiOperationalError("Nutrition search provider returned an empty matched product", undefined, "invalid_payload");
  }
  if (
    !isPositiveNumber(result.gramsPerServing)
    || !isNonNegativeNumber(result.calories)
    || !isNonNegativeNumber(result.protein)
    || !isNonNegativeNumber(result.carbs)
    || !isNonNegativeNumber(result.fat)
    || (result.confidence as number) < 0
    || (result.confidence as number) > 1
  ) {
    throw new AiOperationalError("Nutrition search provider returned values outside the accepted schema", undefined, "invalid_payload");
  }
  return result as SearchedNutritionResult;
}

function candidateIsCompatible(foodName: string, candidate: CatalogFood) {
  return isFoodCandidateSemanticallyCompatible(foodName, [
    candidate.name,
    ...candidate.aliases,
    ...(candidate.variants ?? []),
  ]);
}

function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");

    // Search providers may append attribution parameters to an otherwise
    // identical cited URL. Ignore tracking-only parameters while preserving
    // functional query parameters that can identify a different resource.
    for (const key of [...url.searchParams.keys()]) {
      const normalizedKey = key.toLowerCase();
      if (
        normalizedKey.startsWith("utm_")
        || normalizedKey === "gclid"
        || normalizedKey === "fbclid"
      ) {
        url.searchParams.delete(key);
      }
    }
    url.searchParams.sort();

    return url.toString();
  } catch {
    return null;
  }
}

function normalizeEvidenceText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceSupportsEvidence(sourceText: string, evidence: string): boolean {
  const normalizedSource = normalizeEvidenceText(sourceText);
  const normalizedEvidence = normalizeEvidenceText(evidence);
  if (normalizedSource.length < 12 || normalizedEvidence.length < 12) return false;
  if (normalizedSource.includes(normalizedEvidence) || normalizedEvidence.includes(normalizedSource)) {
    return true;
  }

  const evidenceTokens = new Set(normalizedEvidence.split(" ").filter(token => token.length >= 3));
  const sourceTokens = new Set(normalizedSource.split(" ").filter(token => token.length >= 3));
  if (evidenceTokens.size < 3) return false;
  const matched = [...evidenceTokens].filter(token => sourceTokens.has(token)).length;
  return matched >= 3 && matched / evidenceTokens.size >= 0.6;
}

function parseLocalizedNumber(value: string): number | null {
  const normalized = value.replace(/\s+/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.05;
}

function extractUnitValues(text: string, unitPattern: string): number[] {
  const values: number[] = [];
  const regex = new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*(?:${unitPattern})`, "giu");
  for (const match of text.matchAll(regex)) {
    const parsed = parseLocalizedNumber(match[1] ?? "");
    if (parsed !== null) values.push(parsed);
  }
  return values;
}

function extractLabelledGramValues(text: string, labelPattern: string): number[] {
  const values: number[] = [];
  const patterns = [
    new RegExp(`(?:${labelPattern})\\s*(?::|=)?\\s*(-?\\d+(?:[.,]\\d+)?)\\s*g`, "giu"),
    new RegExp(`(-?\\d+(?:[.,]\\d+)?)\\s*g\\s*(?:de\\s+)?(?:${labelPattern})`, "giu"),
  ];
  for (const regex of patterns) {
    for (const match of text.matchAll(regex)) {
      const parsed = parseLocalizedNumber(match[1] ?? "");
      if (parsed !== null) values.push(parsed);
    }
  }
  return values;
}

function numericClaimsSupportResult(text: string, result: Partial<SearchedNutritionResult>): boolean {
  if (!isPositiveNumber(result.gramsPerServing) || !isNonNegativeNumber(result.calories)) return false;

  const calorieValues = extractUnitValues(text, "kcal|calorias?");
  const servingValues = extractUnitValues(text, "g|gramas?|ml|mililitros?");
  if (!calorieValues.some(value => approximatelyEqual(value, result.calories as number))) return false;
  if (!servingValues.some(value => approximatelyEqual(value, result.gramsPerServing as number))) return false;

  const labelledClaims: Array<[string, number | undefined]> = [
    ["prote[ií]nas?|proteins?", result.protein],
    ["carboidratos?|carbs?", result.carbs],
    ["gorduras?(?:\\s+totais?)?|fat", result.fat],
  ];
  for (const [label, expected] of labelledClaims) {
    if (!isNonNegativeNumber(expected)) return false;
    const values = extractLabelledGramValues(text, label);
    if (!values.some(value => approximatelyEqual(value, expected))) return false;
  }
  return true;
}

function findVerifiedNutritionSource(
  requestedSourceUrl: unknown,
  evidence: string,
  result: Partial<SearchedNutritionResult>,
  webSearch: AiWebSearchResult | undefined,
): string | null {
  if (webSearch?.executed !== true || !webSearch.sources.length) return null;

  const evidenceHasNutritionClaim = (
    extractUnitValues(evidence, "kcal|calorias?").length > 0
    || ["prote[ií]nas?|proteins?", "carboidratos?|carbs?", "gorduras?(?:\\s+totais?)?|fat"]
      .some(label => extractLabelledGramValues(evidence, label).length > 0)
  );
  const evidenceMatchesResult = numericClaimsSupportResult(evidence, result);
  if (evidenceHasNutritionClaim && !evidenceMatchesResult) return null;

  const sourcesByUrl = new Map<string, { url: string; supportingText: string[] }>();
  for (const source of webSearch.sources) {
    const normalized = normalizeHttpUrl(source.url);
    if (normalized && !sourcesByUrl.has(normalized)) {
      sourcesByUrl.set(normalized, { url: source.url.trim(), supportingText: [] });
    }
  }

  for (const source of webSearch.sources) {
    const ownUrl = normalizeHttpUrl(source.url);
    for (const text of source.supportingText ?? []) {
      const linkedUrls = [...text.matchAll(/https?:\/\/[^\s)\]]+/giu)]
        .map(match => normalizeHttpUrl(match[0]))
        .filter((url): url is string => Boolean(url && sourcesByUrl.has(url)));
      const targets = linkedUrls.length > 0
        ? [...new Set(linkedUrls)]
        : ownUrl && sourcesByUrl.has(ownUrl)
          ? [ownUrl]
          : [];
      for (const target of targets) {
        sourcesByUrl.get(target)?.supportingText.push(text);
      }
    }
  }

  const normalizedRequested = normalizeHttpUrl(requestedSourceUrl);
  const orderedSources = [
    ...(normalizedRequested && sourcesByUrl.has(normalizedRequested) ? [normalizedRequested] : []),
    ...[...sourcesByUrl.keys()].filter(url => url !== normalizedRequested),
  ];

  for (const sourceUrl of orderedSources) {
    const source = sourcesByUrl.get(sourceUrl);
    if (!source) continue;
    if (source.supportingText.some(text => (
      numericClaimsSupportResult(text, result)
      && (!evidenceMatchesResult || sourceSupportsEvidence(text, evidence))
    ))) {
      return source.url;
    }
  }
  return null;
}

function parseSearchedNutritionResult(
  value: unknown,
  foodName: string,
  webSearch: AiWebSearchResult | undefined,
): CatalogFood | null {
  const result = value as Partial<SearchedNutritionResult> | null;
  if (!result?.found || result.confidence === undefined || result.confidence < WEB_NUTRITION_CONFIDENCE_THRESHOLD) {
    return null;
  }
  if (!isPositiveNumber(result.gramsPerServing) || !isNonNegativeNumber(result.calories)) return null;
  if (!isNonNegativeNumber(result.protein) || !isNonNegativeNumber(result.carbs) || !isNonNegativeNumber(result.fat)) return null;

  const matchedProductName = result.matchedProductName?.trim() || foodName.trim();
  const brandName = result.brandName?.trim() || null;
  const evidence = result.evidence?.trim();
  const sourceUrl = findVerifiedNutritionSource(result.sourceUrl, evidence ?? "", result, webSearch);
  if (!sourceUrl || !evidence) return null;
  const sourceAlias = `fonte: ${sourceUrl}`;
  if (!isCommercialProductIdentityCompatible({
    foodName,
    matchedProductName,
    brandName,
    servingLabel: result.servingLabel?.trim() || `${result.gramsPerServing} g`,
    gramsPerServing: result.gramsPerServing,
  })) {
    return null;
  }

  const candidate: CatalogFood = {
    slug: `web-nutrition-${normalizeText(matchedProductName).replace(/\s+/g, "-") || "product"}`,
    name: matchedProductName,
    aliases: [foodName, matchedProductName, sourceAlias],
    variants: [matchedProductName],
    servingLabel: result.servingLabel?.trim() || `${result.gramsPerServing} g`,
    gramsPerServing: result.gramsPerServing,
    calories: result.calories,
    protein: result.protein,
    carbs: result.carbs,
    fat: result.fat,
    brandName,
    isBrandedProduct: Boolean(brandName),
  };

  return candidateIsCompatible(foodName, candidate) ? candidate : null;
}

export async function findPackagedSnackByWebSearch(
  foodName: string,
  category: NutritionSearchCategory,
): Promise<CatalogFood | null> {
  const policy = resolveCapabilityConfig("NUTRITION_SEARCH");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) {
    return null;
  }

  try {
    const result = await executeResolvedCapability(
      policy,
      async (attempt: ResolvedCapabilityAttemptContext) => {
        const response = await createDomainTextResponse(
          attempt.provider,
          {
            model: attempt.model,
            instructions: [
              "Você pesquisa informações nutricionais de produtos alimentícios embalados no Brasil.",
              "Use busca na internet para encontrar o produto mais específico possível por nome, marca, variação e embalagem.",
              "Prefira página oficial da marca, varejo com tabela nutricional ou banco nutricional reconhecido.",
              "Não use média genérica quando houver dúvida sobre o SKU, sabor, peso ou marca; nesse caso retorne found=false.",
              "Retorne apenas JSON válido no schema solicitado.",
            ].join("\n"),
            input: [{
              role: "user",
              content: [{
                type: "input_text",
                text: [
                  `Alimento reconhecido: ${foodName}`,
                  `Categoria provável: ${category === "chocolate"
                    ? "chocolate/bombom/wafer embalado"
                    : category === "cookie"
                      ? "biscoito doce embalado"
                      : "produto alimentício ou bebida industrializada com marca"}`,
                  "Busque calorias, proteínas, carboidratos e gorduras da porção mais específica do produto.",
                  "Se o produto for normalmente vendido por unidade, use 1 unidade como porção quando a fonte informar peso/valores por unidade.",
                  "Se a fonte trouxer valores por 100 g e peso da unidade, converta para a unidade. Se não houver peso confiável, retorne found=false.",
                  "Preencha sourceUrl com a melhor fonte usada e evidence com uma frase curta explicando a evidência.",
                ].join("\n"),
              }],
            }],
            tools: [{ type: "web_search" }],
            format: {
              type: "json_schema",
              name: "packaged_food_nutrition_lookup",
              schema: searchedNutritionJsonSchema,
              strict: true,
            },
          },
          { signal: attempt.signal },
        );
        return {
          parsed: parseNutritionAttemptOutput(response.outputText),
          webSearch: response.webSearch,
        };
      },
    );

    return parseSearchedNutritionResult(
      result.value.parsed,
      foodName,
      result.value.webSearch,
    );
  } catch {
    return null;
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function buildCatalogText(food: CatalogFood): string {
  const terms = [food.name, ...food.aliases].filter(Boolean);
  return terms.join(", ");
}

/**
 * Fetches embeddings through the EMBEDDING capability policy. Note: if the
 * resolved provider/model ever changes between calls (e.g. cross-provider
 * fallback), previously cached embeddings may have a different vector
 * dimension/space than freshly fetched ones. `getEmbeddingCache` guards
 * against this by keying the cache on `provider:model` and rebuilding it
 * whenever that key changes, in addition to catalog-size invalidation.
 */
async function fetchEmbeddings(
  texts: string[],
  policy: ResolvedCapabilityConfig,
): Promise<EmbeddingFetchResult> {
  const result = await executeResolvedCapability(
    policy,
    async (attempt: ResolvedCapabilityAttemptContext) => {
      const response = await attempt.provider.createEmbeddings(
        { model: attempt.model, input: texts },
        { signal: attempt.signal },
      );
      return {
        embeddings: response.embeddings,
        sourceKey: `${attempt.providerId}:${attempt.model}`,
      };
    },
  );
  return result.value;
}

async function buildEmbeddingCache(policy: ResolvedCapabilityConfig): Promise<EmbeddingCacheResult> {
  const catalog = getCatalogCache() as CatalogFood[];
  const texts = catalog.map(buildCatalogText);
  const fetched = await fetchEmbeddings(texts, policy);
  const entries = catalog
    .map((food, i) => ({ food, embedding: fetched.embeddings[i] }))
    .filter((entry): entry is CatalogEmbeddingEntry => isEmbedding(entry.embedding));
  return { entries, sourceKey: fetched.sourceKey };
}

async function getEmbeddingCache(policy: ResolvedCapabilityConfig): Promise<EmbeddingCacheResult> {
  const catalog = getCatalogCache();
  const policyKey = embeddingPolicyKey(policy);
  if (!embeddingCache || catalog.length !== cachedCatalogSize || policyKey !== cachedEmbeddingPolicyKey) {
    const built = await buildEmbeddingCache(policy);
    embeddingCache = built.entries;
    cachedCatalogSize = catalog.length;
    cachedEmbeddingSourceKey = built.sourceKey;
    cachedEmbeddingPolicyKey = policyKey;
  }
  return { entries: embeddingCache, sourceKey: cachedEmbeddingSourceKey as string };
}

async function findCatalogFoodByEmbedding(foodName: string): Promise<CatalogFood | null> {
  const policy = resolveCapabilityConfig("EMBEDDING");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) {
    return null;
  }

  try {
    const cache = await getEmbeddingCache(policy);
    const query = await fetchEmbeddings([foodName], policy);
    if (query.sourceKey !== cache.sourceKey) {
      resetEmbeddingCache();
      return null;
    }
    const [queryEmbedding] = query.embeddings;
    if (!isEmbedding(queryEmbedding)) return null;

    let bestScore = -1;
    let bestFood: CatalogFood | null = null;

    for (const entry of cache.entries) {
      if (!candidateIsCompatible(foodName, entry.food)) continue;
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestFood = entry.food;
      }
    }

    if (bestScore >= SIMILARITY_THRESHOLD && bestFood) return bestFood;
  } catch {
    // Semantic search is a best-effort enhancement; failures must not block
    // the nutrition pipeline.
  }

  return null;
}

/**
 * Finds the best matching catalog food for a given food name using specific web
 * nutrition lookup, semantic similarity or deterministic packaged-snack
 * fallbacks. Returns null when no safe and semantically compatible fallback is available.
 */
export async function findCatalogFoodSemantic(
  foodName: string,
  options: { searchSpecificProduct?: boolean; skipNutritionSearch?: boolean } = {},
): Promise<CatalogFood | null> {
  const packagedSnackCategory = detectPackagedSnackCategory(foodName);
  if (packagedSnackCategory && !options.skipNutritionSearch) {
    const candidate = await findPackagedSnackByWebSearch(foodName, packagedSnackCategory)
      ?? await findCatalogFoodByEmbedding(foodName)
      ?? buildPackagedSnackFallback(foodName, packagedSnackCategory);
    return candidateIsCompatible(foodName, candidate) ? candidate : null;
  }

  if (packagedSnackCategory) return findCatalogFoodByEmbedding(foodName);

  if (options.searchSpecificProduct) {
    const candidate = await findPackagedSnackByWebSearch(foodName, "branded_product")
      ?? await findCatalogFoodByEmbedding(foodName);
    return candidate && candidateIsCompatible(foodName, candidate) ? candidate : null;
  }

  return findCatalogFoodByEmbedding(foodName);
}

/** Resets the in-memory embedding cache. */
export function resetEmbeddingCache(): void {
  embeddingCache = null;
  cachedCatalogSize = 0;
  cachedEmbeddingSourceKey = null;
  cachedEmbeddingPolicyKey = null;
}
