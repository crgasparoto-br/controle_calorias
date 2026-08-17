type MatchableMealItem = {
  foodName?: string | null;
  canonicalName?: string | null;
  brand?: string | null;
  portionText?: string | null;
  estimatedGrams?: number | null;
};

type ScoredMealItem<T extends MatchableMealItem> = {
  item: T;
  index: number;
  score: number;
  matchedAllTargetTokens: boolean;
};

export type MealItemTargetMatch<T extends MatchableMealItem> =
  | { kind: "none" }
  | { kind: "matched"; item: T; index: number; score: number }
  | { kind: "ambiguous"; candidates: Array<ScoredMealItem<T>> };

const significantTokenMinLength = 3;

export function normalizeMealItemTargetText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return normalizeMealItemTargetText(value)
    .split(" ")
    .filter(token => token.length >= significantTokenMinLength);
}

function searchableItemText(item: MatchableMealItem) {
  return normalizeMealItemTargetText([
    item.foodName,
    item.canonicalName,
    item.brand,
  ].filter(Boolean).join(" "));
}

function levenshteinDistance(left: string, right: string) {
  if (left === right) {
    return 0;
  }

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}

function tokenMatches(targetToken: string, candidateToken: string) {
  if (targetToken === candidateToken) {
    return true;
  }

  if (candidateToken.includes(targetToken) || targetToken.includes(candidateToken)) {
    return true;
  }

  return targetToken.length >= 4 && candidateToken.length >= 4 && levenshteinDistance(targetToken, candidateToken) <= 1;
}

function scoreMealItemTarget<T extends MatchableMealItem>(item: T, index: number, targetFood: string): ScoredMealItem<T> | null {
  const normalizedTarget = normalizeMealItemTargetText(targetFood);
  const targetTokens = tokenize(targetFood);
  const candidateText = searchableItemText(item);
  const candidateTokens = tokenize(candidateText);

  if (!normalizedTarget || !candidateText || !targetTokens.length) {
    return null;
  }

  const matchedTokenCount = targetTokens.filter(targetToken =>
    candidateTokens.some(candidateToken => tokenMatches(targetToken, candidateToken)),
  ).length;
  const matchedAllTargetTokens = matchedTokenCount === targetTokens.length;

  let score = 0;
  if (candidateText === normalizedTarget) {
    score = 100;
  } else if (candidateText.includes(normalizedTarget)) {
    score = 90 + matchedTokenCount;
  } else if (matchedAllTargetTokens) {
    score = 80 + matchedTokenCount;
  } else if (matchedTokenCount > 0) {
    score = 45 + matchedTokenCount;
  }

  if (score <= 0) {
    return null;
  }

  return { item, index, score, matchedAllTargetTokens };
}

export function resolveMealItemTarget<T extends MatchableMealItem>(items: T[], targetFood: string | null): MealItemTargetMatch<T> {
  if (!items.length) {
    return { kind: "none" };
  }

  if (!targetFood) {
    const index = items.length - 1;
    return { kind: "matched", item: items[index], index, score: 100 };
  }

  const targetTokenCount = tokenize(targetFood).length;
  const candidates = items
    .map((item, index) => scoreMealItemTarget(item, index, targetFood))
    .filter((candidate): candidate is ScoredMealItem<T> => Boolean(candidate))
    .sort((a, b) => b.score - a.score || a.index - b.index);

  if (!candidates.length) {
    return { kind: "none" };
  }

  if (candidates.length === 1) {
    const [candidate] = candidates;
    return { kind: "matched", item: candidate.item, index: candidate.index, score: candidate.score };
  }

  const [best, second] = candidates;
  const hasClearMultiTokenWinner = targetTokenCount > 1 && best.matchedAllTargetTokens && !second.matchedAllTargetTokens;
  if (hasClearMultiTokenWinner || best.score - second.score >= 20) {
    return { kind: "matched", item: best.item, index: best.index, score: best.score };
  }

  return { kind: "ambiguous", candidates: candidates.slice(0, 5) };
}

function itemDisplayName(item: MatchableMealItem) {
  return item.foodName || item.canonicalName || "item";
}

function itemQuantityLabel(item: MatchableMealItem) {
  if (item.portionText) {
    return item.portionText;
  }

  const grams = Number(item.estimatedGrams || 0);
  return Number.isFinite(grams) && grams > 0 ? `${grams} g` : "quantidade atual nao informada";
}

export function formatMealItemTargetOptions<T extends MatchableMealItem>(candidates: Array<ScoredMealItem<T>>) {
  return candidates
    .map((candidate, index) => `${index + 1}. ${itemDisplayName(candidate.item)} (${itemQuantityLabel(candidate.item)})`)
    .join("\n");
}
