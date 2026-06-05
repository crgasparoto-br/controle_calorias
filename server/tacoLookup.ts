/**
 * TACO Lookup — Camada 3 do pipeline de busca nutricional.
 *
 * Este módulo fornece busca textual na Tabela Brasileira de Composição de
 * Alimentos (TACO, UNICAMP) + alimentos complementares curados manualmente,
 * totalizando ~615 itens.
 *
 * A TACO é a referência oficial de composição de alimentos consumidos no
 * Brasil. Todos os valores são expressos por 100 g de parte comestível.
 *
 * Estratégia de matching (em ordem de prioridade):
 * 1. Correspondência exata (normalizada) de nome ou alias.
 * 2. Correspondência por inclusão de substring (nome/alias contém a query
 *    ou a query contém o nome/alias).
 * 3. Correspondência por palavras-chave: todas as palavras da query com
 *    3+ caracteres devem aparecer no nome ou aliases do item.
 *
 * O módulo expõe também `findTacoFoodSemantic` para busca semântica via
 * embeddings, utilizada pelo `catalogSemanticSearch` quando o match textual
 * falha.
 *
 * Design constraints:
 * - O JSON da TACO é carregado uma única vez em memória (lazy singleton).
 * - Falhas de leitura do JSON são fatais em dev e silenciosas em produção,
 *   retornando uma lista vazia para não bloquear o pipeline.
 * - Todos os valores numéricos são normalizados para 100 g de base.
 */

import { createRequire } from "module";
import type { CatalogFood } from "./nutritionEngine";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TacoEntry = {
  slug: string;
  name: string;
  aliases: string[];
  servingLabel: string;
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number;
  isFruit?: boolean;
  isVegetable?: boolean;
  isUltraProcessed?: boolean;
  source?: string;
};

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

let tacoCache: TacoEntry[] | null = null;

function loadTacoData(): TacoEntry[] {
  if (tacoCache) return tacoCache;
  try {
    const require = createRequire(import.meta.url);
    tacoCache = require("./tacoCatalog.json") as TacoEntry[];
    return tacoCache;
  } catch {
    tacoCache = [];
    return tacoCache;
  }
}

export function getTacoCatalog(): TacoEntry[] {
  return loadTacoData();
}

// ---------------------------------------------------------------------------
// Text normalisation helpers
// ---------------------------------------------------------------------------

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function getSearchTerms(food: TacoEntry): string[] {
  return [food.name, ...food.aliases].map(normalizeText).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Textual search
// ---------------------------------------------------------------------------

/**
 * Finds the best matching TACO entry for a given food name using a three-tier
 * textual strategy. Returns null when no match is found.
 */
export function findTacoFood(foodName: string): CatalogFood | null {
  const catalog = loadTacoData();
  if (!catalog.length) return null;

  const query = normalizeText(foodName);
  if (!query) return null;

  // Tier 1: exact match
  const exact = catalog.find(item =>
    getSearchTerms(item).some(term => term === query),
  );
  if (exact) return tacoToCatalogFood(exact);

  // Tier 2: substring containment
  const substring = catalog.find(item =>
    getSearchTerms(item).some(
      term => query.includes(term) || term.includes(query),
    ),
  );
  if (substring) return tacoToCatalogFood(substring);

  // Tier 3: all significant keywords present
  const queryWords = query.split(/\s+/).filter(w => w.length >= 3);
  if (queryWords.length > 0) {
    const keyword = catalog.find(item => {
      const allTerms = getSearchTerms(item).join(" ");
      return queryWords.every(word => allTerms.includes(word));
    });
    if (keyword) return tacoToCatalogFood(keyword);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Conversion
// ---------------------------------------------------------------------------

function tacoToCatalogFood(entry: TacoEntry): CatalogFood {
  return {
    slug: entry.slug,
    name: entry.name,
    aliases: entry.aliases,
    servingLabel: entry.servingLabel,
    gramsPerServing: entry.gramsPerServing,
    calories: entry.calories,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat,
  };
}
