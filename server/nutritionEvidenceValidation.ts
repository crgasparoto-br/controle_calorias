export type NutritionEvidenceValues = {
  gramsPerServing: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
};

export type NutritionEvidenceSource = {
  url: string;
  supportingText?: string[];
};

export type NutritionEvidenceSearchResult = {
  executed: boolean;
  sources: NutritionEvidenceSource[];
};

type NutritionFactKey = keyof NutritionEvidenceValues;

type NutritionFactValues = Record<NutritionFactKey, number[]>;

const NUMBER_PATTERN = String.raw`(\d+(?:[.,]\d+)?)`;

const FACT_PATTERNS: Record<NutritionFactKey, RegExp[]> = {
  calories: [
    new RegExp(`${NUMBER_PATTERN}\\s*(?:kcal|calorias?)\\b`, "giu"),
    new RegExp(`(?:kcal|calorias?)\\s*(?::|=)?\\s*${NUMBER_PATTERN}`, "giu"),
  ],
  gramsPerServing: [
    new RegExp(`(?:porcao|unidade|peso(?:\\s+liquido)?)\\s*(?::|=)?\\s*(?:de\\s*)?${NUMBER_PATTERN}\\s*g\\b`, "giu"),
    new RegExp(`(?:por|para)\\s+(?:uma\\s+)?(?:porcao|unidade)\\s*(?:de\\s*)?${NUMBER_PATTERN}\\s*g\\b`, "giu"),
    new RegExp(`${NUMBER_PATTERN}\\s*g\\s*(?:por\\s+)?(?:porcao|unidade)\\b`, "giu"),
  ],
  protein: [
    new RegExp(`(?:proteinas?|protein)\\s*(?::|=)?\\s*${NUMBER_PATTERN}\\s*g\\b`, "giu"),
    new RegExp(`${NUMBER_PATTERN}\\s*g\\s*(?:de\\s+)?(?:proteinas?|protein)\\b`, "giu"),
  ],
  carbs: [
    new RegExp(`(?:carboidratos?|carbs?)\\s*(?::|=)?\\s*${NUMBER_PATTERN}\\s*g\\b`, "giu"),
    new RegExp(`${NUMBER_PATTERN}\\s*g\\s*(?:de\\s+)?(?:carboidratos?|carbs?)\\b`, "giu"),
  ],
  fat: [
    new RegExp(`(?:gorduras?(?:\\s+totais)?|fat)\\s*(?::|=)?\\s*${NUMBER_PATTERN}\\s*g\\b`, "giu"),
    new RegExp(`${NUMBER_PATTERN}\\s*g\\s*(?:de\\s+)?(?:gorduras?(?:\\s+totais)?|fat)\\b`, "giu"),
  ],
};

function normalizeSearchableText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%.,:=]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseLocalizedNumber(value: string): number | null {
  const normalized = value.replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractPatternValues(text: string, patterns: RegExp[]): number[] {
  const values: number[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const rawValue = match[1];
      if (!rawValue) continue;
      const parsed = parseLocalizedNumber(rawValue);
      if (parsed !== null) values.push(parsed);
    }
  }
  return values;
}

export function extractNutritionFacts(value: unknown): NutritionFactValues {
  const text = normalizeSearchableText(value);
  return {
    gramsPerServing: extractPatternValues(text, FACT_PATTERNS.gramsPerServing),
    calories: extractPatternValues(text, FACT_PATTERNS.calories),
    protein: extractPatternValues(text, FACT_PATTERNS.protein),
    carbs: extractPatternValues(text, FACT_PATTERNS.carbs),
    fat: extractPatternValues(text, FACT_PATTERNS.fat),
  };
}

function approximatelyEqual(key: NutritionFactKey, actual: number, expected: number): boolean {
  const absoluteTolerance = key === "calories"
    ? 1
    : key === "gramsPerServing"
      ? 0.5
      : 0.2;
  const relativeTolerance = key === "calories" || key === "gramsPerServing" ? 0.02 : 0.05;
  return Math.abs(actual - expected) <= Math.max(absoluteTolerance, Math.abs(expected) * relativeTolerance);
}

export function textSupportsNutritionValues(
  text: unknown,
  expected: NutritionEvidenceValues,
): boolean {
  const facts = extractNutritionFacts(text);
  return (Object.keys(expected) as NutritionFactKey[]).every(key =>
    facts[key].some(value => approximatelyEqual(key, value, expected[key])),
  );
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

export function sourceSupportsEvidence(sourceText: string, evidence: string): boolean {
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

export function normalizeHttpUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/u, "");

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

function sourceSupportsNutritionClaim(
  source: NutritionEvidenceSource,
  evidence: string,
  expected: NutritionEvidenceValues,
): boolean {
  const supportingText = source.supportingText
    ?.map(text => text.trim())
    .filter(Boolean)
    .join(" ");
  if (!supportingText) return false;
  return sourceSupportsEvidence(supportingText, evidence)
    && textSupportsNutritionValues(supportingText, expected);
}

export function findVerifiedNutritionSource(
  requestedSourceUrl: unknown,
  evidence: string,
  expected: NutritionEvidenceValues,
  webSearch: NutritionEvidenceSearchResult | undefined,
): string | null {
  if (
    webSearch?.executed !== true
    || !webSearch.sources.length
    || !textSupportsNutritionValues(evidence, expected)
  ) {
    return null;
  }

  const normalizedRequested = normalizeHttpUrl(requestedSourceUrl);
  if (normalizedRequested) {
    for (const source of webSearch.sources) {
      if (
        normalizeHttpUrl(source.url) === normalizedRequested
        && sourceSupportsNutritionClaim(source, evidence, expected)
      ) {
        return source.url.trim();
      }
    }
  }

  for (const source of webSearch.sources) {
    if (
      normalizeHttpUrl(source.url)
      && sourceSupportsNutritionClaim(source, evidence, expected)
    ) {
      return source.url.trim();
    }
  }
  return null;
}
