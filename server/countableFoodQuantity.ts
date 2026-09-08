import { findCatalogFood } from "./catalogMatching";
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
  COUNTABLE_QUANTITY_PATTERN,
  parseCountableQuantity,
} from "./modules/whatsapp/quantityUnitVocabulary";
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

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
) {
  const registrationSegments = splitCountableFoodTextSegments(registrationText);
  const rewrittenSegments = [...registrationSegments];
  const pendingItems: Array<CountableFoodQuantityRequest & { segmentIndex: number }> = [];
  const resolutions: CountableFoodResolvedMeasure[] = [];

  for (const [segmentIndex, segment] of registrationSegments.entries()) {
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

    const safe = resolveSafeCountableCatalogGrams(
      request.foodName,
      request.count,
      request.requestedUnit,
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

    const resolved = await resolveHouseholdMeasure({
      userId,
      foodName: request.foodName,
      brand: request.brand,
      quantity: request.count,
      unit: request.requestedUnit,
    });
    if (resolved) {
      rewrittenSegments[segmentIndex] = `${resolved.grams} g de ${request.foodName}`;
      resolutions.push({ segmentIndex, request, resolution: resolved });
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
