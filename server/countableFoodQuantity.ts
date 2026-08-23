import { findCatalogFood } from "./catalogMatching";
import { isCoffeeOrTeaBeverage } from "./foodSemanticCompatibility";
import {
  normalizeUnit,
  parseFoodText,
  parseQuantityUnitFromPortionText,
  splitFoodTextSegments,
} from "./mealTextParsing";
import type { CatalogFood } from "./nutritionEngineTypes";
import { findTacoFood } from "./tacoLookup";

const WORD_COUNTS: Record<string, number> = {
  um: 1,
  uma: 1,
  dois: 2,
  duas: 2,
  tres: 3,
  três: 3,
};
const MASS_VOLUME_UNITS = new Set(["mg", "g", "kg", "ml", "l"]);

export type CountableFoodQuantityRequest = {
  segment: string;
  foodName: string;
  count: number;
  requestedUnit: string;
};

function parseBareCount(segment: string): CountableFoodQuantityRequest | null {
  const match = segment.trim().match(/^(\d+(?:[,.]\d+)?|um|uma|dois|duas|tres|três)\s+(.+)$/iu);
  if (!match) return null;
  const count = /^\d/u.test(match[1])
    ? Number(match[1].replace(",", "."))
    : WORD_COUNTS[match[1].toLowerCase()];
  const foodName = match[2].trim();
  if (!Number.isFinite(count) || count <= 0 || !foodName) return null;
  return { segment: segment.trim(), foodName, count, requestedUnit: "un" };
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
  for (const segment of splitFoodTextSegments(text)) {
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
  for (const segment of splitFoodTextSegments(text)) {
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
    count,
    requestedUnit,
  };
  const food = findCatalogFood(foodName);
  const grams = getSafeCatalogCountableGrams(food, request);
  return grams && food ? { food, grams } : null;
}

export function prepareCountableFoodRegistration(registrationText: string) {
  const registrationSegments = splitFoodTextSegments(registrationText);
  const pendingItems: Array<CountableFoodQuantityRequest & { segmentIndex: number }> = [];
  const rewrittenSegments = registrationSegments.map((segment, segmentIndex) => {
    const request = parseCountableFoodQuantitySegment(segment);
    if (!request) return segment;
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
