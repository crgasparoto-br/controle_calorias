/**
 * Semantic catalog search using OpenAI embeddings.
 *
 * This module provides semantic and web-backed fallbacks for `findCatalogFood`
 * when the standard exact/substring text matching fails to find a catalog entry.
 * Every final candidate is validated by the shared semantic-compatibility guard.
 */

import { getCatalogCache } from "./catalogRuntime";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import type { CatalogFood } from "./nutritionEngine";
import { executeResolvedCapability, type ResolvedCapabilityAttemptContext } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig, type ResolvedCapabilityConfig } from "./_core/ai/configResolver";
import { createDomainTextResponse } from "./_core/ai/domainTextResponse";

// Compatibility default only: the real default model per provider is owned by
// configResolverCore (AI_EMBEDDING_MODEL / EMBEDDING capability). This constant
// is not read on the primary path, it only documents the historical default.
const EMBEDDING_MODEL = "text-embedding-3-small";
const SIMILARITY_THRESHOLD = 0.82;
const WEB_NUTRITION_CONFIDENCE_THRESHOLD = 0.72;

type PackagedSnackCategory = "chocolate" | "cookie";

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

let embeddingCache: CatalogEmbeddingEntry[] | null = null;
let cachedCatalogSize = 0;

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
  return terms.some(term => new RegExp(`\\b${term}\\b`, "i").test(normalizedText));
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

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function candidateIsCompatible(foodName: string, candidate: CatalogFood) {
  return isFoodCandidateSemanticallyCompatible(foodName, [
    candidate.name,
    ...candidate.aliases,
    ...(candidate.variants ?? []),
  ]);
}

function parseSearchedNutritionResult(value: unknown, foodName: string): CatalogFood | null {
  const result = value as Partial<SearchedNutritionResult> | null;
  if (!result?.found || result.confidence === undefined || result.confidence < WEB_NUTRITION_CONFIDENCE_THRESHOLD) {
    return null;
  }
  if (!isPositiveNumber(result.gramsPerServing) || !isPositiveNumber(result.calories)) return null;
  if (!isNonNegativeNumber(result.protein) || !isNonNegativeNumber(result.carbs) || !isNonNegativeNumber(result.fat)) return null;

  const matchedProductName = result.matchedProductName?.trim() || foodName.trim();
  const brandName = result.brandName?.trim() || null;
  const sourceUrl = result.sourceUrl?.trim();
  const sourceAlias = sourceUrl ? `fonte: ${sourceUrl}` : "fonte: busca web";
  const candidate: CatalogFood = {
    slug: `web-nutrition-${normalizeText(matchedProductName).replace(/\s+/g, "-") || "product"}`,
    name: matchedProductName,
    aliases: [foodName, matchedProductName, sourceAlias],
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
  category: PackagedSnackCategory,
): Promise<CatalogFood | null> {
  const policy = resolveCapabilityConfig("NUTRITION_SEARCH");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) {
    return null;
  }

  try {
    const result = await executeResolvedCapability(
      policy,
      (attempt: ResolvedCapabilityAttemptContext) =>
        createDomainTextResponse(
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
                  `Categoria provável: ${category === "chocolate" ? "chocolate/bombom/wafer embalado" : "biscoito doce embalado"}`,
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
        ),
    );

    return parseSearchedNutritionResult(
      safeJsonParse<SearchedNutritionResult>(result.value.outputText),
      foodName,
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
 * dimension/space than freshly fetched ones. This is not handled beyond the
 * existing catalog-size cache invalidation below; cross-provider fallback is
 * disabled by default for EMBEDDING (Gemini is not in GEMINI_OPERATIONS'
 * embeddings set today), so this is not expected to occur in practice.
 */
async function fetchEmbeddings(
  texts: string[],
  policy: ResolvedCapabilityConfig,
): Promise<number[][]> {
  const result = await executeResolvedCapability(
    policy,
    async (attempt: ResolvedCapabilityAttemptContext) =>
      attempt.provider.createEmbeddings(
        { model: attempt.model, input: texts },
        { signal: attempt.signal },
      ),
  );
  return result.value.embeddings;
}

async function buildEmbeddingCache(policy: ResolvedCapabilityConfig): Promise<CatalogEmbeddingEntry[]> {
  const catalog = getCatalogCache() as CatalogFood[];
  const texts = catalog.map(buildCatalogText);
  const embeddings = await fetchEmbeddings(texts, policy);
  return catalog
    .map((food, i) => ({ food, embedding: embeddings[i] }))
    .filter((entry): entry is CatalogEmbeddingEntry => isEmbedding(entry.embedding));
}

async function getEmbeddingCache(policy: ResolvedCapabilityConfig): Promise<CatalogEmbeddingEntry[]> {
  const catalog = getCatalogCache();
  if (!embeddingCache || catalog.length !== cachedCatalogSize) {
    embeddingCache = await buildEmbeddingCache(policy);
    cachedCatalogSize = catalog.length;
  }
  return embeddingCache;
}

async function findCatalogFoodByEmbedding(foodName: string): Promise<CatalogFood | null> {
  const policy = resolveCapabilityConfig("EMBEDDING");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) {
    return null;
  }

  try {
    const cache = await getEmbeddingCache(policy);
    const [queryEmbedding] = await fetchEmbeddings([foodName], policy);
    if (!isEmbedding(queryEmbedding)) return null;

    let bestScore = -1;
    let bestFood: CatalogFood | null = null;

    for (const entry of cache) {
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
): Promise<CatalogFood | null> {
  const packagedSnackCategory = detectPackagedSnackCategory(foodName);
  if (packagedSnackCategory) {
    const candidate = await findPackagedSnackByWebSearch(foodName, packagedSnackCategory)
      ?? await findCatalogFoodByEmbedding(foodName)
      ?? buildPackagedSnackFallback(foodName, packagedSnackCategory);
    return candidateIsCompatible(foodName, candidate) ? candidate : null;
  }

  return findCatalogFoodByEmbedding(foodName);
}

/** Resets the in-memory embedding cache. */
export function resetEmbeddingCache(): void {
  embeddingCache = null;
  cachedCatalogSize = 0;
}
