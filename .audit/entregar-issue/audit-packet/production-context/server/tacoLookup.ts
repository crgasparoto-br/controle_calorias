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
 * 4. Correspondência fuzzy conservadora para erro ortográfico simples.
 *
 * Todo candidato passa pelo mesmo guard semântico do catálogo principal antes
 * de ser utilizado. Fuzzy matching nunca pode remover ou inverter qualificadores
 * nutricionais críticos.
 */

import { createRequire } from "module";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import type { CatalogFood } from "./nutritionEngine";
import { fuzzyMatchesWords } from "./fuzzyTextMatch";

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

function isSemanticallyCompatible(item: TacoEntry, originalQuery: string) {
  return isFoodCandidateSemanticallyCompatible(originalQuery, [item.name, ...item.aliases]);
}

function isGenericSingleWordTerm(term: string) {
  return term.split(/\s+/).filter(Boolean).length === 1;
}

function scoreTacoSubstringMatch(item: TacoEntry, query: string, originalQuery: string) {
  if (!isSemanticallyCompatible(item, originalQuery)) return 0;

  const queryWords = query.split(/\s+/).filter(Boolean);
  let bestScore = 0;

  for (const term of getSearchTerms(item)) {
    if (!term) continue;
    if (isGenericSingleWordTerm(term) && queryWords.length > 1 && query !== term) continue;

    if (query.includes(term)) {
      bestScore = Math.max(bestScore, 700 + term.length);
      continue;
    }

    if (term.includes(query)) {
      bestScore = Math.max(bestScore, 500 + query.length);
    }
  }

  return bestScore;
}

/**
 * Finds the best matching TACO entry for a given food name using a four-tier
 * textual strategy. Returns null when no compatible match is found.
 */
export function findTacoFood(foodName: string): CatalogFood | null {
  const catalog = loadTacoData();
  if (!catalog.length) return null;

  const query = normalizeText(foodName);
  if (!query) return null;

  const exact = catalog.find(item =>
    isSemanticallyCompatible(item, foodName)
      && getSearchTerms(item).some(term => term === query),
  );
  if (exact) return tacoToCatalogFood(exact);

  const substring = catalog
    .map(item => ({ item, score: scoreTacoSubstringMatch(item, query, foodName) }))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.item;
  if (substring) return tacoToCatalogFood(substring);

  const queryWords = query.split(/\s+/).filter(w => w.length >= 3);
  if (queryWords.length > 0) {
    const keyword = catalog.find(item => {
      if (!isSemanticallyCompatible(item, foodName)) return false;
      const allTerms = getSearchTerms(item).join(" ");
      return queryWords.every(word => allTerms.includes(word));
    });
    if (keyword) return tacoToCatalogFood(keyword);
  }

  if (queryWords.length > 0) {
    const fuzzy = catalog.find(item => {
      if (!isSemanticallyCompatible(item, foodName)) return false;
      const allTerms = getSearchTerms(item).join(" ");
      return fuzzyMatchesWords(query, allTerms);
    });
    if (fuzzy) return tacoToCatalogFood(fuzzy);
  }

  return null;
}

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
