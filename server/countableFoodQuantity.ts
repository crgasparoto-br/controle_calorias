import { findNaturalProduceQuantityReferenceName } from "./catalogMatching";
import { detectKnownBrand } from "./foodBrandDetection";
import {
  findCountableCatalogReference,
  getSafeCatalogCountableGrams,
  resolveCanonicalFoodQuantity,
  resolveSafeCountableCatalogGrams,
  type CountableFoodQuantityRequest,
} from "./foodItemResolution";
import { isCoffeeOrTeaBeverage } from "./foodSemanticCompatibility";
import type { HouseholdMeasureResolution } from "./householdMeasureResolution";
import {
  cleanFoodName,
  normalizeUnit,
  parseFoodText,
  QUANTITY_UNIT_PATTERN,
  splitFoodTextSegments,
} from "./mealTextParsing";
import type { CatalogFood } from "./nutritionEngineTypes";
import { findTacoFood } from "./tacoLookup";
import { MealInferenceError, resolveCommercialFoodIdentity } from "./nutritionEngine";
import {
  resolveStructuredCommercialIdentity,
  type CommercialIdentityClarification,
} from "./commercialFoodIdentityPreflight";
import { createNutritionSearchTrace } from "./nutritionSearchDecisionTelemetry";
import {
  COUNTABLE_QUANTITY_PATTERN,
  parseCountableQuantity,
} from "./modules/whatsapp/quantityUnitVocabulary";
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

function isCanonicalCommercialMassRequest(
  food: CatalogFood | null | undefined,
  request: CountableFoodQuantityRequest,
) {
  if (
    !food?.isBrandedProduct
    || !request.brand
    || request.count !== 1
    || normalizeUnit(request.requestedUnit) !== "un"
  ) return false;

  const parsed = parseFoodText(request.segment);
  const unit = parsed.unit ? normalizeUnit(parsed.unit) : null;
  return Boolean(
    unit
    && MASS_VOLUME_UNITS.has(unit)
    && parsed.estimatedGrams !== undefined
    && Math.abs(parsed.estimatedGrams - food.gramsPerServing) < 0.01,
  );
}

// A porção canônica local pertence à fronteira `foodItemResolution`; estes
// re-exports preservam a API histórica dos consumidores existentes.
export {
  getSafeCatalogCountableGrams,
  resolveSafeCountableCatalogGrams,
  type CountableFoodQuantityRequest,
};

export type CountableFoodResolvedMeasure = {
  segmentIndex: number;
  request: CountableFoodQuantityRequest;
  resolution: HouseholdMeasureResolution | {
    kind: "canonical_portion";
    grams: number;
  };
  /** Produto comercial já validado pelo resolvedor canônico desta mesma resolução. */
  commercialFood?: CatalogFood;
};

export type CountableFoodPendingItem = CountableFoodQuantityRequest & {
  segmentIndex: number;
  identityClarification?: CommercialIdentityClarification;
};

type CountableFoodPreparation = {
  registrationSegments: string[];
  pendingItems: CountableFoodPendingItem[];
  resolutions: CountableFoodResolvedMeasure[];
  registrationText: string;
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
    if (MASS_VOLUME_UNITS.has(unit)) {
      const catalog = parsed.foodName
        ? findCountableCatalogReference(parsed.foodName)
        : null;
      const isCanonicalBrandedMass = Boolean(
        catalog?.isBrandedProduct
          && parsed.estimatedGrams !== undefined
          && Math.abs(parsed.estimatedGrams - catalog.gramsPerServing) < 0.01,
      );
      if (!isCanonicalBrandedMass) return null;
      return {
        segment: segment.trim(),
        foodName: parsed.foodName,
        brand: detectKnownBrand(parsed.foodName) ?? catalog?.brandName ?? null,
        count: 1,
        requestedUnit: "un",
      };
    }
    if (parsed.estimatedGrams !== undefined) return null;
    if (isCoffeeOrTeaBeverage(parsed.foodName)) return null;
    return {
      segment: segment.trim(),
      foodName: parsed.foodName,
      brand: detectKnownBrand(parsed.foodName),
      count: parsed.quantity,
      requestedUnit: unit,
    };
  }

  // `cleanFoodName` intentionally treats punctuation as a separator for the
  // shared text parser. Countable quantities need one narrow exception so a
  // decimal comma/dot before a household unit is not mistaken for a bare
  // count whose food name starts with "fatias de".
  const countableMatch = segment.trim().match(
    new RegExp(
      `^(${COUNTABLE_QUANTITY_PATTERN})\\s*(${QUANTITY_UNIT_PATTERN})\\s+(?:de\\s+)?(.+)$`,
      "iu",
    ),
  );
  if (countableMatch) {
    const count = parseCountableQuantity(countableMatch[1]);
    const unit = normalizeUnit(countableMatch[2]);
    const foodName = cleanFoodName(countableMatch[3]);
    if (count && !MASS_VOLUME_UNITS.has(unit) && !isCoffeeOrTeaBeverage(foodName)) {
      return {
        segment: segment.trim(),
        foodName,
        brand: detectKnownBrand(foodName),
        count,
        requestedUnit: unit,
      };
    }
  }

  const bare = parseBareCount(segment);
  if (!bare) return null;
  const local = findCountableCatalogReference(bare.foodName);
  if (bare.count === 1 && getSafeCatalogCountableGrams(local, bare)) return null;
  return bare;
}

export function findUnsafeCountableFoodQuantity(
  text?: string | null,
): CountableFoodQuantityRequest | null {
  if (!text?.trim()) return null;
  for (const segment of splitCountableFoodTextSegments(text)) {
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) continue;
    const local = findCountableCatalogReference(request.foodName);
    if (isCanonicalCommercialMassRequest(local, request)) continue;
    if (getSafeCatalogCountableGrams(local, request, false)) continue;
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
    const local = findCountableCatalogReference(request.foodName) ?? findTacoFood(request.foodName);
    if (!local) continue;
    if (isCanonicalCommercialMassRequest(local, request)) continue;
    if (!getSafeCatalogCountableGrams(local, request, false)) return true;
  }
  return false;
}

/**
 * @deprecated Compatibility adapter for the historical synchronous API.
 *
 * Production callers use `prepareCountableFoodRegistrationResolved`; this
 * export remains for legacy consumers such as the #997 compatibility suite and
 * external imports. It can be removed after a repository/package consumer scan
 * confirms zero remaining synchronous callers.
 *
 * All local countable decisions are owned by
 * `prepareLocalCountableFoodRegistration`, which is also the first stage of
 * the canonical asynchronous preparation below.
 */
export function prepareCountableFoodRegistration(registrationText: string) {
  return prepareLocalCountableFoodRegistration(registrationText, [], false);
}

function prepareLocalCountableFoodRegistration(
  registrationText: string,
  resolvedSegmentIndexes: number[] = [],
  includeCuratedCommonPortion = false,
): CountableFoodPreparation {
  const registrationSegments = splitCountableFoodTextSegments(registrationText);
  const pendingItems: CountableFoodPendingItem[] = [];
  const resolutions: CountableFoodResolvedMeasure[] = [];
  const rewrittenSegments = [...registrationSegments];

  for (const [segmentIndex, segment] of registrationSegments.entries()) {
    if (resolvedSegmentIndexes.includes(segmentIndex)) continue;

    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) {
      const bare = parseBareCount(segment);
      if (!bare || bare.count !== 1) continue;
      const safeBare = resolveSafeCountableCatalogGrams(
        bare.foodName,
        bare.count,
        bare.requestedUnit,
        includeCuratedCommonPortion,
      );
      if (!safeBare) continue;
      rewrittenSegments[segmentIndex] = `${safeBare.grams} g de ${bare.foodName}`;
      resolutions.push({
        segmentIndex,
        request: bare,
        resolution: { kind: "canonical_portion", grams: safeBare.grams },
      });
      continue;
    }

    const safe = resolveSafeCountableCatalogGrams(
      request.foodName,
      request.count,
      request.requestedUnit,
      includeCuratedCommonPortion,
    );
    if (safe) {
      rewrittenSegments[segmentIndex] = `${safe.grams} g de ${request.foodName}`;
      resolutions.push({
        segmentIndex,
        request,
        resolution: { kind: "canonical_portion", grams: safe.grams },
      });
      continue;
    }

    pendingItems.push({ ...request, segmentIndex });
  }

  return {
    registrationSegments: rewrittenSegments,
    pendingItems,
    resolutions,
    registrationText: rewrittenSegments.join("\n"),
  };
}

/**
 * Canonical owner for countable registration preparation. Identity is resolved
 * before household measure; the accepted CatalogFood is passed to the measure
 * resolver and is never reconstructed from rewritten text downstream.
 */
export async function prepareCountableFoodRegistrationResolved(
  userId: number,
  registrationText: string,
  resolvedSegmentIndexes: number[] = [],
): Promise<CountableFoodPreparation> {
  const prepared = prepareLocalCountableFoodRegistration(
    registrationText,
    resolvedSegmentIndexes,
    true,
  );

  for (const pending of [...prepared.pendingItems]) {
    const canonicalIdentity = resolveStructuredCommercialIdentity(pending);
    const resolvedRequest = canonicalIdentity.brand && !pending.brand
      ? { ...pending, brand: canonicalIdentity.brand }
      : pending;

    if (canonicalIdentity.identityClarification && !resolvedRequest.brand) {
      const index = prepared.pendingItems.findIndex(item => item.segmentIndex === pending.segmentIndex);
      if (index >= 0) prepared.pendingItems[index] = {
        ...resolvedRequest,
        identityClarification: canonicalIdentity.identityClarification,
      };
      continue;
    }

    let commercialFood: CatalogFood | undefined;
    let nutritionSearchTelemetry:
      | { userId: number; origin: "whatsapp"; traceId: string }
      | undefined;
    if (resolvedRequest.brand) {
      const nutritionSearchTrace = createNutritionSearchTrace({
        userId,
        origin: "whatsapp",
      });
      nutritionSearchTelemetry = {
        userId,
        origin: "whatsapp",
        traceId: nutritionSearchTrace.traceId,
      };
      try {
        // Keep the structured identity while carrying the original countable
        // expression into the single external search.
        commercialFood = await resolveCommercialFoodIdentity(
          resolvedRequest.foodName,
          resolvedRequest.brand,
          {
            nutritionSearchQuery: resolvedRequest.segment,
            nutritionSearchTelemetry,
          },
        );
      } catch (error) {
        if (
          !(error instanceof MealInferenceError) ||
          !error.context?.clarificationReason
        )
          throw error;
        const index = prepared.pendingItems.findIndex(item => item.segmentIndex === pending.segmentIndex);
        if (index >= 0) prepared.pendingItems[index] = {
          ...resolvedRequest,
          identityClarification: {
            message: error.message,
            context: error.context,
          },
        };
        continue;
      }
    }

    const quantityReferenceFoodName = resolvedRequest.brand
      ? null
      : findNaturalProduceQuantityReferenceName(resolvedRequest.foodName);
    const quantity = await resolveCanonicalFoodQuantity({
      userId,
      foodName: resolvedRequest.foodName,
      brand: resolvedRequest.brand,
      quantityReferenceFoodName,
      quantity: resolvedRequest.count,
      unit: resolvedRequest.requestedUnit,
      ...(commercialFood ? { commercialFood } : {}),
      ...(nutritionSearchTelemetry ? { nutritionSearchTelemetry } : {}),
    });
    const resolved = quantity?.householdMeasure ?? null;
    if (resolved) {
      prepared.registrationSegments[pending.segmentIndex] = `${resolved.grams} g de ${resolvedRequest.foodName}`;
      prepared.resolutions.push({
        segmentIndex: pending.segmentIndex,
        request: resolvedRequest,
        resolution: resolved,
        ...(commercialFood ? { commercialFood } : {}),
      });
      const index = prepared.pendingItems.findIndex(item => item.segmentIndex === pending.segmentIndex);
      if (index >= 0) prepared.pendingItems.splice(index, 1);
    } else if (resolvedRequest.brand && commercialFood) {
      // Identity was accepted but no measure relation was proven. Keep the
      // pending item as a quantity clarification, without re-searching identity.
      const index = prepared.pendingItems.findIndex(item => item.segmentIndex === pending.segmentIndex);
      if (index >= 0) prepared.pendingItems[index] = resolvedRequest;
    }
  }

  prepared.registrationText = prepared.registrationSegments.join("\n");
  return prepared;
}
