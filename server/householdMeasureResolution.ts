import { executeResolvedCapability, type ResolvedCapabilityAttemptContext } from "./_core/ai/capabilityExecutor";
import { resolveCapabilityConfig } from "./_core/ai/configResolver";
import { createDomainTextResponse } from "./_core/ai/domainTextResponse";
import { AiOperationalError } from "./_core/ai/policyExecutor";
import type { AiWebSearchResult } from "./_core/aiProvider";
import { findCatalogFood } from "./catalogMatching";
import { hasFoodIdentityLexemes, isFoodIdentitySemanticallyCompatible } from "./foodSemanticCompatibility";
import {
  loadPersistedHouseholdMeasureResolution,
  persistHouseholdMeasureResolution,
  type PersistedHouseholdMeasureKind,
  type PersistedHouseholdMeasureResolution,
} from "./householdMeasureResolutionStore";
import {
  extractExplicitQuantities,
  parseQuantityUnitFromPortionText,
} from "./mealTextParsing";
import type { CatalogFood } from "./nutritionEngineTypes";
import { isPersistedProductIdentityCompatible } from "./commercialProductIdentity";
import { normalizeMeasurementUnit } from "../shared/measurementUnits";
import {
  convertFoodPortionToGrams,
  getGlobalFoodCatalogItem,
  searchGlobalFoodCatalog,
} from "./modules/foods/service";
import {
  classifyNutritionSearchOperationalOutcome,
  createNutritionSearchTrace,
  logNutritionSearchDecision,
  nutritionSearchSourceCount,
  type NutritionSearchTelemetryContext,
} from "./nutritionSearchDecisionTelemetry";

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
const AMBIGUOUS_CONTEXTUAL_MEASURE_UNITS = new Set([
  "porcao",
  "pedaco",
  "pacote",
  "punhado",
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
  | "user_learned"
  | "usual_average"
  | "contextual_estimate";

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
  variant?: string | null;
  context?: string | null;
  portionLabel?: string | null;
  /**
   * Canonical natural-food base used only to broaden quantity research.
   * It must never replace foodName or prove brand/cultivar identity.
   */
  quantityReferenceFoodName?: string | null;
  quantity: number;
  unit: string;
  /** Identity already accepted by the canonical nutrition resolver. */
  commercialFood?: CatalogFood;
  /** Correlation shared with the single commercial nutrition search attempt. */
  nutritionSearchTelemetry?: NutritionSearchTelemetryContext;
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
  loadPersistedHouseholdMeasureResolution?: typeof loadPersistedHouseholdMeasureResolution;
  persistHouseholdMeasureResolution?: typeof persistHouseholdMeasureResolution;
};

const defaultRuntime: HouseholdMeasureResolutionRuntime = {
  searchGlobalFoodCatalog,
  getGlobalFoodCatalogItem,
  convertFoodPortionToGrams,
  resolveCapabilityConfig,
  executeResolvedCapability,
  createDomainTextResponse,
  loadPersistedHouseholdMeasureResolution,
  persistHouseholdMeasureResolution,
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

export function isApproximateHouseholdMeasureResolutionKind(kind: HouseholdMeasureResolutionKind) {
  return kind === "usual_average" || kind === "contextual_estimate" || kind === "user_learned";
}

export function householdMeasureResolutionSourceLabel(kind: HouseholdMeasureResolutionKind) {
  switch (kind) {
    case "researched_exact":
      return "medida verificada";
    case "canonical_portion":
      return "porção canônica";
    case "user_learned":
      return "referência pessoal anterior";
    case "usual_average":
      return "média usual estimada";
    case "contextual_estimate":
      return "estimativa contextual";
  }
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

function requestedIdentity(input: HouseholdMeasureResolutionInput) {
  return [input.foodName, input.brand].filter(Boolean).join(" ");
}

function explicitBrandMatches(input: HouseholdMeasureResolutionInput, candidate: CatalogSearchResult | CatalogItem) {
  const requestedBrand = normalize(input.brand ?? "");
  if (!requestedBrand) return true;
  return normalize(candidate.brandName ?? "") === requestedBrand;
}

function resolveStaticCatalogPortion(
  input: HouseholdMeasureResolutionInput,
): HouseholdMeasureResolution | null {
  const food = findCatalogFood(requestedIdentity(input), input.userId);
  if (!food?.servingLabel || !food.gramsPerServing) return null;

  const requestedBrand = normalize(input.brand ?? "");
  if (requestedBrand && normalize(food.brandName ?? "") !== requestedBrand) return null;

  const serving = parseQuantityUnitFromPortionText(food.servingLabel);
  if (!serving?.quantity || !serving.unit) return null;
  if (normalizeCountableUnit(serving.unit) !== normalizeCountableUnit(input.unit)) return null;

  const grams = (food.gramsPerServing * input.quantity) / serving.quantity;
  if (!Number.isFinite(grams) || grams <= 0) return null;

  return {
    kind: "canonical_portion",
    grams: Number(grams.toFixed(2)),
    requestedQuantity: input.quantity,
    requestedUnit: normalizeCountableUnit(input.unit),
    evidence: `${food.servingLabel} = ${food.gramsPerServing} g`,
    sourceUrls: [],
    referenceCount: 1,
  };
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
      if (!isFoodIdentitySemanticallyCompatible(requestedIdentity(input), [candidateIdentity(candidate)])) continue;
      const food = await runtime.getGlobalFoodCatalogItem(input.userId, candidate.id);
      if (!isFoodIdentitySemanticallyCompatible(requestedIdentity(input), [candidateIdentity(food)])) continue;
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

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedEvidenceText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function numberPattern(value: number, includeOneWords = false) {
  const rounded = Number(value.toFixed(2));
  const numeric = Number.isInteger(rounded)
    ? `${rounded}(?:[.,]0+)?`
    : String(rounded).replace(".", "[.,]");
  if (includeOneWords && rounded === 1) return `(?:${numeric}|um|uma)`;
  return `(?:${numeric})`;
}

function measureUnitPattern(value: string) {
  const normalized = normalize(normalizeCountableUnit(value));
  const words = normalized.split(/\s+/).filter(Boolean);
  if (!words.length) return "";
  const pluralWords = [...words];
  const first = words[0];
  pluralWords[0] = first.endsWith("r") ? `${first}es` : `${first}s`;
  return [...new Set([normalized, pluralWords.join(" ")])]
    .map(escapeRegExp)
    .join("|");
}

function evidenceSupportsMeasureRelation(text: string, reference: PortionReference) {
  const evidence = normalizedEvidenceText(text);
  const unit = measureUnitPattern(reference.measureUnit);
  if (!unit) return false;
  const quantity = numberPattern(reference.measureQuantity, true);
  const grams = numberPattern(reference.grams);
  const measure = `${quantity}\\s*(?:${unit})`;
  const mass = `${grams}\\s*(?:g|gr|grama|gramas)`;
  const relationVerb = "(?:pesa(?:m)?|corresponde(?:m)?(?:\\s+a)?|equivale(?:m)?(?:\\s+a)?|representa(?:m)?|tem|contem|mede(?:m)?)";
  const approximation = "(?:\\s+(?:aproximadamente|aprox|cerca\\s+de|em\\s+media|na\\s+media))?";
  const forward = new RegExp(
    `\\b${measure}\\b[^\\n.;!?]{0,100}?\\b${relationVerb}\\b${approximation}\\s*\\b${mass}\\b`,
    "i",
  );
  const compact = new RegExp(`\\b${measure}\\b\\s*(?:=|:|-)\\s*\\b${mass}\\b`, "i");
  const parenthetical = new RegExp(
    `\\b${measure}\\b[^\\n.;!?()]{0,80}\\(\\s*${mass}\\s*\\)`,
    "i",
  );
  const reverse = new RegExp(`\\b${mass}\\b\\s*(?:por|para|/|=)\\s*\\b${measure}\\b`, "i");
  const reverseParenthetical = new RegExp(
    `\\b${mass}\\b[^\\n.;!?()]{0,80}\\(\\s*${measure}\\s*\\)`,
    "i",
  );
  return forward.test(evidence)
    || compact.test(evidence)
    || parenthetical.test(evidence)
    || reverse.test(evidence)
    || reverseParenthetical.test(evidence);
}

function evidenceSupportsTypicalMeasure(text: string) {
  const evidence = normalizedEvidenceText(text);
  return /\b(?:media|medio|usual|tipic[oa]s?|normalmente|geralmente)\b/.test(evidence);
}

function sourceContainsBrand(sourceText: string, brand: string | null | undefined) {
  const normalizedBrand = normalizeFoodLexemes(brand ?? "");
  if (!normalizedBrand) return true;
  return ` ${normalizeFoodLexemes(sourceText)} `.includes(` ${normalizedBrand} `);
}

function semanticEvidenceSpans(value: string) {
  return value
    .split(/[\n;!?]+|(?<!\d)\.(?!\d)/u)
    .map(span => span.trim())
    .filter(Boolean);
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

function referenceFoodIdentityIsSupported(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
  sourceText: string,
) {
  const identity = [reference.matchedFoodName, reference.brandName, reference.foodTypeName]
    .filter(Boolean)
    .join(" ");

  if (reference.referenceKind === "exact_product") {
    if (
      input.commercialFood &&
      !isPersistedProductIdentityCompatible({
        foodName: input.commercialFood.name,
        matchedProductName: reference.matchedFoodName,
        brandName: reference.brandName,
        servingLabel: `${reference.measureQuantity} ${reference.measureUnit}`,
        gramsPerServing: reference.grams,
      })
    )
      return false;
    const requested = requestedIdentity(input);
    if (!isFoodIdentitySemanticallyCompatible(requested, [identity])) return false;
    if (!isFoodIdentitySemanticallyCompatible(requested, [sourceText])) return false;
    if (!sourceContainsBrand(sourceText, input.brand)) return false;
    return true;
  }

  if (!sameFoodTypeIsSupported(input, reference)) return false;
  if (!isFoodIdentitySemanticallyCompatible(reference.foodTypeName, [identity])) return false;
  return isFoodIdentitySemanticallyCompatible(reference.foodTypeName, [sourceText]);
}

function evidenceSpanSupportsReference(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
  span: string,
  identityContext?: string,
) {
  if (!evidenceSupportsMeasureRelation(span, reference)) return false;
  const identityText = hasFoodIdentityLexemes(span)
    ? span
    : [identityContext ?? "", span].filter(Boolean).join(" ");
  if (!identityText || !referenceFoodIdentityIsSupported(input, reference, identityText)) return false;
  if (reference.referenceKind === "same_food_type" && reference.describesTypicalMeasure) {
    if (!evidenceSupportsTypicalMeasure(span)) return false;
  }
  return true;
}

function evidenceFragmentSupportsReference(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
  fragment: string,
  outerIdentityContext?: string,
) {
  const spans = semanticEvidenceSpans(fragment);
  return spans.some((span, index) => {
    const precedingSpan = index > 0 ? spans[index - 1] : "";
    const identityContext = [outerIdentityContext ?? "", precedingSpan].filter(Boolean).join(" ");
    return evidenceSpanSupportsReference(input, reference, span, identityContext);
  });
}

function sourceSupportsReferenceEvidence(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
  source: NonNullable<ReturnType<typeof sourceForReference>>,
) {
  const title = source.title?.trim() ?? "";
  const supportingText = Array.isArray(source.supportingText) ? source.supportingText : [];
  return supportingText.some(fragment =>
    evidenceFragmentSupportsReference(input, reference, fragment, title)
  );
}

function structuredEvidenceSupportsReference(
  input: HouseholdMeasureResolutionInput,
  reference: PortionReference,
) {
  const evidence = reference.evidence.trim();
  if (!evidence) return true;
  return evidenceFragmentSupportsReference(input, reference, evidence);
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
  if (!sourceSupportsReferenceEvidence(input, reference, source)) return false;
  if (!structuredEvidenceSupportsReference(input, reference)) return false;

  if (reference.referenceKind === "exact_product") {
    const requestedBrand = normalize(input.brand ?? "");
    if (requestedBrand && normalize(reference.brandName) !== requestedBrand) return false;
  }

  return true;
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

function uniqueReferencesBySource(references: PortionReference[]) {
  const seen = new Set<string>();
  return references.filter(reference => {
    const source = normalizeHttpUrl(reference.sourceUrl);
    if (!source || seen.has(source)) return false;
    seen.add(source);
    return true;
  });
}

function supportsContextualEstimate(input: HouseholdMeasureResolutionInput) {
  const normalizedUnit = normalize(normalizeCountableUnit(input.unit));
  if (AMBIGUOUS_CONTEXTUAL_MEASURE_UNITS.has(normalizedUnit)) return false;
  return hasFoodIdentityLexemes(input.foodName);
}

function buildSearchResolution(
  input: HouseholdMeasureResolutionInput,
  result: SearchedPortionResult,
  webSearch: AiWebSearchResult | undefined,
): {
  resolution: HouseholdMeasureResolution | null;
  reason: Parameters<typeof logNutritionSearchDecision>[0]["reason"];
  guards: Parameters<typeof logNutritionSearchDecision>[0]["guards"];
} {
  const baseGuards = {
    productIdentity: false,
    brandIdentity: false,
    variant: false,
    portion: false,
    numericGrounding: false,
    sourceGrounding: false,
  };
  if (!result.found) return { resolution: null, reason: "found_false", guards: baseGuards };
  const verified = result.references.filter(reference => verifiedReference(input, reference, webSearch));
  const exact = uniqueReferencesBySource(
    verified.filter(reference => reference.referenceKind === "exact_product"),
  );
  if (exact.length) {
    const values = exact.map(reference => gramsForRequestedQuantity(reference, input.quantity));
    if (exact.length >= MIN_MULTISOURCE_REFERENCES && !averageIsCoherent(values)) {
      return {
        resolution: null,
        reason: "grounding_conflict",
        guards: {
          productIdentity: true,
          brandIdentity: Boolean(input.brand),
          variant: true,
          portion: true,
          numericGrounding: true,
          sourceGrounding: true,
        },
      };
    }
    const selected = exact[0];
    return {
      resolution: {
        kind: "researched_exact",
        grams: Number(gramsForRequestedQuantity(selected, input.quantity).toFixed(2)),
        requestedQuantity: input.quantity,
        requestedUnit: normalizeCountableUnit(input.unit),
        evidence: selected.evidence.trim() || null,
        sourceUrls: [selected.sourceUrl],
        referenceCount: 1,
      },
      reason: "accepted",
      guards: {
        productIdentity: true,
        brandIdentity: Boolean(input.brand),
        variant: true,
        portion: true,
        numericGrounding: true,
        sourceGrounding: true,
      },
    };
  }

  if (input.commercialFood) {
    return {
      resolution: null,
      reason: "portion_incompatible",
      guards: {
        productIdentity: true,
        brandIdentity: Boolean(input.brand),
        variant: true,
        portion: false,
        numericGrounding: true,
        sourceGrounding: true,
      },
    };
  }
  const usual = uniqueReferencesBySource(
    verified.filter(reference => reference.referenceKind === "same_food_type"),
  );
  if (usual.length === 1) {
    const selected = usual[0];
    if (!selected.describesTypicalMeasure && !supportsContextualEstimate(input)) {
      return {
        resolution: null,
        reason: "portion_incompatible",
        guards: {
          productIdentity: true,
          brandIdentity: Boolean(input.brand),
          variant: true,
          portion: false,
          numericGrounding: true,
          sourceGrounding: true,
        },
      };
    }
    return {
      resolution: {
        kind: selected.describesTypicalMeasure ? "usual_average" : "contextual_estimate",
        grams: Number(gramsForRequestedQuantity(selected, input.quantity).toFixed(2)),
        requestedQuantity: input.quantity,
        requestedUnit: normalizeCountableUnit(input.unit),
        evidence: selected.evidence.trim() || null,
        sourceUrls: [selected.sourceUrl],
        referenceCount: 1,
      },
      reason: "accepted",
      guards: {
        productIdentity: true,
        brandIdentity: Boolean(input.brand),
        variant: true,
        portion: true,
        numericGrounding: true,
        sourceGrounding: true,
      },
    };
  }

  if (usual.length < MIN_MULTISOURCE_REFERENCES) {
    const reason = webSearch?.executed && webSearch.sources?.length
      ? "source_identity_mismatch"
      : "source_grounding_unavailable";
    return { resolution: null, reason, guards: baseGuards };
  }
  const values = usual.map(reference => gramsForRequestedQuantity(reference, input.quantity));
  if (!averageIsCoherent(values)) {
    return {
      resolution: null,
      reason: "grounding_conflict",
      guards: {
        productIdentity: true,
        brandIdentity: Boolean(input.brand),
        variant: true,
        portion: true,
        numericGrounding: true,
        sourceGrounding: true,
      },
    };
  }
  const grams = median(values);
  return {
    resolution: {
      kind: "usual_average",
      grams: Number(grams.toFixed(2)),
      requestedQuantity: input.quantity,
      requestedUnit: normalizeCountableUnit(input.unit),
      evidence: usual.map(reference => reference.evidence.trim()).filter(Boolean).join(" | ") || null,
      sourceUrls: usual.map(reference => reference.sourceUrl),
      referenceCount: usual.length,
    },
    reason: "accepted",
    guards: {
      productIdentity: true,
      brandIdentity: Boolean(input.brand),
      variant: true,
      portion: true,
      numericGrounding: true,
      sourceGrounding: true,
    },
  };
}

async function searchVerifiedMeasure(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime,
): Promise<HouseholdMeasureResolution | null> {
  const trace = createNutritionSearchTrace(input.nutritionSearchTelemetry ?? {
    userId: input.userId,
    origin: "system",
  });
  const baseDecision = {
    stage: "household_measure" as const,
    traceId: trace.traceId,
    hasStructuredCandidate: false,
    webSearchExecuted: false,
    sourceCount: 0,
    guards: {
      productIdentity: false,
      brandIdentity: false,
      variant: false,
      portion: false,
      numericGrounding: false,
      sourceGrounding: false,
    },
  };
  const policy = runtime.resolveCapabilityConfig("NUTRITION_SEARCH");
  if (policy.state === "disabled" || policy.state === "invalid" || !policy.primary) {
    logNutritionSearchDecision({ ...baseDecision, reason: "capability_unavailable" }, trace);
    return null;
  }
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
              "Para referenceKind=same_food_type, outra marca ou qualificador pode contribuir somente como referência de quantidade do mesmo alimento/tipo/preparo; nunca a apresente como produto exato.",
              "Quando houver uma referência canônica do alimento-base para quantidade, use-a apenas para ampliar a pesquisa de same_food_type; ela não confirma cultivar, marca nem identidade exata.",
              "describesTypicalMeasure=true somente quando a fonte declarar explicitamente média, usual, típica ou equivalente.",
              "Não invente gramatura e não use categoria ampla quando o alimento específico estiver identificado.",
              "Cada evidência deve sustentar explicitamente a relação entre quantidade, unidade da medida e gramatura retornadas.",
              "Aceite também rótulos em que a massa aparece antes da medida, por exemplo 'Porção de 40 g (2 fatias)'.",
              "Retorne referências independentes; não duplique a mesma fonte para fabricar uma média.",
              "Retorne apenas JSON válido no schema solicitado.",
            ].join("\n"),
            input: [{
              role: "user",
              content: [{
                type: "input_text",
                text: [
                  `Alimento informado: ${input.foodName}`,
                  input.brand ? `Marca/variante informada: ${input.brand}` : "Marca/variante informada: não especificada",
                  input.quantityReferenceFoodName
                    ? `Referência canônica do alimento-base para pesquisa exclusiva de quantidade: ${input.quantityReferenceFoodName}`
                    : "Referência canônica do alimento-base para quantidade: não disponível",
                  `Medida: ${input.quantity} ${input.unit}`,
                  "Busque a gramatura dessa medida. Cada referência deve citar URL e evidência verificável com quantidade, unidade e gramatura da mesma relação física.",
                ].join("\n"),
              }],
            }],
            tools: [{ type: "web_search" }],
            toolChoice: "required",
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
      { observability: trace.observability },
    );
    const decision = buildSearchResolution(input, execution.value.parsed, execution.value.webSearch);
    logNutritionSearchDecision({
      ...baseDecision,
      reason: decision.reason,
      hasStructuredCandidate: execution.value.parsed.found,
      webSearchExecuted: Boolean(execution.value.webSearch?.executed),
      sourceCount: execution.value.webSearch?.executed
        ? nutritionSearchSourceCount(execution.value.webSearch.sources)
        : 0,
      guards: decision.guards,
    }, trace);
    return decision.resolution;
  } catch (error) {
    logNutritionSearchDecision({
      ...baseDecision,
      reason: "execution_failed",
      operationalOutcome: classifyNutritionSearchOperationalOutcome(error),
    }, trace);
    return null;
  }
}

function resolutionFromPersisted(
  input: HouseholdMeasureResolutionInput,
  record: PersistedHouseholdMeasureResolution,
): HouseholdMeasureResolution {
  const grams = (record.grams * input.quantity) / record.measureQuantity;
  return {
    kind: record.kind,
    grams: Number(grams.toFixed(2)),
    requestedQuantity: input.quantity,
    requestedUnit: normalizeCountableUnit(input.unit),
    evidence: record.evidence,
    sourceUrls: [...record.sourceUrls],
    referenceCount: record.referenceCount,
  };
}

async function resolvePersistedByPrecedence(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime,
) {
  const loader = runtime.loadPersistedHouseholdMeasureResolution;
  if (!loader) return null;
  const kinds: PersistedHouseholdMeasureKind[] = [
    "researched_exact",
    "user_learned",
    "usual_average",
    "contextual_estimate",
  ];
  const record = await loader(input, kinds);
  return record ? resolutionFromPersisted(input, record) : null;
}

async function persistReusableResolution(
  input: HouseholdMeasureResolutionInput,
  resolution: HouseholdMeasureResolution,
  runtime: HouseholdMeasureResolutionRuntime,
) {
  if (resolution.kind === "canonical_portion" || resolution.kind === "user_learned") return;
  const persist = runtime.persistHouseholdMeasureResolution;
  if (!persist) return;
  await persist({
    ...input,
    kind: resolution.kind,
    grams: resolution.grams,
    evidence: resolution.evidence,
    sourceUrls: resolution.sourceUrls,
    referenceCount: resolution.referenceCount,
  });
}

export async function resolveHouseholdMeasure(
  input: HouseholdMeasureResolutionInput,
  runtime: HouseholdMeasureResolutionRuntime = defaultRuntime,
): Promise<HouseholdMeasureResolution | null> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;
  const normalizedUnit = normalizeCountableUnit(input.unit);
  if (["mg", "g", "kg", "ml", "l"].includes(normalizedUnit)) return null;

  const normalizedInput = {
    ...input,
    unit: normalizedUnit,
    variant: input.variant ?? input.commercialFood?.productVariant ?? null,
    portionLabel: input.portionLabel ?? input.commercialFood?.servingLabel ?? null,
  };
  if (input.commercialFood) {
    const food = input.commercialFood;
    const labelQuantities = extractExplicitQuantities(food.servingLabel);
    const measures = labelQuantities.filter(
      item => normalizeCountableUnit(item.unit) === normalizedUnit
    );
    const masses = labelQuantities.filter(item =>
      ["mg", "g", "kg"].includes(item.unit)
    );
    const serving =
      measures.length === 1 &&
      masses.every(
        item =>
          item.estimatedGrams !== undefined &&
          Math.abs(item.estimatedGrams - food.gramsPerServing) <= 0.05
      )
        ? measures[0]
        : null;
    const commercialServingReference: PortionReference | null = serving
      ? {
          matchedFoodName: food.name,
          foodTypeName: food.name,
          brandName: food.brandName ?? input.brand ?? "",
          measureUnit: serving.unit,
          measureQuantity: serving.quantity,
          grams: food.gramsPerServing,
          referenceKind: "exact_product",
          describesTypicalMeasure: false,
          sourceUrl: food.sourceUrls?.[0] ?? "",
          evidence: food.sourceEvidence ?? "",
        }
      : null;
    const sourceProvesResearchedServing = !food.researchIdentityKey || Boolean(
      commercialServingReference &&
      food.sourceEvidence?.trim() &&
      evidenceSupportsMeasureRelation(food.sourceEvidence, commercialServingReference)
    );
    if (
      serving?.quantity &&
      serving.unit &&
      normalizeCountableUnit(serving.unit) === normalizedUnit &&
      Number.isFinite(food.gramsPerServing) &&
      food.gramsPerServing > 0 &&
      sourceProvesResearchedServing
    ) {
      const trace = createNutritionSearchTrace(input.nutritionSearchTelemetry ?? {
        userId: input.userId,
        origin: "system",
      });
      logNutritionSearchDecision({
        stage: "household_measure",
        reason: "accepted",
        traceId: trace.traceId,
        hasStructuredCandidate: true,
        webSearchExecuted: false,
        sourceCount: 0,
        guards: {
          productIdentity: true,
          brandIdentity: true,
          variant: true,
          portion: true,
          numericGrounding: true,
          sourceGrounding: Boolean(food.sourceEvidence?.trim()),
        },
      }, trace);
      return {
        kind: food.researchIdentityKey
          ? "researched_exact"
          : "canonical_portion",
        grams: Number(
          ((food.gramsPerServing * input.quantity) / serving.quantity).toFixed(
            2
          )
        ),
        requestedQuantity: input.quantity,
        requestedUnit: normalizedUnit,
        evidence:
          food.sourceEvidence ??
          `${food.servingLabel} = ${food.gramsPerServing} g`,
        sourceUrls: [...(food.sourceUrls ?? [])],
        referenceCount: 1,
      };
    }
    // A provider servingLabel is not evidence by itself. The identity search
    // already consumed the single NUTRITION_SEARCH operation for this item;
    // without a source-derived countable relation, remain fail-closed instead
    // of issuing a second search with the same commercial identity.
    const trace = createNutritionSearchTrace(input.nutritionSearchTelemetry ?? {
      userId: input.userId,
      origin: "system",
    });
    logNutritionSearchDecision({
      stage: "household_measure",
      reason: "portion_incompatible",
      traceId: trace.traceId,
      hasStructuredCandidate: true,
      webSearchExecuted: false,
      sourceCount: 0,
      guards: {
        productIdentity: true,
        brandIdentity: true,
        variant: true,
        portion: false,
        numericGrounding: true,
        sourceGrounding: Boolean(food.sourceEvidence?.trim()),
      },
    }, trace);
    return null;
  }
  const stored = await resolveStoredPortion(normalizedInput, runtime);
  if (stored) return stored;

  const staticCatalog = resolveStaticCatalogPortion(normalizedInput);
  if (staticCatalog) return staticCatalog;

  const persisted = await resolvePersistedByPrecedence(normalizedInput, runtime);
  if (persisted) return persisted;

  const researched = await searchVerifiedMeasure(normalizedInput, runtime);
  if (!researched) return null;
  await persistReusableResolution(normalizedInput, researched, runtime);
  return researched;
}
