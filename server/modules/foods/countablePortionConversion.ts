import { measurementLabelMatchesUnit } from "../../../shared/measurementUnits";
import { convertFoodPortionToGrams, getGlobalFoodCatalogItem } from "./service";
import { resolveSafeCountableCatalogGrams } from "../../countableFoodQuantity";

type CountableMealItemIdentity = {
  foodName: string;
  brand?: string | null;
  brandName?: string | null;
  productVariant?: string | null;
  foodId?: number | null;
  foodVariantId?: number | null;
  nutritionProfileId?: number | null;
  foodPortionId?: number | null;
  foodCatalogId?: number | null;
  portionId?: number | null;
  portionQuantity?: number | null;
  resolution?: { productVariant?: string | null } | null;
};

type CountableIncrementUnit = "fatia" | "unidade";

function hasPersistedFoodIdentity(item: CountableMealItemIdentity) {
  return (
    item.foodId != null ||
    item.foodVariantId != null ||
    item.nutritionProfileId != null ||
    item.foodPortionId != null ||
    item.foodCatalogId != null ||
    item.portionId != null ||
    item.portionQuantity != null ||
    Boolean(
      item.brand?.trim() ||
        item.brandName?.trim() ||
        item.productVariant?.trim() ||
        item.resolution?.productVariant?.trim()
    )
  );
}

/** Historical/local items may use the canonical catalog measure only when no persisted identity exists. */
export async function getLocalCountableIncrementGrams(input: {
  userId: number;
  item: CountableMealItemIdentity;
  quantity: number;
  unit: CountableIncrementUnit;
}): Promise<number | null> {
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    input.item.brand?.trim() ||
    input.item.brandName?.trim() ||
    input.item.productVariant?.trim() ||
    input.item.resolution?.productVariant?.trim() ||
    input.item.foodId != null ||
    input.item.foodVariantId != null ||
    input.item.nutritionProfileId != null ||
    input.item.foodPortionId != null ||
    input.item.foodCatalogId != null ||
    input.item.portionId != null ||
    input.item.portionQuantity != null
  )
    return null;

  return (
    resolveSafeCountableCatalogGrams(
      input.item.foodName,
      input.quantity,
      input.unit,
      true
    )?.grams ?? null
  );
}

/**
 * The foods domain owns the persisted-identity boundary for countable increments.
 * Local catalog estimation is allowed only for a historical item with no global,
 * commercial, catalog, profile, variant, or portion identity at all.
 */
export async function getCountableIncrementGrams(input: {
  userId: number;
  item: CountableMealItemIdentity;
  quantity: number;
  unit: CountableIncrementUnit;
}): Promise<number | null> {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) return null;

  if (!hasPersistedFoodIdentity(input.item)) {
    return getLocalCountableIncrementGrams(input);
  }

  const { item } = input;
  const foodId = item.foodId;
  const foodVariantId = item.foodVariantId ?? null;
  const foodPortionId = item.foodPortionId ?? null;
  const hasCommercialIdentity = Boolean(
    item.brand?.trim() ||
      item.brandName?.trim() ||
      item.productVariant?.trim() ||
      item.resolution?.productVariant?.trim()
  );
  if (
    typeof foodId !== "number" ||
    !Number.isSafeInteger(foodId) ||
    foodId <= 0 ||
    (foodVariantId !== null &&
      (!Number.isSafeInteger(foodVariantId) || foodVariantId <= 0)) ||
    (foodPortionId !== null &&
      (!Number.isSafeInteger(foodPortionId) || foodPortionId <= 0)) ||
    (hasCommercialIdentity && foodVariantId === null)
  )
    return null;

  try {
    const food = await getGlobalFoodCatalogItem(input.userId, foodId);
    const matching = food.portions.filter(
      portion =>
        (portion.foodVariantId ?? null) === foodVariantId &&
        measurementLabelMatchesUnit(portion.label, portion.unit, input.unit)
    );
    const portion =
      foodPortionId === null
        ? matching.length === 1
          ? matching[0]
          : null
        : (matching.find(candidate => candidate.id === foodPortionId) ?? null);
    if (!portion) return null;

    const converted = await convertFoodPortionToGrams(input.userId, {
      foodId,
      portionId: portion.id,
      quantity: input.quantity,
      foodVariantId,
    });
    return converted.grams > 0 ? converted.grams : null;
  } catch {
    return null;
  }
}
