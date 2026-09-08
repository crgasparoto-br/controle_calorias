import { findCatalogFoodSemantic } from "./catalogSemanticSearch";
import {
  findCatalogFood,
  isCatalogFoodSemanticallyCompatible,
  sourceMentionsFood,
} from "./catalogMatching";
import { getCatalogCache } from "./catalogRuntime";
import {
  extractCommercialVariant,
  isPersistedProductIdentityCompatible,
} from "./commercialProductIdentity";
import { detectKnownBrand } from "./foodBrandDetection";
import {
  buildCoffeeWithExplicitSugarItem,
  normalizeSweetenedCoffeeDraftItems,
  shouldRequestSugarQuantity,
} from "./coffeeSugarNutrition";
import { extractWithAi } from "./mealAiExtraction";
import { logMealInferenceFallback, type MealInferenceFallbackReason } from "./mealInferenceFallbackTelemetry";
import { resolveMealLabel } from "./mealLabelResolver";
import {
  applyExplicitQuantities,
  buildEstimatedNutritionFallbackItem,
  buildHybridItem,
  buildUnresolvedBrandedNutritionItem,
  buildItemFromCatalog,
  hasUsableNutrition,
  isResearchVerifiedCatalogFood,
} from "./mealItemBuilders";
import { cleanMealItems, fallbackFromText, sumTotals } from "./mealItemCleanup";
import { isGenericNutritionFallbackItem } from "./mealNutritionFallback";
import { buildMealSemanticContract } from "./mealSemanticContract";
import {
  extractExplicitQuantities,
  extractExplicitQuantityFoodSegments,
  formatFoodNameTitleCase,
  getQuantityExpressionClarification,
  normalizeForMatching,
  normalizeLlmItem,
  normalizeUnit,
} from "./mealTextParsing";
import { findTacoFood } from "./tacoLookup";
import type {
  BuildItemsOptions,
  CanonicalMealProcessingResult,
  CatalogFood,
  LlmItem,
  MealDraftItem,
  MealItemResolutionMetadata,
  MealProcessingInput,
  MealProcessingResult,
  MealSemanticAlternative,
  MealSemanticClarificationCode,
  MealSemanticContract,
} from "./nutritionEngineTypes";

export type {
  BuildItemsOptions,
  CanonicalMealProcessingResult,
  CatalogFood,
  ExplicitQuantity,
  HabitSnapshot,
  IntentHint,
  LlmItem,
  MealDraftItem,
  MealProcessingInput,
  MealProcessingResult,
  MealSemanticAlternative,
  MealSemanticContract,
  ParsedFoodText,
} from "./nutritionEngineTypes";

export { FOOD_CATALOG_REFERENCE } from "./foodCatalogReference";

export type MealInferenceErrorCode =
  | "food_component_quantity_required"
  | "food_identity_clarification_required"
  | "meal_inference_unavailable";

export type MealInferenceErrorContext = {
  component?: string;
  originalText?: string;
  acceptedUnits?: string[];
  foodName?: string;
  brand?: string | null;
  clarificationReason?: MealSemanticClarificationCode;
  alternatives?: MealSemanticAlternative[];
  semanticContract?: MealSemanticContract;
};

export class MealInferenceError extends Error {
  readonly code: MealInferenceErrorCode;
  readonly context?: MealInferenceErrorContext;

  constructor(
    message = "Não foi possível gerar um rascunho revisável para esta refeição agora.",
    options: {
      code?: MealInferenceErrorCode;
      context?: MealInferenceErrorContext;
    } = {},
  ) {
    super(message);
    this.name = "MealInferenceError";
    this.code = options.code ?? "meal_inference_unavailable";
    this.context = options.context;
  }
}

function clampConfidence(value: number) {
  return Math.min(Math.max(value || 0.6, 0.1), 0.99);
}

function addCatalogCandidate(candidates: string[], value: string | null | undefined) {
  const normalized = normalizeForMatching(value ?? "").trim();
  if (!normalized) return;
  if (candidates.some(candidate => normalizeForMatching(candidate).trim() === normalized)) return;
  candidates.push(value!.trim());
}

function sourceSegmentMatchesInferenceItem(segmentFoodName: string, item: LlmItem) {
  const normalizedSegment = normalizeForMatching(segmentFoodName).trim();
  const normalizedItem = normalizeForMatching(item.foodName).trim();
  const normalizedBrand = item.brand ? normalizeForMatching(item.brand).trim() : "";

  if (!normalizedSegment || !normalizedItem) return false;

  const foodMatches = sourceMentionsFood(segmentFoodName, item.foodName)
    || normalizedSegment.includes(normalizedItem)
    || normalizedItem.split(/\s+/).filter(word => word.length >= 3).every(word => normalizedSegment.includes(word));

  if (!foodMatches) return false;
  return !normalizedBrand || normalizedSegment.includes(normalizedBrand);
}

function findSourceFoodSegmentForInferenceItem(item: LlmItem, sourceText?: string) {
  const source = sourceText?.trim();
  if (!source) return null;

  const explicitSegments = extractExplicitQuantityFoodSegments(source);
  if (explicitSegments.length) {
    const matches = explicitSegments.filter(segment => sourceSegmentMatchesInferenceItem(segment.foodName, item));
    if (matches.length === 1) return matches[0].foodName;

    if (!item.brand && explicitSegments.length === 1 && sourceSegmentMatchesInferenceItem(explicitSegments[0].foodName, item)) {
      return explicitSegments[0].foodName;
    }
  }

  const unquantifiedMatches = splitSourceFoodSegments(source)
    .filter(segment => sourceSegmentMatchesInferenceItem(segment, item));
  return unquantifiedMatches.length === 1 ? unquantifiedMatches[0] : null;
}

function findExplicitBrandedVariantIdentity(item: LlmItem, sourceText?: string) {
  const brand = item.brand?.trim();
  const source = sourceText?.trim();
  if (!brand || !source) return null;

  const normalizedBrand = normalizeForMatching(brand).trim();
  if (!normalizedBrand) return null;

  const brandSegments = splitSourceFoodSegments(source)
    .filter(segment => normalizeForMatching(segment).includes(` ${normalizedBrand} `));
  if (brandSegments.length !== 1) return null;

  const variant = extractCommercialVariant(brandSegments[0]);
  if (!variant) return null;

  return `${item.foodName} ${brand} ${variant}`.trim();
}

export function recoverExplicitBrandFromSource(item: LlmItem, sourceText?: string): LlmItem {
  if (item.brand || !sourceText?.trim()) return item;
  const sourceFoodName = findSourceFoodSegmentForInferenceItem(item, sourceText);
  const sourceBrand = detectKnownBrand(sourceFoodName ?? "");
  return sourceBrand ? { ...item, brand: sourceBrand } : item;
}

function buildCatalogSearchCandidates(item: LlmItem, sourceText?: string) {
  const candidates: string[] = [];
  const sourceFoodName = findSourceFoodSegmentForInferenceItem(item, sourceText);
  const explicitBrandedVariantIdentity = findExplicitBrandedVariantIdentity(item, sourceText);
  const normalizedFoodName = normalizeForMatching(item.foodName);
  const normalizedBrand = normalizeForMatching(item.brand ?? "").trim();
  const commercialIdentity = normalizedBrand && !normalizedFoodName.includes(` ${normalizedBrand} `)
    ? `${item.foodName} ${item.brand}`
    : item.foodName;

  addCatalogCandidate(candidates, sourceFoodName);
  addCatalogCandidate(candidates, explicitBrandedVariantIdentity);
  if (item.brand) {
    addCatalogCandidate(candidates, `${commercialIdentity} ${item.portionText}`);
    addCatalogCandidate(candidates, commercialIdentity);
    addCatalogCandidate(candidates, `${item.brand} ${item.foodName}`);
  }
  if (
    Number.isFinite(item.estimatedGrams)
    && item.estimatedGrams > 0
    && !/\b\d+(?:[,.]\d+)?\s*(?:kg|mg|ml|g|l)\b/iu.test(item.foodName)
  ) {
    addCatalogCandidate(candidates, `${item.foodName} ${item.estimatedGrams} g`);
  }
  addCatalogCandidate(candidates, item.foodName);

  return candidates;
}

function resolveSemanticSourceForInferenceItem(item: LlmItem, sourceText?: string) {
  const explicitSource = findSourceFoodSegmentForInferenceItem(item, sourceText);
  if (explicitSource) return explicitSource;

  const explicitBrandedVariantIdentity = findExplicitBrandedVariantIdentity(item, sourceText);
  if (explicitBrandedVariantIdentity) return explicitBrandedVariantIdentity;

  const source = sourceText?.trim();
  if (!source) return item.foodName;
  const matchingSegments = splitSourceFoodSegments(source)
    .filter(segment => sourceSegmentMatchesInferenceItem(segment, item));
  return matchingSegments.length === 1 ? matchingSegments[0] : item.foodName;
}

function catalogMatchesExplicitBrand(item: LlmItem, catalog: CatalogFood) {
  if (!item.brand) return true;
  const requestedBrand = normalizeForMatching(item.brand).trim();
  const candidateBrand = normalizeForMatching(catalog.brandName ?? "").trim();
  return Boolean(requestedBrand && candidateBrand && requestedBrand === candidateBrand);
}

function catalogMatchesCommercialIdentity(
  item: LlmItem,
  catalog: CatalogFood,
  semanticSource: string,
) {
  if (!catalogMatchesExplicitBrand(item, catalog)) return false;
  if (!item.brand) return true;
  return isPersistedProductIdentityCompatible({
    foodName: semanticSource,
    matchedProductName: catalog.name,
    brandName: catalog.brandName ?? null,
    servingLabel: catalog.servingLabel,
    gramsPerServing: catalog.gramsPerServing,
  });
}

function isCatalogFoodNameIdentityMatch(catalog: CatalogFood, semanticSource: string) {
  const normalizedSource = normalizeForMatching(semanticSource).trim();
  if (!normalizedSource) return false;

  return [catalog.name, ...catalog.aliases].some(
    candidate => normalizeForMatching(candidate).trim() === normalizedSource,
  );
}

const ALTERNATIVE_IDENTITY_STOP_WORDS = new Set([
  "com", "das", "de", "do", "dos", "em", "fatia", "fatias", "g", "grama", "gramas",
  "kg", "l", "ml", "porcao", "porcoes", "unidade", "unidades",
]);

function significantIdentityTokens(value: string, brandName: string) {
  const brandTokens = new Set(
    normalizeForMatching(brandName).trim().split(/\s+/).filter(Boolean),
  );
  return normalizeForMatching(value)
    .trim()
    .split(/\s+/)
    .map(token => token.replace(/[^a-z0-9]/g, ""))
    .filter(token =>
      token.length >= 3
      && !brandTokens.has(token)
      && !ALTERNATIVE_IDENTITY_STOP_WORDS.has(token)
      && !/^\d+$/.test(token)
    );
}

function toSemanticAlternative(food: CatalogFood): MealSemanticAlternative {
  return {
    name: food.name,
    brand: food.brandName?.trim() || null,
    productVariant: food.productVariant ?? extractCommercialVariant(food.name),
    servingLabel: food.servingLabel,
    gramsPerServing: food.gramsPerServing,
  };
}

function findBrandedCatalogAlternatives(
  semanticSource: string,
  brandName: string | null | undefined,
) {
  const brand = brandName?.trim();
  if (!brand) return [];
  const normalizedBrand = normalizeForMatching(brand).trim();
  const requestTokens = significantIdentityTokens(semanticSource, brand);
  const requestedVariant = extractCommercialVariant(semanticSource);
  const seen = new Set<string>();

  return (getCatalogCache() as CatalogFood[])
    .filter(food => {
      if (!food.isBrandedProduct && !food.brandName) return false;
      if (normalizeForMatching(food.brandName ?? "").trim() !== normalizedBrand) return false;
      const searchable = normalizeForMatching([
        food.name,
        ...food.aliases,
        ...(food.variants ?? []),
      ].join(" "));
      if (!requestTokens.every(token => searchable.includes(token))) return false;
      const candidateVariant = food.productVariant ?? extractCommercialVariant(food.name);
      if (requestedVariant && candidateVariant && candidateVariant !== requestedVariant) return false;
      return true;
    })
    .map(toSemanticAlternative)
    .filter(candidate => {
      const key = normalizeForMatching(`${candidate.name}|${candidate.servingLabel}`).trim();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

async function findMostSpecificCatalogForInferenceItem(item: LlmItem, options: BuildItemsOptions) {
  const candidates = buildCatalogSearchCandidates(item, options.sourceText);
  const semanticSource = resolveSemanticSourceForInferenceItem(item, options.sourceText);
  const alternatives = item.brand
    ? findBrandedCatalogAlternatives(semanticSource, item.brand)
    : [];
  if (!extractCommercialVariant(semanticSource) && alternatives.length > 1) {
    return {
      catalog: undefined,
      isExactMatch: false,
      alternatives,
      semanticSource,
    };
  }

  for (const candidate of candidates) {
    const catalog =
      findCatalogFood(candidate) ?? findTacoFood(candidate) ?? undefined;
    if (
      !catalog ||
      !isCatalogFoodSemanticallyCompatible(catalog, semanticSource)
    )
      continue;
    if (!catalogMatchesCommercialIdentity(item, catalog, semanticSource))
      continue;
    if (item.brand && !isVerifiedBrandedCatalogFood(catalog)) continue;
    return { catalog, isExactMatch: true, alternatives, semanticSource };
  }

  for (const [index, candidate] of candidates.entries()) {
    if (item.brand && index > 0) break;
    const catalog =
      (await findCatalogFoodSemantic(candidate, {
        searchSpecificProduct: Boolean(item.brand) && index === 0,
        skipNutritionSearch: index > 0,
      }).catch(() => null)) ?? undefined;
    if (
      !catalog ||
      !isCatalogFoodSemanticallyCompatible(catalog, semanticSource)
    )
      continue;
    if (!catalogMatchesCommercialIdentity(item, catalog, semanticSource))
      continue;
    if (item.brand && !isVerifiedBrandedCatalogFood(catalog)) continue;
    return {
      catalog,
      isExactMatch: isCatalogFoodNameIdentityMatch(catalog, semanticSource),
      alternatives,
      semanticSource,
    };
  }

  return { catalog: undefined, isExactMatch: false, alternatives, semanticSource };
}

type NutritionFallbackObserver = (reason: "catalog_miss" | "generic_nutrition_fallback") => void;

function isVerifiedBrandedCatalogFood(food: CatalogFood | undefined) {
  if (!food?.isBrandedProduct) return false;
  if (!food.researchIdentityKey) return true;

  return isResearchVerifiedCatalogFood(food);
}

function catalogResolution(food: CatalogFood): MealItemResolutionMetadata {
  const researched = isResearchVerifiedCatalogFood(food);
  return {
    productVariant: food.productVariant ?? extractCommercialVariant(food.name),
    nutritionOrigin: researched ? "web_research" : "catalog",
    nutritionVerified: food.isBrandedProduct ? isVerifiedBrandedCatalogFood(food) : true,
    sourceUrls: [...(food.sourceUrls ?? [])],
    sourceEvidence: food.sourceEvidence ?? null,
    sourceVerifiedAt: food.sourceVerifiedAt ?? null,
    sourceConfidence: food.sourceConfidence ?? null,
    ambiguity: null,
  };
}

function unresolvedBrandedResolution(input: {
  semanticSource: string;
  alternatives: MealSemanticAlternative[];
}): MealItemResolutionMetadata {
  const requestedVariant = extractCommercialVariant(input.semanticSource);
  return {
    productVariant: requestedVariant,
    nutritionOrigin: "heuristic",
    nutritionVerified: false,
    sourceUrls: [],
    sourceEvidence: null,
    sourceVerifiedAt: null,
    sourceConfidence: 0,
    ambiguity: {
      reason: requestedVariant
        ? "commercial_identity_unverified"
        : "brand_variant_unresolved",
      alternatives: [...input.alternatives],
    },
  };
}

/** The countable preflight uses the same identity, evidence and ambiguity policy as nutrition. */
export async function resolveCommercialFoodIdentity(
  foodName: string,
  brand: string
) {
  const item: LlmItem = {
    foodName,
    brand,
    quantity: 1,
    unit: "un",
    portionText: "",
    servings: 1,
    estimatedGrams: 0,
    estimatedCalories: 0,
    estimatedMacros: { protein: 0, carbs: 0, fat: 0 },
    confidence: 0.5,
  };
  const found = await findMostSpecificCatalogForInferenceItem(item, {});
  if (found.catalog && isVerifiedBrandedCatalogFood(found.catalog))
    return found.catalog;
  const unresolved = {
    ...buildUnresolvedBrandedNutritionItem(item),
    resolution: unresolvedBrandedResolution(found),
  };
  const semanticContract = buildMealSemanticContract({
    processingInput: { text: foodName },
    sourceText: foodName,
    items: [unresolved],
  });
  const clarification = semanticContract.clarifications[0];
  throw new MealInferenceError(clarification.message, {
    code: "food_identity_clarification_required",
    context: {
      originalText: foodName,
      foodName,
      brand,
      clarificationReason: clarification.code,
      alternatives: clarification.alternatives,
      semanticContract,
    },
  });
}

type ParsedNutritionLabelEvidence = {
  servingQuantity: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  raw: string;
};

const NUTRITION_LABEL_EVIDENCE_PATTERN = /NUTRITION_LABEL_EVIDENCE:\s*serving=(\d+(?:[.,]\d+)?)\s*([^;]+?)\s*;\s*kcal=(\d+(?:[.,]\d+)?)\s*;\s*protein_g=(\d+(?:[.,]\d+)?)\s*;\s*carbs_g=(\d+(?:[.,]\d+)?)\s*;\s*fat_g=(\d+(?:[.,]\d+)?)(?=\s*(?:[.;]|$))/iu;

function parseEvidenceDecimal(value: string) {
  return Number(value.replace(",", "."));
}

function parseNutritionLabelEvidence(value?: string | null): ParsedNutritionLabelEvidence | null {
  const match = value?.match(NUTRITION_LABEL_EVIDENCE_PATTERN);
  if (!match) return null;

  const servingQuantity = parseEvidenceDecimal(match[1]);
  const calories = parseEvidenceDecimal(match[3]);
  const protein = parseEvidenceDecimal(match[4]);
  const carbs = parseEvidenceDecimal(match[5]);
  const fat = parseEvidenceDecimal(match[6]);
  const servingUnit = match[2].trim();
  const numericValues = [servingQuantity, calories, protein, carbs, fat];

  if (!servingUnit || numericValues.some(number => !Number.isFinite(number) || number < 0)) return null;
  if (servingQuantity <= 0) return null;

  return {
    servingQuantity,
    servingUnit,
    calories,
    protein,
    carbs,
    fat,
    raw: match[0].trim(),
  };
}

function nutritionValueMatches(actual: number, expected: number, kind: "calories" | "macro") {
  if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
  const absoluteTolerance = kind === "calories" ? 1 : 0.15;
  const relativeTolerance = Math.abs(expected) * 0.02;
  return Math.abs(actual - expected) <= Math.max(absoluteTolerance, relativeTolerance);
}

function resolveNutritionLabelScale(item: LlmItem, evidence: ParsedNutritionLabelEvidence) {
  const itemQuantity = Number(item.quantity);
  const itemUnit = normalizeUnit(item.unit ?? "");
  const servingUnit = normalizeUnit(evidence.servingUnit);

  if (
    Number.isFinite(itemQuantity)
    && itemQuantity > 0
    && itemUnit
    && servingUnit
    && itemUnit === servingUnit
  ) {
    return itemQuantity / evidence.servingQuantity;
  }

  if (
    servingUnit === "g"
    && Number.isFinite(item.estimatedGrams)
    && item.estimatedGrams > 0
  ) {
    return item.estimatedGrams / evidence.servingQuantity;
  }

  return null;
}

function verifyNutritionLabelEvidence(item: LlmItem, evidenceText?: string | null) {
  const evidence = parseNutritionLabelEvidence(evidenceText);
  if (!evidence) return null;

  const scale = resolveNutritionLabelScale(item, evidence);
  if (!scale || !Number.isFinite(scale) || scale <= 0) return null;

  const expectedCalories = evidence.calories * scale;
  const expectedProtein = evidence.protein * scale;
  const expectedCarbs = evidence.carbs * scale;
  const expectedFat = evidence.fat * scale;

  if (!nutritionValueMatches(item.estimatedCalories, expectedCalories, "calories")) return null;
  if (!nutritionValueMatches(item.estimatedMacros.protein, expectedProtein, "macro")) return null;
  if (!nutritionValueMatches(item.estimatedMacros.carbs, expectedCarbs, "macro")) return null;
  if (!nutritionValueMatches(item.estimatedMacros.fat, expectedFat, "macro")) return null;

  return evidence;
}

async function buildItemsFromInference(
  items: LlmItem[],
  options: BuildItemsOptions = {},
  observeFallback?: NutritionFallbackObserver,
): Promise<MealDraftItem[]> {
  const results: MealDraftItem[] = [];
  for (const item of items) {
    const normalizedItem = normalizeLlmItem(item);
    const sourceFoodName = findSourceFoodSegmentForInferenceItem(normalizedItem, options.sourceText);
    const resolvedItem = recoverExplicitBrandFromSource(normalizedItem, options.sourceText);
    const { catalog, isExactMatch, alternatives, semanticSource } =
      await findMostSpecificCatalogForInferenceItem(resolvedItem, options);
    const verifiedNutritionLabelEvidence = options.preferInferredNutrition
      ? verifyNutritionLabelEvidence(resolvedItem, options.nutritionLabelEvidenceText)
      : null;
    if (!catalog) {
      observeFallback?.("catalog_miss");
    }
    const canUseCatalog = Boolean(
      catalog
      && (isExactMatch || resolvedItem.brand || hasUsableNutrition(resolvedItem))
      && (
        !options.preferInferredNutrition
        || isVerifiedBrandedCatalogFood(catalog)
        || (!catalog.isBrandedProduct && !verifiedNutritionLabelEvidence)
      )
    );
    if (canUseCatalog && catalog) {
      results.push({
        ...buildItemFromCatalog(catalog, resolvedItem),
        resolution: catalogResolution(catalog),
      });
      continue;
    }

    const requestedVariant = extractCommercialVariant(semanticSource);
    const canUseVerifiedNutritionLabel = Boolean(
      resolvedItem.brand
      && options.preferInferredNutrition
      && verifiedNutritionLabelEvidence
      && requestedVariant
    );

    if (resolvedItem.brand && !canUseVerifiedNutritionLabel) {
      results.push({
        ...buildUnresolvedBrandedNutritionItem(resolvedItem),
        resolution: unresolvedBrandedResolution({ semanticSource, alternatives }),
      });
      continue;
    }

    if (canUseVerifiedNutritionLabel && verifiedNutritionLabelEvidence) {
      results.push({
        ...buildHybridItem(resolvedItem),
        resolution: {
          productVariant: requestedVariant,
          nutritionOrigin: "nutrition_label",
          nutritionVerified: true,
          sourceUrls: [],
          sourceEvidence: verifiedNutritionLabelEvidence.raw,
          sourceVerifiedAt: null,
          sourceConfidence: resolvedItem.confidence,
          ambiguity: null,
        },
      });
      continue;
    }

    if (!hasUsableNutrition(resolvedItem)) {
      const fallbackItem = sourceFoodName
        ? { ...resolvedItem, foodName: sourceFoodName }
        : resolvedItem;
      const result = buildEstimatedNutritionFallbackItem(fallbackItem, catalog);
      if (!catalog && isGenericNutritionFallbackItem(result)) {
        observeFallback?.("generic_nutrition_fallback");
      }
      results.push({
        ...result,
        resolution: {
          productVariant: extractCommercialVariant(fallbackItem.foodName),
          nutritionOrigin: "heuristic",
          nutritionVerified: false,
          sourceUrls: [],
          sourceEvidence: null,
          sourceVerifiedAt: null,
          sourceConfidence: result.confidence,
          ambiguity: null,
        },
      });
    } else {
      results.push({
        ...buildHybridItem(resolvedItem),
        resolution: {
          productVariant: extractCommercialVariant(resolvedItem.foodName),
          nutritionOrigin: "ai_estimate",
          nutritionVerified: false,
          sourceUrls: [],
          sourceEvidence: null,
          sourceVerifiedAt: null,
          sourceConfidence: resolvedItem.confidence,
          ambiguity: null,
        },
      });
    }
  }
  return results;
}

function shouldConstrainAiItemsToText(input: MealProcessingInput, sourceText: string) {
  return Boolean(sourceText) && !input.imageUrl && !input.audioUrl;
}

function splitSourceFoodSegments(sourceText: string) {
  return sourceText
    .split(/\s*[;,]\s*|\s*\+\s*|\n+|\s+\be\s+/gi)
    .map(segment => segment.trim())
    .filter(Boolean);
}

function includesNormalizedPhrase(haystack: string, needle: string) {
  const normalizedNeedle = normalizeForMatching(needle).trim();
  if (!normalizedNeedle) return false;
  return normalizeForMatching(haystack).includes(` ${normalizedNeedle} `);
}

function isLikelyPreparationIngredientReduction(sourceText: string, foodName: string) {
  const normalizedFood = normalizeForMatching(foodName).trim();
  if (!normalizedFood) return false;

  return splitSourceFoodSegments(sourceText).some(segment => {
    const normalizedSegment = normalizeForMatching(segment).trim();
    if (!normalizedSegment || normalizedSegment === normalizedFood) return false;
    if (!includesNormalizedPhrase(segment, foodName)) return false;

    const connectorIndex = normalizedSegment.indexOf(" com ");
    if (connectorIndex < 0) return false;

    const beforeConnector = normalizedSegment.slice(0, connectorIndex).trim();
    const afterConnector = normalizedSegment.slice(connectorIndex + " com ".length).trim();
    return Boolean(beforeConnector)
      && afterConnector.includes(normalizedFood)
      && !beforeConnector.includes(normalizedFood);
  });
}

function filterAiItemsBySourceText(items: LlmItem[], sourceText: string) {
  return items.filter(item => {
    const normalizedItem = normalizeLlmItem(item);
    return sourceMentionsFood(sourceText, normalizedItem.foodName)
      && !isLikelyPreparationIngredientReduction(sourceText, normalizedItem.foodName);
  });
}

function sourceSegmentOnlyAddsStructuredBrand(input: {
  item: MealDraftItem;
  segmentFoodName: string;
  normalizedSegment: string;
  normalizedItem: string;
  normalizedCanonical: string;
}) {
  const normalizedBrand = input.item.brand ? normalizeForMatching(input.item.brand).trim() : "";
  if (!normalizedBrand) return false;

  const segmentWithoutBrand = input.normalizedSegment
    .replace(new RegExp(`(^| )${normalizedBrand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`, "g"), " ")
    .replace(/\s+/g, " ")
    .trim();

  return Boolean(segmentWithoutBrand)
    && (segmentWithoutBrand === input.normalizedItem || segmentWithoutBrand === input.normalizedCanonical);
}

function findSpecificSourceFoodNameForItem(item: MealDraftItem, sourceText: string, usedSegments: Set<number>) {
  const explicitSegments = extractExplicitQuantityFoodSegments(sourceText);
  if (!explicitSegments.length) return null;

  const normalizedItem = normalizeForMatching(item.foodName).trim();
  const normalizedCanonical = normalizeForMatching(item.canonicalName).trim();

  for (const [index, segment] of explicitSegments.entries()) {
    if (usedSegments.has(index)) continue;

    const normalizedSegment = normalizeForMatching(segment.foodName).trim();
    if (!normalizedSegment || normalizedSegment === normalizedItem) continue;

    if (sourceSegmentOnlyAddsStructuredBrand({
      item,
      segmentFoodName: segment.foodName,
      normalizedSegment,
      normalizedItem,
      normalizedCanonical,
    })) continue;

    const segmentMatchesItem = sourceMentionsFood(segment.foodName, item.foodName)
      || sourceMentionsFood(segment.foodName, item.canonicalName)
      || Boolean(normalizedItem && normalizedSegment.includes(normalizedItem))
      || Boolean(normalizedCanonical && normalizedSegment.includes(normalizedCanonical));

    if (segmentMatchesItem) {
      usedSegments.add(index);
      return segment.foodName;
    }
  }

  return null;
}

function preserveSpecificSourceFoodNames(items: MealDraftItem[], sourceText: string) {
  if (!sourceText.trim()) return items;

  const usedSegments = new Set<number>();
  return items.map(item => {
    const sourceFoodName = findSpecificSourceFoodNameForItem(item, sourceText, usedSegments);
    if (!sourceFoodName) return item;

    return {
      ...item,
      foodName: formatFoodNameTitleCase(sourceFoodName),
    };
  });
}

function shouldFallbackToSourceText(extraction: Awaited<ReturnType<typeof extractWithAi>>, sourceText: string) {
  return Boolean(sourceText && extraction && extraction.items.length === 0);
}

function createFallbackReasonCollector() {
  const counts = new Map<MealInferenceFallbackReason, number>();
  return {
    observe(reason: MealInferenceFallbackReason) {
      counts.set(reason, (counts.get(reason) ?? 0) + 1);
    },
    flush() {
      for (const [reason, count] of counts) {
        logMealInferenceFallback(reason, count);
      }
    },
  };
}

export async function processMealInput(input: MealProcessingInput): Promise<CanonicalMealProcessingResult> {
  const sourceText = [input.text?.trim(), input.transcript?.trim()].filter(Boolean).join("\n").trim();
  const quantityClarification = getQuantityExpressionClarification(sourceText);
  if (quantityClarification) throw new MealInferenceError(quantityClarification);

  const detectedMealLabel = resolveMealLabel(input, sourceText);
  const fallbackReasons = createFallbackReasonCollector();

  let extraction: Awaited<ReturnType<typeof extractWithAi>> = null;
  try {
    extraction = await extractWithAi(input);
  } catch {
    extraction = null;
  }

  if (!extraction && sourceText) {
    fallbackReasons.observe("ai_unavailable_or_error");
  } else if (shouldFallbackToSourceText(extraction, sourceText)) {
    fallbackReasons.observe("ai_empty_items");
  }

  if (shouldRequestSugarQuantity(sourceText, extraction?.items)) {
    fallbackReasons.flush();
    throw new MealInferenceError(
      "Para registrar o café com açúcar, informe somente a quantidade de açúcar. Exemplo: 5 g de açúcar ou 1 colher de chá.",
      {
        code: "food_component_quantity_required",
        context: {
          component: "açúcar",
          originalText: sourceText,
          acceptedUnits: ["g", "colher de chá", "colher de sopa", "sachê"],
        },
      },
    );
  }

  let usedSourceTextFallback = !extraction || shouldFallbackToSourceText(extraction, sourceText);
  let rejectedAllAiItems = false;
  let rawItems: MealDraftItem[];
  const explicitSugarCoffee = buildCoffeeWithExplicitSugarItem(sourceText);

  if (explicitSugarCoffee) {
    rawItems = [explicitSugarCoffee];
    usedSourceTextFallback = true;
  } else if (usedSourceTextFallback || !extraction) {
    rawItems = fallbackFromText(sourceText, reason => fallbackReasons.observe(reason));
  } else {
    const confirmedExtraction = extraction;
    const inferenceItems = shouldConstrainAiItemsToText(input, sourceText)
      ? filterAiItemsBySourceText(confirmedExtraction.items, sourceText)
      : confirmedExtraction.items;

    if (sourceText && confirmedExtraction.items.length > 0 && inferenceItems.length === 0) {
      rejectedAllAiItems = true;
      usedSourceTextFallback = true;
      fallbackReasons.observe("ai_items_rejected");
      rawItems = fallbackFromText(sourceText, reason => fallbackReasons.observe(reason));
    } else {
      rawItems = applyExplicitQuantities(await buildItemsFromInference(
        inferenceItems,
        {
          preferInferredNutrition: Boolean(input.imageUrl),
          nutritionLabelEvidenceText: input.imageUrl ? confirmedExtraction.reasoning : null,
          sourceText,
        },
        reason => fallbackReasons.observe(reason),
      ), sourceText);
    }
  }

  const cleanedItems = cleanMealItems(rawItems);
  const sourceNamedItems = shouldConstrainAiItemsToText(input, sourceText)
    ? preserveSpecificSourceFoodNames(cleanedItems, sourceText)
    : cleanedItems;
  const items = normalizeSweetenedCoffeeDraftItems(sourceNamedItems, sourceText);

  if (!items.length) {
    fallbackReasons.flush();
    throw new MealInferenceError();
  }

  const totals = sumTotals(items);
  const confidence = extraction && !usedSourceTextFallback ? clampConfidence(extraction.confidence) : items.length ? 0.45 : 0.2;
  const reasoning = explicitSugarCoffee
    ? "A quantidade explícita de açúcar foi incorporada uma única vez à referência de café, preservando a preparação informada."
    : usedSourceTextFallback
      ? rejectedAllAiItems
        ? "A IA retornou itens incompatíveis com o texto informado; foi aplicada uma heurística a partir da descrição completa para preservar o alimento e sua preparação. Recomenda-se confirmar a inferência antes de salvar."
        : "A análise visual não identificou itens com segurança; foi aplicada uma heurística a partir do texto informado pelo usuário. Recomenda-se confirmar a inferência antes de salvar."
      : extraction?.reasoning || "Foi aplicada uma heurística de catálogo para estruturar a refeição. Recomenda-se confirmar a inferência antes de salvar.";

  const semanticContract = buildMealSemanticContract({
    processingInput: input,
    sourceText,
    items,
  });
  if (semanticContract.needsClarification) {
    const clarification = semanticContract.clarifications[0];
    const semanticItem = semanticContract.items[clarification.itemIndex];
    fallbackReasons.flush();
    throw new MealInferenceError(clarification.message, {
      code: "food_identity_clarification_required",
      context: {
        originalText: sourceText,
        foodName: semanticItem?.commercialName,
        brand: semanticItem?.brand ?? null,
        clarificationReason: clarification.code,
        alternatives: [...clarification.alternatives],
        semanticContract,
      },
    });
  }

  fallbackReasons.flush();
  return {
    detectedMealLabel,
    sourceText,
    imageUrl: input.imageUrl,
    audioUrl: input.audioUrl,
    transcript: input.transcript,
    confidence,
    needsConfirmation: true,
    reasoning,
    items,
    totals,
    semanticContract,
  };
}

export function suggestHabitsFromMeals(items: MealDraftItem[]) {
  return items.map(item => ({
    foodName: item.canonicalName,
    preferredPortionGrams: item.estimatedGrams,
    notes: `Porção confirmada recentemente: ${item.portionText}`,
  }));
}
