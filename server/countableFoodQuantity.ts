import { findCatalogFood } from "./catalogMatching";
import { extractCommercialVariant } from "./commercialProductIdentity";
import { detectKnownBrand } from "./foodBrandDetection";
import { isCoffeeOrTeaBeverage } from "./foodSemanticCompatibility";
import { resolveHouseholdMeasure, type HouseholdMeasureResolution } from "./householdMeasureResolution";
import {
  normalizeUnit,
  parseFoodText,
  parseQuantityUnitFromPortionText,
  splitFoodTextSegments,
} from "./mealTextParsing";
import type { CatalogFood } from "./nutritionEngineTypes";
import { findTacoFood } from "./tacoLookup";
import {
  MealInferenceError,
  processMealInput,
  resolveCommercialFoodIdentity,
} from "./nutritionEngine";
import {
  COUNTABLE_QUANTITY_PATTERN,
  parseCountableQuantity,
} from "./modules/whatsapp/quantityUnitVocabulary";
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);
const GENERIC_ZERO_COMMERCIAL_VARIANTS = new Set(["zero", "diet"]);

export type CountableFoodQuantityRequest = {
  segment: string;
  foodName: string;
  brand: string | null;
  count: number;
  requestedUnit: string;
};

export type CountableFoodResolvedMeasure = {
  segmentIndex: number;
  request: CountableFoodQuantityRequest;
  resolution: HouseholdMeasureResolution | {
    kind: "canonical_portion";
    grams: number;
  };
};

export type CountableFoodPendingItem = CountableFoodQuantityRequest & {
  segmentIndex: number;
  identityClarification?: {
    message: string;
    context: NonNullable<MealInferenceError["context"]>;
  };
};

type CanonicalCommercialIdentityPreflight = {
  brand: string | null;
  identityClarification?: CountableFoodPendingItem["identityClarification"];
};

function splitCountableFoodTextSegments(text: string) {
  // The shared splitter treats commas as item separators. Protect decimal commas
  // first so inputs such as "1,5 pão francês" remain a single countable item.
  const decimalSafeText = text.replace(/(\d),(?=\d)/g, "$1.");
  return splitFoodTextSegments(decimalSafeText);
}

function parseBareCount(segment: string): CountableFoodQuantityRequest | null {
  const match = segment.trim().match(
    new RegExp(`^(${COUNTABLE_QUANTITY_PATTERN})\\s+(.+)$`, "iu"),
  );
  if (!match) return null;
  const count = parseCountableQuantity(match[1]);
  const foodName = match[2].trim();
  if (!count || !foodName) return null;
  return { segment: segment.trim(), foodName, brand: detectKnownBrand(foodName), count, requestedUnit: "un" };
}

export function parseCountableFoodQuantitySegment(
  segment: string,
): CountableFoodQuantityRequest | null {
  const parsed = parseFoodText(segment);
  if (parsed.quantity && parsed.unit) {
    const unit = normalizeUnit(parsed.unit);
    if (parsed.estimatedGrams !== undefined || MASS_VOLUME_UNITS.has(unit)) return null;
    if (isCoffeeOrTeaBeverage(parsed.foodName)) return null;
    return {
      segment: segment.trim(),
      foodName: parsed.foodName,
      brand: detectKnownBrand(parsed.foodName),
      count: parsed.quantity,
      requestedUnit: unit,
    };
  }

  const bare = parseBareCount(segment);
  if (!bare) return null;
  const local = findCatalogFood(bare.foodName);
  if (bare.count === 1 && getSafeCatalogCountableGrams(local, bare)) return null;
  return bare;
}

export function getSafeCatalogCountableGrams(
  food: CatalogFood | null | undefined,
  request: CountableFoodQuantityRequest,
) {
  if (request.brand) return null;
  if (!food || !food.servingLabel || !food.gramsPerServing) return null;
  const serving = parseQuantityUnitFromPortionText(food.servingLabel);
  if (!serving || !serving.quantity || !serving.unit) return null;
  const servingUnit = normalizeUnit(serving.unit);
  const requestedUnit = normalizeUnit(request.requestedUnit);
  if (MASS_VOLUME_UNITS.has(servingUnit) || servingUnit !== requestedUnit) return null;
  const grams = (food.gramsPerServing * request.count) / serving.quantity;
  return Number.isFinite(grams) && grams > 0 ? grams : null;
}

export function findUnsafeCountableFoodQuantity(
  text?: string | null,
): CountableFoodQuantityRequest | null {
  if (!text?.trim()) return null;
  for (const segment of splitCountableFoodTextSegments(text)) {
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) continue;
    const local = findCatalogFood(request.foodName);
    if (getSafeCatalogCountableGrams(local, request)) continue;
    return request;
  }
  return null;
}

export function hasUnsafeKnownCountableFoodQuantity(
  text?: string | null,
) {
  if (!text?.trim()) return false;
  for (const segment of splitCountableFoodTextSegments(text)) {
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) continue;
    const local = findCatalogFood(request.foodName) ?? findTacoFood(request.foodName);
    if (!local) continue;
    if (!getSafeCatalogCountableGrams(local, request)) return true;
  }
  return false;
}

export function resolveSafeCountableCatalogGrams(
  foodName: string,
  count: number,
  requestedUnit = "un",
) {
  const request: CountableFoodQuantityRequest = {
    segment: foodName,
    foodName,
    brand: detectKnownBrand(foodName),
    count,
    requestedUnit,
  };
  const food = findCatalogFood(foodName);
  const grams = getSafeCatalogCountableGrams(food, request);
  return grams && food ? { food, grams } : null;
}

function inferUnverifiedCountableCommercialVariant(
  request: CountableFoodQuantityRequest,
) {
  if (/\bcom\b/i.test(request.foodName)) return null;

  const productVariant = extractCommercialVariant(request.foodName);
  if (!productVariant) return null;

  const variantTokens = productVariant.split(/\s+/).filter(Boolean);
  if (variantTokens.some(token => GENERIC_ZERO_COMMERCIAL_VARIANTS.has(token))) {
    return null;
  }

  const local = findCatalogFood(request.foodName);
  const localVariant = local ? extractCommercialVariant(local.name) : null;
  if (localVariant) {
    const localVariantTokens = new Set(localVariant.split(/\s+/).filter(Boolean));
    if (variantTokens.every(token => localVariantTokens.has(token))) return null;
  }

  return productVariant;
}

function buildUnverifiedCommercialIdentityClarification(
  request: CountableFoodQuantityRequest,
): CanonicalCommercialIdentityPreflight {
  const identity = request.foodName.trim();
  return {
    brand: null,
    identityClarification: {
      message: `Não consegui comprovar a identidade comercial exata de ${identity}. Confirme a variante ou envie um rótulo legível antes de registrar os nutrientes.`,
      context: {
        originalText: request.segment,
        foodName: identity,
        brand: null,
        clarificationReason: "commercial_identity_unverified",
        alternatives: [],
      },
    },
  };
}

async function recoverCanonicalCommercialIdentity(
  request: CountableFoodQuantityRequest,
): Promise<CanonicalCommercialIdentityPreflight> {
  if (request.brand) return { brand: request.brand };

  try {
    const processed = await processMealInput({ text: request.segment });
    if (processed.items.length !== 1) return { brand: null };
    const brand = processed.items[0].brand?.trim() || null;
    if (brand) return { brand };
    if (inferUnverifiedCountableCommercialVariant(request)) {
      return buildUnverifiedCommercialIdentityClarification(request);
    }
    return { brand: null };
  } catch (error) {
    if (
      !(error instanceof MealInferenceError) ||
      !error.context?.clarificationReason
    )
      return { brand: null };

    return {
      brand: error.context.brand?.trim() || null,
      identityClarification: {
        message: error.message,
        context: error.context,
      },
    };
  }
}

export function prepareCountableFoodRegistration(registrationText: string) {
  const registrationSegments = splitCountableFoodTextSegments(registrationText);
  const pendingItems: Array<CountableFoodQuantityRequest & { segmentIndex: number }> = [];
  const rewrittenSegments = registrationSegments.map((segment, segmentIndex) => {
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) {
      const bare = parseBareCount(segment);
      if (!bare || bare.count !== 1) return segment;
      const safeBare = resolveSafeCountableCatalogGrams(
        bare.foodName,
        bare.count,
        bare.requestedUnit,
      );
      return safeBare ? `${safeBare.grams} g de ${bare.foodName}` : segment;
    }
    const safe = resolveSafeCountableCatalogGrams(
      request.foodName,
      request.count,
      request.requestedUnit,
    );
    if (safe) return `${safe.grams} g de ${request.foodName}`;
    pendingItems.push({ ...request, segmentIndex });
    return segment;
  });
  return {
    registrationSegments: rewrittenSegments,
    pendingItems,
    registrationText: rewrittenSegments.join("\n"),
  };
}

export async function prepareCountableFoodRegistrationResolved(
  userId: number,
  registrationText: string,
  resolvedSegmentIndexes: number[] = []
) {
  const registrationSegments = splitCountableFoodTextSegments(registrationText);
  const rewrittenSegments = [...registrationSegments];
  const pendingItems: CountableFoodPendingItem[] = [];
  const resolutions: CountableFoodResolvedMeasure[] = [];

  for (const [segmentIndex, segment] of registrationSegments.entries()) {
    if (resolvedSegmentIndexes.includes(segmentIndex)) continue;
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) {
      const bare = parseBareCount(segment);
      if (!bare || bare.count !== 1) continue;
      const safeBare = resolveSafeCountableCatalogGrams(bare.foodName, bare.count, bare.requestedUnit);
      if (safeBare) {
        rewrittenSegments[segmentIndex] = `${safeBare.grams} g de ${bare.foodName}`;
        resolutions.push({
          segmentIndex,
          request: bare,
          resolution: { kind: "canonical_portion", grams: safeBare.grams },
        });
      }
      continue;
    }

    const canonicalIdentity = await recoverCanonicalCommercialIdentity(request);
    const resolvedRequest = canonicalIdentity.brand && !request.brand
      ? { ...request, brand: canonicalIdentity.brand }
      : request;

    if (canonicalIdentity.identityClarification) {
      pendingItems.push({
        ...resolvedRequest,
        segmentIndex,
        identityClarification: canonicalIdentity.identityClarification,
      });
      continue;
    }

    const safe = resolveSafeCountableCatalogGrams(
      resolvedRequest.foodName,
      resolvedRequest.count,
      resolvedRequest.requestedUnit,
    );
    if (safe) {
      rewrittenSegments[segmentIndex] = `${safe.grams} g de ${resolvedRequest.foodName}`;
      resolutions.push({
        segmentIndex,
        request: resolvedRequest,
        resolution: { kind: "canonical_portion", grams: safe.grams },
      });
      continue;
    }

    let commercialFood: CatalogFood | undefined;
    if (resolvedRequest.brand) {
      try {
        commercialFood = await resolveCommercialFoodIdentity(
          resolvedRequest.foodName,
          resolvedRequest.brand
        );
      } catch (error) {
        if (
          !(error instanceof MealInferenceError) ||
          !error.context?.clarificationReason
        )
          throw error;
        pendingItems.push({
          ...resolvedRequest,
          segmentIndex,
          identityClarification: {
            message: error.message,
            context: error.context,
          },
        });
        continue;
      }
    }
    const resolved = await resolveHouseholdMeasure({
      userId,
      foodName: resolvedRequest.foodName,
      brand: resolvedRequest.brand,
      quantity: resolvedRequest.count,
      unit: resolvedRequest.requestedUnit,
      ...(commercialFood ? { commercialFood } : {}),
    });
    if (resolved) {
      rewrittenSegments[segmentIndex] = `${resolved.grams} g de ${resolvedRequest.foodName}`;
      resolutions.push({ segmentIndex, request: resolvedRequest, resolution: resolved });
      continue;
    }

    pendingItems.push({ ...resolvedRequest, segmentIndex });
  }

  return {
    registrationSegments: rewrittenSegments,
    pendingItems,
    resolutions,
    registrationText: rewrittenSegments.join("\n"),
  };
}
