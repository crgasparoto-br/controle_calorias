/**
 * Capture only the V1 fields consumed by asynchronous shadow comparison.
 * Do not keep raw messages, media, reasoning or semantic evidence.
 */
import type { CanonicalMealProcessingResult, MealDraftItem, MealItemResolutionMetadata } from "../../nutritionEngineTypes";

export type FoodShadowV1Item = Readonly<
  Pick<MealDraftItem,
    | "historicalRef" | "foodName" | "canonicalName" | "brand" | "productVariant"
    | "quantity" | "unit" | "estimatedGrams" | "calories" | "protein"
    | "carbs" | "fat" | "confidence"
  > & { resolution?: Readonly<Pick<MealItemResolutionMetadata, "nutritionOrigin">> | null }
>;

export type FoodShadowV1Snapshot = Readonly<{
  items: readonly FoodShadowV1Item[];
  semanticContract: Readonly<Pick<CanonicalMealProcessingResult["semanticContract"], "needsClarification">>;
}>;

export function snapshotFoodV1ForShadow(result: CanonicalMealProcessingResult): FoodShadowV1Snapshot {
  const items = result.items.map(item => Object.freeze({
    historicalRef: item.historicalRef,
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    brand: item.brand,
    productVariant: item.productVariant,
    quantity: item.quantity,
    unit: item.unit,
    estimatedGrams: item.estimatedGrams,
    calories: item.calories,
    protein: item.protein,
    carbs: item.carbs,
    fat: item.fat,
    confidence: item.confidence,
    resolution: item.resolution
      ? Object.freeze({ nutritionOrigin: item.resolution.nutritionOrigin })
      : null,
  }));
  return Object.freeze({
    items: Object.freeze(items),
    semanticContract: Object.freeze({ needsClarification: result.semanticContract.needsClarification }),
  });
}
