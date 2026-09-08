import { executeResolvedCapability, type ResolvedCapabilityAttemptContext } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./_core/ai/configResolver";
import { createDomainTextResponse } from "./_core/ai/domainTextResponse";
import { AiOperationalError } from "./_core/ai/policyExecutor";
import type { AiWebSearchResult } from "./_core/aiProvider";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import { extractCommercialVariant, isCommercialProductIdentityCompatible } from "./commercialProductIdentity";
import type { NutritionResearchPersistence } from "./brandedNutritionPersistence";
import type { CatalogFood } from "./nutritionEngineTypes";

const WEB_NUTRITION_CONFIDENCE_THRESHOLD = 0.72;

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

type CommercialMeasure = { kind: "mass" | "volume"; value: number };

export type BrandedNutritionSearchRuntime = {
  resolveCapabilityConfig: typeof resolveCapabilityConfig;
  executeResolvedCapability: typeof executeResolvedCapability;
  persistence?: NutritionResearchPersistence;
};

const defaultBrandedNutritionRuntime: BrandedNutritionSearchRuntime = {
  resolveCapabilityConfig,
  executeResolvedCapability,
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
    "found", "matchedProductName", "brandName", "servingLabel", "gramsPerServing",
    "calories", "protein", "carbs", "fat", "confidence", "sourceUrl", "evidence",
  ],
} as const;

const GENERIC_IDENTITY_TOKENS = new Set([
  "a", "ao", "aos", "as", "bebida", "bebidas", "cerveja", "cervejas", "da", "das",
  "de", "do", "dos", "e", "embalagem", "frasco", "garrafa", "garrafas", "lata", "latas",
  "ml", "l", "g", "kg", "mg", "o", "os", "produto", "produtos", "porcao", "unidade", "unidades",
]);

const BRAND_NOISE_TOKENS = new Set(["marca", "brand", "company", "companhia", "ltda", "sa"]);
const NUTRIENT_MEASURE_LABEL_PATTERN = "(?:proteinas?|protein|carboidratos?(?:\\s+totais?)?|carbs?|gorduras?(?:\\s+(?:totais?|saturadas?|trans))?|fat|fibras?|fiber|acucares?(?:\\s+(?:totais?|adicionados?))?|sugars?|sodio|sodium|sal|salt)";
const NUTRIENT_BEFORE_MEASURE_PATTERN = new RegExp(`${NUTRIENT_MEASURE_LABEL_PATTERN}\\s*[:=\\-]?\\s*$`);
const NUTRIENT_AFTER_MEASURE_PATTERN = new RegExp(`^\\s*(?:de\\s+)?${NUTRIENT_MEASURE_LABEL_PATTERN}\\b`);
const SERVING_MEASURE_CONTEXT_PATTERN = /(?:porcao|porcoes|serving|servings|tamanho\s+da\s+porcao|dose|doses|fatia|fatias|garrafa|garrafas|lata|latas|unidade|unidades|colher|colheres|scoop|scoops|copo|copos|pacote|pacotes|barra|barras|frasco|frascos|embalagem|embalagens|peso\s+liquido|conteudo\s+liquido)/;

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9,.\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactTokens(value: string, ignored = GENERIC_IDENTITY_TOKENS) {
  return normalizeText(value)
    .replace(/\b\d+(?:[,.]\d+)?\s*(?:kg|mg|ml|g|l)\b/g, " ")
    .split(/\s+/g)
    .map(token => token.replace(/[,.]/g, ""))
    .filter(token => token.length >= 2 && !ignored.has(token) && !/^\d+$/.test(token));
}

function brandTokens(value: string) {
  return compactTokens(value, new Set([...GENERIC_IDENTITY_TOKENS, ...BRAND_NOISE_TOKENS]));
}

function textContainsAllTokens(text: string, tokens: string[]) {
  const normalized = ` ${normalizeText(text).replace(/[^a-z0-9]+/g, " ")} `;
  return tokens.every(token => normalized.includes(` ${token} `) || normalized.includes(token));
}

function toCommercialMeasure(amountText: string, unit: string): CommercialMeasure | null {
  const amount = Number(amountText.replace(",", "."));
  if (!Number.isFinite(amount)) return null;
  switch (unit) {
    case "kg": return { kind: "mass", value: amount * 1000 };
    case "mg": return { kind: "mass", value: amount / 1000 };
    case "g": return { kind: "mass", value: amount };
    case "l": return { kind: "volume", value: amount * 1000 };
    default: return { kind: "volume", value: amount };
  }
}

function extractMeasures(value: string): CommercialMeasure[] {
  const normalized = normalizeText(value);
  const measures: CommercialMeasure[] = [];
  for (const match of normalized.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|mg|ml|g|l)\b/g)) {
    const measure = toCommercialMeasure(match[1], match[2]);
    if (measure) measures.push(measure);
  }
  return measures;
}

function extractServingCandidateMeasures(value: string, allowBareMeasure = false): CommercialMeasure[] {
  const normalized = normalizeText(value);
  const measures: CommercialMeasure[] = [];
  for (const match of normalized.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|mg|ml|g|l)\b/g)) {
    const index = match.index ?? 0;
    const before = normalized.slice(Math.max(0, index - 48), index);
    const after = normalized.slice(index + match[0].length, index + match[0].length + 48);
    if (NUTRIENT_BEFORE_MEASURE_PATTERN.test(before) || NUTRIENT_AFTER_MEASURE_PATTERN.test(after)) continue;
    if (!allowBareMeasure && !SERVING_MEASURE_CONTEXT_PATTERN.test(`${before} ${after}`)) continue;
    const measure = toCommercialMeasure(match[1], match[2]);
    if (measure) measures.push(measure);
  }
  return measures;
}

function approximatelyEqual(left: number, right: number) {
  const tolerance = Math.max(0.05, Math.abs(right) * 0.01);
  return Math.abs(left - right) <= tolerance;
}

function measuresContainAll(expected: CommercialMeasure[], actual: CommercialMeasure[]) {
  return expected.every(target => actual.some(candidate =>
    target.kind === candidate.kind && approximatelyEqual(candidate.value, target.value),
  ));
}

function structuredIdentityIsCompatible(foodName: string, result: SearchedNutritionResult) {
  if (!isCommercialProductIdentityCompatible({
    foodName,
    matchedProductName: result.matchedProductName,
    brandName: result.brandName,
    servingLabel: result.servingLabel,
    gramsPerServing: result.gramsPerServing,
  })) return false;

  const expectedBrandTokens = brandTokens(result.brandName);
  if (!expectedBrandTokens.length || !textContainsAllTokens(foodName, expectedBrandTokens)) return false;

  const requestMeasures = extractMeasures(foodName);
  const productMeasures = extractMeasures(result.matchedProductName);
  const servingMeasures = extractMeasures(result.servingLabel);
  if (requestMeasures.length) {
    if (productMeasures.length && !measuresContainAll(requestMeasures, productMeasures)) return false;
    if (!servingMeasures.length || !measuresContainAll(requestMeasures, servingMeasures)) return false;
    if (requestMeasures.length === 1 && !approximatelyEqual(result.gramsPerServing, requestMeasures[0].value)) return false;
  }

  return isFoodCandidateSemanticallyCompatible(foodName, [
    result.matchedProductName,
    result.brandName,
    result.servingLabel,
  ]);
}

function normalizeHttpUrl(value: string | undefined) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function labeledNutritionValues(
  value: string,
  labelPattern: string,
  unitPattern: string,
) {
  const normalized = normalizeText(value);
  const values: number[] = [];
  const patterns = [
    new RegExp(`\\b(\\d+(?:[,.]\\d+)?)\\s*(?:${unitPattern})\\s*(?:de\\s+)?(?:${labelPattern})\\b`, "g"),
    new RegExp(`\\b(?:${labelPattern})\\b\\s*[:=\\-]?\\s*(\\d+(?:[,.]\\d+)?)\\s*(?:${unitPattern})?\\b`, "g"),
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1].replace(",", "."));
      if (Number.isFinite(parsed)) values.push(parsed);
    }
  }
  return values;
}

function hasLabeledNutritionValue(
  text: string,
  expected: number,
  labelPattern: string,
  unitPattern: string,
) {
  return labeledNutritionValues(text, labelPattern, unitPattern)
    .some(actual => approximatelyEqual(actual, expected));
}

function hasLabeledCalories(text: string, expected: number) {
  const normalized = normalizeText(text);
  const values: number[] = [];
  const patterns = [
    /\b(\d+(?:[,.]\d+)?)\s*(?:kcal|calorias?)\b/g,
    /\b(?:kcal|calorias?)\b\s*[:=\-]?\s*(\d+(?:[,.]\d+)?)\b/g,
  ];
  for (const pattern of patterns) {
    for (const match of normalized.matchAll(pattern)) {
      const parsed = Number(match[1].replace(",", "."));
      if (Number.isFinite(parsed)) values.push(parsed);
    }
  }
  return values.some(actual => approximatelyEqual(actual, expected));
}

function numericEvidenceSupportsResult(text: string, result: SearchedNutritionResult) {
  return hasLabeledCalories(text, result.calories)
    && hasLabeledNutritionValue(text, result.protein, "proteinas?|protein", "g")
    && hasLabeledNutritionValue(text, result.carbs, "carboidratos?|carbs?", "g")
    && hasLabeledNutritionValue(text, result.fat, "gorduras?(?:\\s+totais?)?|fat", "g");
}

function sourceSupportsCommercialIdentity(
  source: AiWebSearchResult["sources"][number],
  foodName: string,
  result: SearchedNutritionResult,
) {
  const sourceText = [source.url, source.title ?? "", ...(source.supportingText ?? [])].join(" ");
  const requiredBrandTokens = brandTokens(result.brandName);
  if (!requiredBrandTokens.length || !textContainsAllTokens(sourceText, requiredBrandTokens)) return false;

  const requestTokens = compactTokens(foodName).filter(token => !requiredBrandTokens.includes(token));
  const candidateTokens = new Set(compactTokens(result.matchedProductName));
  const discriminants = requestTokens.filter(token => candidateTokens.has(token));
  return discriminants.length === 0 || discriminants.some(token => textContainsAllTokens(sourceText, [token]));
}

function sourceSupportsServing(
  source: AiWebSearchResult["sources"][number],
  result: SearchedNutritionResult,
) {
  const sourceTexts = [source.title ?? "", ...(source.supportingText ?? [])];
  const explicitServingMeasures = sourceTexts.flatMap(text => extractServingCandidateMeasures(text));
  if (explicitServingMeasures.length) {
    return explicitServingMeasures.some(measure => approximatelyEqual(measure.value, result.gramsPerServing));
  }

  // Some first-party/product snippets state nutrition for the whole commercial unit
  // without a separate "serving" label (for example "330 ml: 100 kcal...").
  // Accept that bare measure only when the source has no conflicting explicit serving.
  // Nutrient-labeled measures remain excluded by extractServingCandidateMeasures.
  const bareMeasures = sourceTexts.flatMap(text => extractServingCandidateMeasures(text, true));
  return bareMeasures.some(measure => approximatelyEqual(measure.value, result.gramsPerServing));
}

type VerifiedNutritionSource = {
  url: string;
  evidence: string;
};

function sourceNutritionEvidenceText(source: AiWebSearchResult["sources"][number]) {
  return [source.title ?? "", ...(source.supportingText ?? [])]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function findVerifiedSource(
  webSearch: AiWebSearchResult | undefined,
  foodName: string,
  result: SearchedNutritionResult,
): VerifiedNutritionSource | null {
  if (!webSearch?.executed || !Array.isArray(webSearch.sources) || !webSearch.sources.length) return null;
  const requested = normalizeHttpUrl(result.sourceUrl);
  const ordered = [...webSearch.sources].sort((left, right) => {
    const leftMatch = normalizeHttpUrl(left.url) === requested ? 1 : 0;
    const rightMatch = normalizeHttpUrl(right.url) === requested ? 1 : 0;
    return rightMatch - leftMatch;
  });

  for (const source of ordered) {
    const normalizedUrl = normalizeHttpUrl(source.url);
    if (!normalizedUrl) continue;
    // Only source-derived text may prove the numeric nutrition claim. The
    // provider's structured `result.evidence` is a model-produced summary and
    // must never be allowed to supply missing calories/macros/portion values.
    const evidenceText = sourceNutritionEvidenceText(source);
    if (!evidenceText) continue;
    if (!sourceSupportsServing(source, result)) continue;
    if (!numericEvidenceSupportsResult(evidenceText, result)) continue;
    if (!sourceSupportsCommercialIdentity(source, foodName, result)) continue;
    return { url: source.url.trim(), evidence: evidenceText };
  }
  return null;
}

function parseProviderOutput(outputText: string): SearchedNutritionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new AiOperationalError("Nutrition search provider returned invalid JSON", error, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiOperationalError("Nutrition search provider returned an invalid payload", undefined, "invalid_payload");
  }
  const result = parsed as Partial<SearchedNutritionResult>;
  if (result.found === false) return result as SearchedNutritionResult;
  if (result.found !== true) throw new AiOperationalError("Nutrition search provider omitted found", undefined, "invalid_payload");
  const strings: Array<keyof SearchedNutritionResult> = ["matchedProductName", "brandName", "servingLabel", "sourceUrl", "evidence"];
  const numbers: Array<keyof SearchedNutritionResult> = ["gramsPerServing", "calories", "protein", "carbs", "fat", "confidence"];
  if (strings.some(key => typeof result[key] !== "string") || numbers.some(key => typeof result[key] !== "number" || !Number.isFinite(result[key] as number))) {
    throw new AiOperationalError("Nutrition search provider returned invalid fields", undefined, "invalid_payload");
  }
  return result as SearchedNutritionResult;
}

function toCatalogFood(foodName: string, result: SearchedNutritionResult, webSearch: AiWebSearchResult | undefined): CatalogFood | null {
  if (!result.found || result.confidence < WEB_NUTRITION_CONFIDENCE_THRESHOLD) return null;
  if (result.gramsPerServing <= 0 || [result.calories, result.protein, result.carbs, result.fat].some(value => value < 0)) return null;
  if (!structuredIdentityIsCompatible(foodName, result)) return null;
  const verifiedSource = findVerifiedSource(webSearch, foodName, result);
  if (!verifiedSource) return null;
  return {
    slug: `web-nutrition-${normalizeText(result.matchedProductName).replace(/\s+/g, "-") || "product"}`,
    name: result.matchedProductName.trim(),
    aliases: [foodName, result.matchedProductName.trim(), `fonte: ${verifiedSource.url}`],
    productVariant: extractCommercialVariant(result.matchedProductName),
    variants: [result.matchedProductName.trim()],
    sourceUrls: [verifiedSource.url],
    sourceEvidence: verifiedSource.evidence,
    sourceVerifiedAt: new Date(),
    sourceConfidence: result.confidence,
    servingLabel: result.servingLabel.trim(),
    gramsPerServing: result.gramsPerServing,
    calories: result.calories,
    protein: result.protein,
    carbs: result.carbs,
    fat: result.fat,
    brandName: result.brandName.trim(),
    isBrandedProduct: true,
  };
}

export async function findBrandedNutritionByWebSearch(
  foodName: string,
  runtime: BrandedNutritionSearchRuntime = defaultBrandedNutritionRuntime,
): Promise<CatalogFood | null> {
  const cached = await runtime.persistence?.findByIdentity(foodName);
  if (cached) return cached;

  const policy = runtime.resolveCapabilityConfig("NUTRITION_SEARCH");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) return null;
  try {
    const execution = await runtime.executeResolvedCapability(
      policy,
      async (attempt: ResolvedCapabilityAttemptContext) => {
        const response = await createDomainTextResponse(
          attempt.provider,
          {
            model: attempt.model,
            instructions: [
              "Você pesquisa informações nutricionais de produtos alimentícios e bebidas industrializados com marca.",
              "Use busca na internet e aceite somente fonte específica e verificável para o mesmo produto, marca, variante e porção.",
              "Não use média genérica nem outra marca/variante; em caso de dúvida retorne found=false.",
              "Retorne apenas JSON válido no schema solicitado.",
            ].join("\n"),
            input: [{
              role: "user",
              content: [{
                type: "input_text",
                text: [
                  `Produto reconhecido: ${foodName}`,
                  "Busque calorias, proteínas, carboidratos e gorduras para a porção indicada.",
                  "sourceUrl deve apontar para a fonte usada e evidence deve resumir a evidência verificável.",
                ].join("\n"),
              }],
            }],
            tools: [{ type: "web_search" }],
            format: {
              type: "json_schema",
              name: "branded_food_nutrition_lookup",
              schema: searchedNutritionJsonSchema,
              strict: true,
            },
          },
          { signal: attempt.signal },
        );
        return { parsed: parseProviderOutput(response.outputText), webSearch: response.webSearch };
      },
    );
    const candidate = toCatalogFood(foodName, execution.value.parsed, execution.value.webSearch);
    if (!candidate) return null;
    if (!runtime.persistence) return candidate;
    try {
      return await runtime.persistence.save(foodName, candidate) ?? candidate;
    } catch {
      return candidate;
    }
  } catch {
    return null;
  }
}