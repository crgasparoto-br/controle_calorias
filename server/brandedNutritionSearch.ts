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

function extractMeasures(value: string): CommercialMeasure[] {
  const normalized = normalizeText(value);
  const measures: CommercialMeasure[] = [];
  for (const match of normalized.matchAll(/\b(\d+(?:[,.]\d+)?)\s*(kg|mg|ml|g|l)\b/g)) {
    const amount = Number(match[1].replace(",", "."));
    if (!Number.isFinite(amount)) continue;
    switch (match[2]) {
      case "kg": measures.push({ kind: "mass", value: amount * 1000 }); break;
      case "mg": measures.push({ kind: "mass", value: amount / 1000 }); break;
      case "g": measures.push({ kind: "mass", value: amount }); break;
      case "l": measures.push({ kind: "volume", value: amount * 1000 }); break;
      default: measures.push({ kind: "volume", value: amount });
    }
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

function allNumbers(value: string) {
  return [...normalizeText(value).matchAll(/\b\d+(?:[,.]\d+)?\b/g)]
    .map(match => Number(match[0].replace(",", ".")))
    .filter(Number.isFinite);
}

function numericEvidenceSupportsResult(text: string, result: SearchedNutritionResult) {
  const values = allNumbers(text);
  return [result.gramsPerServing, result.calories, result.protein, result.carbs, result.fat]
    .every(expected => values.some(actual => approximatelyEqual(actual, expected)));
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

function findVerifiedSource(
  webSearch: AiWebSearchResult | undefined,
  foodName: string,
  result: SearchedNutritionResult,
) {
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
    const evidenceText = [result.evidence, ...(source.supportingText ?? [])].join(" ");
    if (!numericEvidenceSupportsResult(evidenceText, result)) continue;
    if (!sourceSupportsCommercialIdentity(source, foodName, result)) continue;
    return source.url.trim();
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
  const sourceUrl = findVerifiedSource(webSearch, foodName, result);
  if (!sourceUrl || !result.evidence.trim()) return null;
  return {
    slug: `web-nutrition-${normalizeText(result.matchedProductName).replace(/\s+/g, "-") || "product"}`,
    name: result.matchedProductName.trim(),
    aliases: [foodName, result.matchedProductName.trim(), `fonte: ${sourceUrl}`],
    productVariant: extractCommercialVariant(result.matchedProductName),
    variants: [result.matchedProductName.trim()],
    sourceUrls: [sourceUrl],
    sourceEvidence: result.evidence.trim(),
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
