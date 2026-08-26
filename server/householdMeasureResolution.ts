import { executeResolvedCapability, type ResolvedCapabilityAttemptContext } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./_core/ai/configResolver";
import { createDomainTextResponse } from "./_core/ai/domainTextResponse";
import { AiOperationalError } from "./_core/ai/policyExecutor";
import type { AiWebSearchResult } from "./_core/aiProvider";
import { isFoodCandidateSemanticallyCompatible } from "./foodSemanticCompatibility";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";
import {
  convertFoodPortionToGrams,
  getGlobalFoodCatalogItem,
  searchGlobalFoodCatalog,
} from "./modules/foods/service";

const MAX_REFERENCE_SPREAD_RATIO = 0.35;
const MIN_MULTISOURCE_REFERENCES = 2;
const BROAD_FOOD_TYPE_TOKENS = new Set([
  "alimento",
  "produto",
  "queijo",
  "carne",
  "embutido",
  "laticinio",
]);
const PHYSICAL_PREPARATION_QUALIFIERS = [
  "light",
  "zero",
  "integral",
  "desnatado",
  "sem lactose",
  "frito",
  "frita",
  "assado",
  "assada",
  "cozido",
  "cozida",
  "defumado",
  "defumada",
  "fatiado",
  "fatiada",
];

type PortionReferenceKind = "exact_product" | "same_food_type";

type PortionReference = {
  matchedFoodName: string;
  foodTypeName: string;
  brandName: string;
  measureUnit: string;
  measureQuantity: number;
  grams: number;
  referenceKind: PortionReferenceKind;
  describesTypicalMeasure: boolean;
  sourceUrl: string;
  evidence: string;
};

type SearchedPortionResult = {
  found: boolean;
  references: PortionReference[];
};

export type HouseholdMeasureResolutionKind =
  | "canonical_portion"
  | "researched_exact"
  | "usual_average";

export type HouseholdMeasureResolution = {
  kind: HouseholdMeasureResolutionKind;
  grams: number;
  requestedQuantity: number;
  requestedUnit: string;
  evidence: string | null;
  sourceUrls: string[];
  referenceCount: number;
};

export type HouseholdMeasureResolutionInput = {
  userId: number;
  foodName: string;
  brand?: string | null;
  quantity: number;
  unit: string;
};

type CatalogSearchResult = Awaited<ReturnType<typeof searchGlobalFoodCatalog>>[number];
type CatalogItem = Awaited<ReturnType<typeof getGlobalFoodCatalogItem>>;

type HouseholdMeasureResolutionRuntime = {
  searchGlobalFoodCatalog: typeof searchGlobalFoodCatalog;
  getGlobalFoodCatalogItem: typeof getGlobalFoodCatalogItem;
  convertFoodPortionToGrams: typeof convertFoodPortionToGrams;
  resolveCapabilityConfig: typeof resolveCapabilityConfig;
  executeResolvedCapability: typeof executeResolvedCapability;
  createDomainTextResponse: typeof createDomainTextResponse;
};

const defaultRuntime: HouseholdMeasureResolutionRuntime = {
  searchGlobalFoodCatalog,
  getGlobalFoodCatalogItem,
  convertFoodPortionToGrams,
  resolveCapabilityConfig,
  executeResolvedCapability,
  createDomainTextResponse,
};

const searchedPortionJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    found: { type: "boolean" },
    references: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          matchedFoodName: { type: "string" },
          foodTypeName: { type: "string" },
          brandName: { type: "string" },
          measureUnit: { type: "string" },
          measureQuantity: { type: "number", minimum: 0, maximum: 100 },
          grams: { type: "number", minimum: 0, maximum: 5000 },
          referenceKind: { type: "string", enum: ["exact_product", "same_food_type"] },
          describesTypicalMeasure: { type: "boolean" },
          sourceUrl: { type: "string" },
          evidence: { type: "string" },
        },
        required: [
          "matchedFoodName",
          "foodTypeName",
          "brandName",
          "measureUnit",
          "measureQuantity",
          "grams",
          "referenceKind",
          "describesTypicalMeasure",
          "sourceUrl",
          "evidence",
        ],
      },
    },
  },
  required: ["found", "references"],
} as const;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFoodLexemes(value: string) {
  return normalize(value)
    .replace(/\b(?:mucarela|mozarela|mussarela)\b/g, "mussarela")
    .replace(/\blaticinios?\b/g, "laticinio");
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

function normalizeCountableUnit(value: string) {
  const unit = normalizeMeasurementUnit(value);
  return unit === "un" ? "unidade" : unit;
}

function portionSupportsUnit(portion: { label: string; unit: string }, requestedUnit: string) {
  const requested = normalizeCountableUnit(requestedUnit);
  const direct = normalizeCountableUnit(portion.unit);
  const labelUnit = normalizeCountableUnit(
    portion.label.replace(/^\d+(?:[,.]\d+)?\s*/u, ""),
  );
  return direct === requested || labelUnit === requested;
}

function candidateIdentity(candidate: CatalogSearchResult | CatalogItem) {
  return [candidate.name, candidate.brandName ?? ""].filter(Boolean).join(" ");
}

function explicitBrandMatches(input: HouseholdMeasureResolutionInput, candidate: CatalogSearchResult | CatalogItem) {
  const requestedBrand = normalize(input.brand ?? "");
  if (!requestedBrand) return true;
  return normalize(candidate.brandName ?? "") === requestedBrand;
}

async function resolveStoredPortion(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime,
): Promise<HouseholdMeasureResolution | null> {
  try {
    const candidates = await runtime.searchGlobalFoodCatalog(input.userId, {
      query: [input.foodName, input.brand].filter(Boolean).join(" "),
      limit: 10,
      includeInactive: false,
    });
    for (const candidate of candidates) {
      if (!explicitBrandMatches(input, candidate)) continue;
      if (!isFoodCandidateSemanticallyCompatible(input.foodName, [candidateIdentity(candidate)])) continue;
      const food = await runtime.getGlobalFoodCatalogItem(input.userId, candidate.id);
      const portions = food.portions.filter(portion => portionSupportsUnit(portion, input.unit));
      if (portions.length !== 1) continue;
      const portion = portions[0];
      const converted = await runtime.convertFoodPortionToGrams(input.userId, {
        foodId: food.id,
        portionId: portion.id,
        quantity: input.quantity,
      });
      if (!Number.isFinite(converted.grams) || converted.grams <= 0) continue;
      return {
        kind: "canonical_portion",
        grams: converted.grams,
        requestedQuantity: input.quantity,
        requestedUnit: normalizeCountableUnit(input.unit),
        evidence: `${portion.label} = ${portion.grams} g para ${portion.quantity} ${portion.unit}`,
        sourceUrls: [],
        referenceCount: 1,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function parseProviderOutput(outputText: string): SearchedPortionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch (error) {
    throw new AiOperationalError("Household measure provider returned invalid JSON", error, "invalid_json");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiOperationalError("Household measure provider returned invalid payload", undefined, "invalid_payload");
  }
  const result = parsed as Partial<SearchedPortionResult>;
  if (result.found === false) return { found: false, references: [] };
  if (result.found !== true || !Array.isArray(result.references)) {
    throw new AiOperationalError("Household measure provider omitted references", undefined, "invalid_payload");
  }
  return { found: true, references: result.references };
}

function sourceForReference(webSearch: AiWebSearchResult | undefined, reference: PortionReference) {
  if (!webSearch?.executed || !Array.isArray(webSearch.sources)) return null;
  const requested = normalizeHttpUrl(reference.sourceUrl);
  if (!requested) return null;
  return webSearch.sources.find(source => normalizeHttpUrl(source.url) === requested) ?? null;
}

function evidenceContainsGrams(text: string, grams: number) {
  const normalizedText = text.replace(",", ".");
  const rounded = Number(grams.toFixed(2));
  const values = [...normalizedText.matchAll(/\b\d+(?:\.\d+)?\b/g)]
    .map(match => Number(match[0]))
    .filter(Number.isFinite);
  return values.some(value => Math.abs(value - rounded) <= Math.max(0.05, rounded * 0.01));
}

function sameFoodTypeIsSupported(input: HouseholdMeasureResolutionInput, reference: PortionReference) {
  const requested = normalizeFoodLexemes(input.foodName);
  const type = normalizeFoodLexemes(reference.foodTypeName);
  const referenceIdentity = normalizeFoodLexemes(`${reference.foodTypeName} ${reference.matchedFoodName}`);
  if (!requested || !type) return false;

  const typeTokens = type.split(/\s+/).filter(token => token.length >= 3);
  if (!typeTokens.length || typeTokens.every(token => BROAD_FOOD_TYPE_TOKENS.has(token))) return false;
  if (!typeTokens.every(token => requested.includes(token))) return false;

  const requestedQualifiers = PHYSICAL_PREPARATION_QUALIFIERS.filter(qualifier => requested.includes(qualifier));
  return requestedQualifiers.every(qualifier => referenceIdentity.includes(qualifier));
}

function verifiedReference(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
  webSearch: AiWebSearchResult | undefined,
) {
  if (!Number.isFinite(reference.grams) || reference.grams <= 0) return false;
  if (!Number.isFinite(reference.measureQuantity) || reference.measureQuantity <= 0) return false;
  if (normalizeCountableUnit(reference.measureUnit) !== normalizeCountableUnit(input.unit)) return false;
  const source = sourceForReference(webSearch, reference);
  if (!source) return false;
  const sourceText = [source.title ?? "", ...(source.supportingText ?? [])].join(" ");
  const evidence = [reference.evidence, sourceText].join(" ");
  if (!evidenceContainsGrams(evidence, reference.grams)) return false;

  if (reference.referenceKind === "exact_product") {
    const identity = [reference.matchedFoodName, reference.brandName, reference.foodTypeName]
      .filter(Boolean)
      .join(" ");
    if (!isFoodCandidateSemanticallyCompatible(input.foodName, [identity])) return false;
    const requestedBrand = normalize(input.brand ?? "");
    if (requestedBrand && normalize(reference.brandName) !== requestedBrand) return false;
    return true;
  }

  return sameFoodTypeIsSupported(input, reference);
}

function gramsForRequestedQuantity(reference: PortionReference, requestedQuantity: number) {
  return (reference.grams * requestedQuantity) / reference.measureQuantity;
}

function median(values: number[]) {
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function averageIsCoherent(values: number[]) {
  if (!values.length) return false;
  const center = median(values);
  if (!Number.isFinite(center) || center <= 0) return false;
  return Math.max(...values) - Math.min(...values) <= center * MAX_REFERENCE_SPREAD_RATIO;
}

function buildSearchResolution(
  input: HouseholdMeasureResolutionInput,
  result: SearchedPortionResult,
  webSearch: AiWebSearchResult | undefined,
): HouseholdMeasureResolution | null {
  if (!result.found) return null;
  const verified = result.references.filter(reference => verifiedReference(input, reference, webSearch));
  const exact = verified.filter(reference => reference.referenceKind === "exact_product");
  if (exact.length) {
    const selected = exact[0];
    return {
      kind: "researched_exact",
      grams: Number(gramsForRequestedQuantity(selected, input.quantity).toFixed(2)),
      requestedQuantity: input.quantity,
      requestedUnit: normalizeCountableUnit(input.unit),
      evidence: selected.evidence.trim() || null,
      sourceUrls: [selected.sourceUrl],
      referenceCount: 1,
    };
  }

  const usual = verified.filter(reference => reference.referenceKind === "same_food_type");
  const canUseSingleTypical = usual.length === 1 && usual[0].describesTypicalMeasure;
  const hasMultisourceBasis = usual.length >= MIN_MULTISOURCE_REFERENCES;
  if (!canUseSingleTypical && !hasMultisourceBasis) return null;

  const values = usual.map(reference => gramsForRequestedQuantity(reference, input.quantity));
  if (!averageIsCoherent(values)) return null;
  const grams = median(values);
  return {
    kind: "usual_average",
    grams: Number(grams.toFixed(2)),
    requestedQuantity: input.quantity,
    requestedUnit: normalizeCountableUnit(input.unit),
    evidence: usual.map(reference => reference.evidence.trim()).filter(Boolean).join(" | ") || null,
    sourceUrls: [...new Set(usual.map(reference => reference.sourceUrl))],
    referenceCount: usual.length,
  };
}

async function searchVerifiedMeasure(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime,
): Promise<HouseholdMeasureResolution | null> {
  const policy = runtime.resolveCapabilityConfig("NUTRITION_SEARCH");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) return null;
  try {
    const execution = await runtime.executeResolvedCapability(
      policy,
      async (attempt: ResolvedCapabilityAttemptContext) => {
        const response = await runtime.createDomainTextResponse(
          attempt.provider,
          {
            model: attempt.model,
            instructions: [
              "Você pesquisa peso verificável de medidas caseiras de alimentos.",
              "Pesquise apenas a mesma medida física e o mesmo alimento/tipo/preparo solicitado.",
              "Para referenceKind=exact_product, marca/variante e produto devem corresponder exatamente ao pedido.",
              "Para referenceKind=same_food_type, outra marca pode contribuir somente como referência de quantidade do mesmo alimento/tipo/preparo; nunca a apresente como produto exato.",
              "describesTypicalMeasure=true somente quando a fonte declarar explicitamente média, usual, típica ou equivalente.",
              "Não invente gramatura e não use categoria ampla quando o alimento específico estiver identificado.",
              "Retorne referências independentes; não duplique a mesma fonte para fabricar uma média.",
              "Retorne apenas JSON válido no schema solicitado.",
            ].join("\n"),
            input: [{
              role: "user",
              content: [{
                type: "input_text",
                text: [
                  `Alimento: ${input.foodName}`,
                  input.brand ? `Marca/variante informada: ${input.brand}` : "Marca/variante informada: não especificada",
                  `Medida: ${input.quantity} ${input.unit}`,
                  "Busque a gramatura dessa medida. Cada referência deve citar URL e evidência verificável que contenha a gramatura.",
                ].join("\n"),
              }],
            }],
            tools: [{ type: "web_search" }],
            format: {
              type: "json_schema",
              name: "household_measure_lookup",
              schema: searchedPortionJsonSchema,
              strict: true,
            },
          },
          { signal: attempt.signal },
        );
        return { parsed: parseProviderOutput(response.outputText), webSearch: response.webSearch };
      },
    );
    return buildSearchResolution(input, execution.value.parsed, execution.value.webSearch);
  } catch {
    return null;
  }
}

export async function resolveHouseholdMeasure(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime = defaultRuntime,
): Promise<HouseholdMeasureResolution | null> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const normalizedUnit = normalizeCountableUnit(input.unit);
  if (["mg", "g", "kg", "ml", "l"].includes(normalizedUnit)) return null;

  const stored = await resolveStoredPortion({ ...input, unit: normalizedUnit }, runtime);
  if (stored) return stored;
  return searchVerifiedMeasure({ ...input, unit: normalizedUnit }, runtime);
}
