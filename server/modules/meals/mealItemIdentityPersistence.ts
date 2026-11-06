import type { MealDraftItem } from "../../nutritionEngine";

type PersistedMealItemIdentity = {
  foodId?: number | null;
  foodVariantId?: number | null;
  nutritionProfileId?: number | null;
  foodPortionId?: number | null;
};

const IDENTITY_FIELDS = [
  "foodId",
  "foodVariantId",
  "nutritionProfileId",
  "foodPortionId",
  "portionId",
] as const;

export function persistedMealItemIdentityValues(item: MealDraftItem) {
  const enriched = item as MealDraftItem & PersistedMealItemIdentity;
  return {
    ...(enriched.foodId !== undefined ? { foodId: enriched.foodId } : {}),
    ...(enriched.foodVariantId !== undefined
      ? { foodVariantId: enriched.foodVariantId }
      : {}),
    ...(enriched.nutritionProfileId !== undefined
      ? { nutritionProfileId: enriched.nutritionProfileId }
      : {}),
    ...(enriched.foodPortionId !== undefined
      ? { foodPortionId: enriched.foodPortionId }
      : {}),
    ...(item.portionId !== undefined ? { portionId: item.portionId } : {}),
  };
}

export function persistedMealItemIdentityUpdate(item: MealDraftItem) {
  const enriched = item as MealDraftItem & PersistedMealItemIdentity;
  return {
    ...(enriched.foodId !== undefined ? { foodId: enriched.foodId } : {}),
    ...(enriched.foodVariantId !== undefined
      ? { foodVariantId: enriched.foodVariantId }
      : {}),
    ...(enriched.nutritionProfileId !== undefined
      ? { nutritionProfileId: enriched.nutritionProfileId }
      : {}),
    ...(enriched.foodPortionId !== undefined
      ? { foodPortionId: enriched.foodPortionId }
      : {}),
    ...(item.portionId !== undefined ? { portionId: item.portionId } : {}),
  };
}

export function clearPersistedMealItemIdentityValues(
  values: Record<string, unknown>
) {
  for (const field of IDENTITY_FIELDS) delete values[field];
}
