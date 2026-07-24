type FoodSemanticProfile = {
  family: "coffee" | "tea" | null;
  sugarState: "added" | "free" | null;
  plain: boolean;
  complements: Set<string>;
  hasCriticalQualifier: boolean;
};

const COMPLEMENT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ["leite condensado", /\b(?:com\s+)?leite\s+condensado\b/],
  ["leite", /\b(?:com\s+)?leite\b/],
  ["mel", /\b(?:com\s+)?mel\b/],
  ["creme", /\b(?:com\s+)?creme\b/],
  ["chantilly", /\b(?:com\s+)?chantilly\b/],
  ["chocolate", /\b(?:com\s+)?chocolate\b/],
  ["achocolatado", /\b(?:com\s+)?achocolatad[oa]\b/],
];

const EXPLICIT_SUGAR_UNIT = "(?:g|gr|gramas?|kg|quilos?|mg|miligramas?|colher(?:es)? de cha|colher(?:es)? de sopa|saches?|pacotes?)";
const ADDED_SUGAR_CONNECTOR = "(?:com|e)";

function normalizeSemanticText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildProfile(value: string): FoodSemanticProfile {
  const normalized = normalizeSemanticText(value);
  const family = /\bcafe\b/.test(normalized)
    ? "coffee"
    : /\bcha\b/.test(normalized)
      ? "tea"
      : null;
  const sugarFree = /\bsem\s+(?:adicao\s+de\s+)?acucar\b/.test(normalized);
  const sugarAdded = new RegExp(
    `\\b(?:${ADDED_SUGAR_CONNECTOR}\\s+acucar|${ADDED_SUGAR_CONNECTOR}\\s+\\d+(?:[,.]\\d+)?\\s*${EXPLICIT_SUGAR_UNIT}\\s+(?:de\\s+)?acucar|adocad[oa]s?|acucarad[oa]s?)\\b`,
  ).test(normalized);
  const plain = Boolean(family) && /\b(?:puro|pura|preto|preta|natural)\b/.test(normalized);
  const complements = new Set<string>();

  for (const [name, pattern] of COMPLEMENT_PATTERNS) {
    if (pattern.test(normalized)) complements.add(name);
  }

  return {
    family,
    sugarState: sugarAdded ? "added" : sugarFree ? "free" : null,
    plain,
    complements,
    hasCriticalQualifier: sugarAdded || sugarFree || plain || complements.size > 0,
  };
}

function hasSameComplements(query: FoodSemanticProfile, candidate: FoodSemanticProfile) {
  for (const complement of query.complements) {
    if (!candidate.complements.has(complement)) return false;
  }
  return true;
}

function profilesAreCompatible(query: FoodSemanticProfile, candidate: FoodSemanticProfile) {
  if (query.family && candidate.family && query.family !== candidate.family) return false;

  if (query.sugarState === "added") {
    if (candidate.sugarState !== "added") return false;
    if (candidate.plain) return false;
  }
  if (query.sugarState === "free") {
    if (candidate.sugarState !== "free" && !candidate.plain) return false;
    if (candidate.sugarState === "added" || candidate.complements.size > 0) return false;
  }
  if (query.plain) {
    if (!candidate.plain && candidate.sugarState !== "free") return false;
    if (candidate.sugarState === "added" || candidate.complements.size > 0) return false;
  }
  if (!hasSameComplements(query, candidate)) return false;

  const sameQualifiedBeverage = Boolean(query.family && candidate.family && query.family === candidate.family);
  if (sameQualifiedBeverage) {
    if (!query.hasCriticalQualifier && candidate.hasCriticalQualifier) return false;
    if (query.sugarState !== "added" && candidate.sugarState === "added") return false;
    if (query.sugarState !== "free" && !query.plain && candidate.sugarState === "free") return false;
    if (!query.plain && candidate.plain && query.sugarState !== "free") return false;
    for (const complement of candidate.complements) {
      if (!query.complements.has(complement)) return false;
    }
  } else {
    if (query.sugarState === "added" && candidate.sugarState === "free") return false;
    if (query.sugarState === "free" && candidate.sugarState === "added") return false;
  }

  return true;
}

/**
 * Valida o candidato final, independentemente da origem do catálogo. O primeiro
 * texto representa o nome canônico: aliases genéricos não podem neutralizar um
 * qualificador crítico presente nesse nome. Os demais nomes são avaliados
 * isoladamente, evitando que a concatenação esconda contradições.
 */
export function isFoodCandidateSemanticallyCompatible(
  sourceText: string,
  candidateTexts: ReadonlyArray<string | null | undefined>,
) {
  const query = buildProfile(sourceText);
  const candidates = candidateTexts
    .map(value => value?.trim() ?? "")
    .filter(Boolean)
    .map(buildProfile);

  if (!candidates.length) return false;
  const canonical = candidates[0];
  if (
    query.family
    && canonical.family === query.family
    && canonical.hasCriticalQualifier
    && !profilesAreCompatible(query, canonical)
  ) {
    return false;
  }
  return candidates.some(candidate => profilesAreCompatible(query, candidate));
}

export function hasCaloricCoffeeComplement(value: string) {
  const profile = buildProfile(value);
  return profile.family === "coffee"
    && (profile.sugarState === "added" || profile.complements.size > 0);
}

export function isCoffeeWithAddedSugar(value: string) {
  const profile = buildProfile(value);
  return profile.family === "coffee" && profile.sugarState === "added";
}
