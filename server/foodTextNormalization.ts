import {
  normalizeUnit,
  parseCountableQuantityPrefix,
  parseFoodText,
  parseQuantityUnitFromPortionText,
} from "./mealTextParsing";
import {
  findCatalogFood,
  findNaturalProduceQuantityReferenceName,
  isCatalogFoodSemanticallyCompatible,
  normalizeBrandName,
} from "./catalogMatching";
import { detectKnownBrand } from "./foodBrandDetection";
import { resolveSafeCountableCatalogGrams } from "./foodItemResolution";

function normalizeFoodLookupText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasExactCatalogAlias(
  value: string,
  food: { name: string; aliases: string[] }
) {
  const normalized = normalizeFoodLookupText(value);
  return [food.name, ...food.aliases].some(
    alias => normalizeFoodLookupText(alias) === normalized
  );
}

export function exactUnitFoodCatalogAlias(value: string) {
  const normalizedValue = normalizeFoodLookupText(value);
  if (!normalizedValue) return null;

  const directFood = findCatalogFood(value);
  if (directFood && hasExactCatalogAlias(value, directFood)) return value;

  const naturalReference = findNaturalProduceQuantityReferenceName(value);
  if (naturalReference) {
    const sourceTokens = normalizedValue.split(" ");
    const referenceTokens =
      normalizeFoodLookupText(naturalReference).split(" ");
    const candidateName = [
      ...referenceTokens,
      ...sourceTokens.slice(referenceTokens.length),
    ].join(" ");
    const candidateFood = findCatalogFood(candidateName);
    if (candidateFood && hasExactCatalogAlias(candidateName, candidateFood)) {
      return candidateName;
    }
  }

  if (directFood) return null;

  const canonicalException = resolveSafeCountableCatalogGrams(value, 1, "un");
  return canonicalException &&
    isCatalogFoodSemanticallyCompatible(canonicalException.food, value)
    ? value
    : null;
}


/** A branded unit is measurable only by an exact alias with a unit serving. */
export function resolveExactBrandedUnitCatalogGrams(
  foodName: string,
  count: number,
) {
  if (!Number.isFinite(count) || count <= 0) return null;
  const alias = exactUnitFoodCatalogAlias(foodName);
  const food = alias ? findCatalogFood(alias) : null;
  const brand = detectKnownBrand(foodName);
  if (
    !brand || !food?.isBrandedProduct || !food.brandName ||
    normalizeBrandName(brand) !== normalizeBrandName(food.brandName)
  ) return null;

  const serving = parseQuantityUnitFromPortionText(food.servingLabel);
  if (
    !serving || !Number.isFinite(serving.quantity) || serving.quantity <= 0 ||
    normalizeUnit(serving.unit) !== "un" ||
    !Number.isFinite(food.gramsPerServing) || food.gramsPerServing <= 0
  ) return null;

  const grams = food.gramsPerServing * count / serving.quantity;
  return Number.isFinite(grams) && grams > 0 ? { food, grams } : null;
}

export function hasUnsafeBareCount(value: string) {
  // Explicit units may use the catalog; a bare count needs an exact food alias,
  // whether the quantity is written as a word or as a digit.
  const parsed = parseFoodText(value);
  if (parsed.quantity && parsed.unit) return false;
  const writtenQuantity = parseCountableQuantityPrefix(value);
  return Boolean(
    writtenQuantity &&
      !exactUnitFoodCatalogAlias(
        normalizeKnownFoodName(writtenQuantity.remainder)
      )
  );
}

export function normalizeKnownFoodName(value: string) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  const normalized = normalizeFoodLookupText(cleaned);

  if (/^maca\s+(?:fuji|fugi)$/.test(normalized)) {
    return "maçã fuji";
  }
  if (normalized === "maca") {
    return "maçã";
  }
  if (normalized === "ovos cozido") {
    return "ovos cozidos";
  }
  if (normalized === "ameixa roxa") {
    return "ameixa crua";
  }

  return cleaned;
}

export function isLikelyKnownFoodRegistrationText(value?: string | null) {
  const normalized = normalizeFoodLookupText(value ?? "");
  if (!normalized) {
    return false;
  }

  return /\b(?:maca|banana|ovo|ovos)\b/.test(normalized)
    && !/\b(?:como|qual|quais|posso|devo|vale a pena|faz mal|faz bem|calorias)\b/.test(normalized);
}

export function normalizeKnownFoodText(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  const quantityWithUnit = text.match(
    /^(\d+(?:[,.]\d+)?\s*(?:g|gr|gramas?|kg|quilos?|mg|ml|mililitros?|l|litros?|un|unidades?|fatias?|colheres?|x[ií]caras?|copos?|por[cç][oõ]es?|por[cç][aã]o))\s+(?:de\s+)?(.+)$/iu
  );
  if (quantityWithUnit) {
    const foodName = normalizeKnownFoodName(quantityWithUnit[2]);
    return foodName === quantityWithUnit[2].trim()
      ? text
      : `${quantityWithUnit[1]} ${foodName}`;
  }

  const numericQuantity = text.match(/^(\d+(?:[,.]\d+)?)\s+(?:de\s+)?(.+)$/u);
  if (numericQuantity) {
    const foodName = normalizeKnownFoodName(numericQuantity[2]);
    return foodName === numericQuantity[2].trim()
      ? text
      : `${numericQuantity[1]} un ${foodName}`;
  }

  const wordQuantity = parseCountableQuantityPrefix(text);
  if (wordQuantity) {
    const { quantity, remainder: writtenFoodName } = wordQuantity;
    const numericInput = `${quantity} ${writtenFoodName}`;
    const parsed = parseFoodText(numericInput);
    if (parsed.quantity && parsed.unit && parsed.foodName) {
      const foodName = normalizeKnownFoodName(parsed.foodName);
      return `${parsed.quantity} ${parsed.unit} ${foodName}`;
    }

    const foodName = normalizeKnownFoodName(writtenFoodName);
    const countableReferenceName = exactUnitFoodCatalogAlias(foodName);
    if (!countableReferenceName) return text;
    return resolveSafeCountableCatalogGrams(
      countableReferenceName,
      quantity,
      "un"
    )
      ? `${quantity} un ${foodName}`
      : text;
  }

  return normalizeKnownFoodName(text);
}
