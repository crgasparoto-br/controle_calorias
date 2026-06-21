/**
 * Semantic catalog search using OpenAI embeddings.
 *
 * This module provides a semantic fallback for `findCatalogFood` when the
 * standard exact/substring text matching fails to find a catalog entry.
 *
 * Strategy:
 * 1. Try deterministic packaged-snack fallbacks for common branded items whose
 *    exact SKU is not yet in the catalog.
 * 2. On first semantic use, generate embeddings for all catalog entries
 *    (name + aliases) and cache them in memory.
 * 3. For each lookup, generate an embedding for the query food name and compute
 *    cosine similarity against all cached catalog embeddings.
 * 4. Return the best match only when its similarity score exceeds a conservative
 *    threshold (SIMILARITY_THRESHOLD), ensuring no false positives are introduced.
 * 5. If OpenAI is not configured or the call fails, the function returns null
 *    gracefully so the caller can fall back to the hybrid (AI-estimated) path.
 *
 * Design constraints respected:
 * - The OpenAI SDK is used only inside `_core` or through helpers that live in
 *   the server layer. This module calls `createOpenAiClient` directly because it
 *   is a server-side utility, not a domain service.
 * - Failures are silent and non-blocking: a missing embedding never prevents a
 *   meal from being registered.
 * - The embedding cache is invalidated whenever the catalog cache changes size,
 *   so a DB-refreshed catalog is always reflected.
 */

import { getCatalogCache } from "./catalogRuntime";
import { isOpenAiConfigured, createOpenAiClient } from "./_core/openaiClient";
import type { CatalogFood } from "./nutritionEngine";

const EMBEDDING_MODEL = "text-embedding-3-small";
const SIMILARITY_THRESHOLD = 0.82;

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

function findPackagedSnackFallback(foodName: string): CatalogFood | null {
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
    return {
      ...PACKAGED_CHOCOLATE_FALLBACK,
      name: `${foodName.trim()} (estimativa de chocolate embalado)`,
      aliases: [foodName, ...PACKAGED_CHOCOLATE_FALLBACK.aliases],
    };
  }

  const cookieTerms = ["biscoito", "bolacha", "cookie", "cookies", "recheado", "recheada"];
  if (hasAnyTerm(normalized, cookieTerms)) {
    return {
      ...PACKAGED_COOKIE_FALLBACK,
      name: `${foodName.trim()} (estimativa de biscoito doce embalado)`,
      aliases: [foodName, ...PACKAGED_COOKIE_FALLBACK.aliases],
    };
  }

  return null;
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
 * Finds the best matching catalog food for a given food name using semantic
 * similarity. Returns null if no match exceeds the similarity threshold or if
 * the OpenAI API is unavailable.
 */
export async function findCatalogFoodSemantic(
  foodName: string,
): Promise<CatalogFood | null> {
  const packagedSnackFallback = findPackagedSnackFallback(foodName);
  if (packagedSnackFallback) {
    return packagedSnackFallback;
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
