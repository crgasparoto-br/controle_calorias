import { resolveSafeCountableCatalogGrams } from "../../countableFoodQuantity";

type LocalCountableMealItem = {
  foodName: string;
  brand?: string | null;
  productVariant?: string | null;
  foodCatalogId?: number | null;
  portionId?: number | null;
  portionQuantity?: number | null;
};

/**
 * Uses the canonical registration measure boundary for historical/local items
 * that have no global food ID; ambiguous or more-specific identities fail closed.
 */
export async function getLocalCountableIncrementGrams(input: {
  userId: number;
  item: LocalCountableMealItem;
  quantity: number;
  unit: "fatia" | "unidade";
}): Promise<number | null> {
  if (
    !Number.isFinite(input.quantity) ||
    input.quantity <= 0 ||
    input.item.brand?.trim() ||
    input.item.productVariant?.trim() ||
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
