/**
 * Semantic catalog search using OpenAI embeddings.
 *
 * This module provides semantic and web-backed fallbacks for `findCatalogFood`
 * when the standard exact/substring text matching fails to find a catalog entry.
 *
 * Strategy:
 * 1. For likely packaged snacks, search the web for the specific product/brand
 *    nutrition facts before using any category average.
 * 2. If no reliable product nutrition is found, use deterministic packaged-snack
 *    fallbacks for common branded items whose exact SKU is not yet in the catalog.
 * 3. On first semantic use for other foods, generate embeddings for all catalog
 *    entries (name + aliases) and cache them in memory.
 * 4. For each lookup, generate an embedding for the query food name and compute
 *    cosine similarity against all cached catalog embeddings.
 * 5. Return the best match only when its similarity score exceeds a conservative
 *    threshold (SIMILARITY_THRESHOLD), ensuring no false positives are introduced.
 * 6. If OpenAI is not configured or the call fails, the function returns null
 *    gracefully so the caller can fall back to the hybrid (AI-estimated) path.
 *
 * Design constraints respected:
 * - The OpenAI SDK is used only inside `_core` or through helpers that live in
 *   the server layer. This module calls `_core` helpers because it is a
 *   server-side utility, not a domain service.
 * - Failures are silent and non-blocking: a missing enrichment never prevents a
 *   meal from being registered.
 * - The embedding cache is invalidated whenever the catalog cache changes size,
 *   so a DB-refreshed catalog is always reflected.
 */

import { getCatalogCache } from "./catalogRuntime";
import { ENV } from "./_core/env";
import { getAiProvider } from "./_core/aiProvider";
import { isOpenAiConfigured, createOpenAiClient } from "./_core/openaiClient";
import type { CatalogFood } from "./nutritionEngine";

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
  if (hasAnyTerm(normalized, chocolateTerms)) {
    return "chocolate";
  }

  const cookieTerms = ["biscoito", "bolacha", "cookie", "cookies", "recheado", "recheada"];
  if (hasAnyTerm(normalized, cookieTerms)) {
    return "cookie";
  }

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

function isPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseSearchedNutritionResult(value: unknown, foodName: string): CatalogFood | null {
  const result = value as Partial<SearchedNutritionResult> | null;
  if (!result?.found || result.confidence === undefined || result.confidence < WEB_NUTRITION_CONFIDENCE_THRESHOLD) {
    return null;
  }
  if (!isPositiveNumber(result.gramsPerServing) || !isPositiveNumber(result.calories)) {
    return null;
  }
  if (!isNonNegativeNumber(result.protein) || !isNonNegativeNumber(result.carbs) || !isNonNegativeNumber(result.fat)) {
    return null;
  }

  const matchedProductName = result.matchedProductName?.trim() || foodName.trim();
  const brandName = result.brandName?.trim() || null;
  const sourceUrl = result.sourceUrl?.trim();
  const sourceAlias = sourceUrl ? `fonte: ${sourceUrl}` : "fonte: busca web";

  return {
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
}

async function findPackagedSnackByWebSearch(
  foodName: string,
  category: PackagedSnackCategory,
): Promise<CatalogFood | null> {
  if (!isOpenAiConfigured()) {
    return null;
  }

  try {
    const response = await getAiProvider().createTextResponse({
      model: ENV.openaiModel,
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
    });

    return parseSearchedNutritionResult(
      safeJsonParse<SearchedNutritionResult>(response.outputText),
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

async function fetchEmbeddings(texts: string[]): Promise<number[][]> {
  const client = createOpenAiClient();
  const response = await client.embeddings.create({
    model: EMBEDDING_MODEL,
    input: texts,
    encoding_format: "float",
  });
  return response.data
    .sort((a, b) => a.index - b.index)
    .map(item => item.embedding);
}

async function buildEmbeddingCache(): Promise<CatalogEmbeddingEntry[]> {
  const catalog = getCatalogCache() as CatalogFood[];
  const texts = catalog.map(buildCatalogText);
  const embeddings = await fetchEmbeddings(texts);
  return catalog.map((food, i) => ({ food, embedding: embeddings[i] }));
}

async function getEmbeddingCache(): Promise<CatalogEmbeddingEntry[]> {
  const catalog = getCatalogCache();
  if (!embeddingCache || catalog.length !== cachedCatalogSize) {
    embeddingCache = await buildEmbeddingCache();
    cachedCatalogSize = catalog.length;
  }
  return embeddingCache;
}

/**
 * Finds the best matching catalog food for a given food name using specific web
 * nutrition lookup, deterministic packaged-snack fallbacks or semantic
 * similarity. Returns null if no match exceeds the similarity threshold or if
 * the OpenAI API is unavailable.
 */
export async function findCatalogFoodSemantic(
  foodName: string,
): Promise<CatalogFood | null> {
  const packagedSnackCategory = detectPackagedSnackCategory(foodName);
  if (packagedSnackCategory) {
    return await findPackagedSnackByWebSearch(foodName, packagedSnackCategory)
      ?? buildPackagedSnackFallback(foodName, packagedSnackCategory);
  }

  if (!isOpenAiConfigured()) {
    return null;
  }

  try {
    const cache = await getEmbeddingCache();
    const [queryEmbedding] = await fetchEmbeddings([foodName]);

    let bestScore = -1;
    let bestFood: CatalogFood | null = null;

    for (const entry of cache) {
      const score = cosineSimilarity(queryEmbedding, entry.embedding);
      if (score > bestScore) {
        bestScore = score;
        bestFood = entry.food;
      }
    }

    if (bestScore >= SIMILARITY_THRESHOLD && bestFood) {
      return bestFood;
    }

    return null;
  } catch {
    // Semantic search is a best-effort enhancement; failures must not block
    // the nutrition pipeline.
    return null;
  }
}

/**
 * Resets the in-memory embedding cache. Useful for testing or after a manual
 * catalog refresh.
 */
export function resetEmbeddingCache(): void {
  embeddingCache = null;
  cachedCatalogSize = 0;
}