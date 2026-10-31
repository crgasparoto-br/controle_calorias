import { convertFoodPortionToGrams, getGlobalFoodCatalogItem, recordGlobalFoodUsage } from "../foods/service";
import type { MealItemInput } from "./schemas";
import { mergeConfirmedMealClassification } from "./classificationSnapshot";
import {
  deriveNutritionSourceForMealItem,
  type NutritionSourceSelection,
} from "./nutritionSourceSelection";

type ResolvedMealItemGrams = {
  grams: number;
  portion?: Awaited<ReturnType<typeof convertFoodPortionToGrams>>;
};

export type MealItemWithNutritionSnapshot = MealItemInput & {
  foodId?: number;
  grams?: number;
  caloriesKcal?: number;
  proteinG?: number;
  carbG?: number;
  fatG?: number;
  fiberG?: number | null;
  sodiumMg?: number | null;
  foodSnapshotJson?: string;
  nutritionSource?: NutritionSourceSelection;
};

function roundNutrition(value: number | null | undefined) {
  if (!Number.isFinite(value ?? NaN)) return null;
  return Math.round(Number(value) * 100) / 100;
}

async function resolveMealItemGrams(userId: number, item: MealItemInput): Promise<ResolvedMealItemGrams> {
  if (item.foodId && item.portionId) {
    const portion = await convertFoodPortionToGrams(userId, {
      foodId: item.foodId,
      portionId: item.portionId,
      quantity: item.portionQuantity ?? item.servings,
    });

    return { grams: portion.grams, portion };
  }

  return { grams: item.estimatedGrams > 0 ? item.estimatedGrams : 0 };
}

function buildSnapshot(params: {
  food: Awaited<ReturnType<typeof getGlobalFoodCatalogItem>>;
  grams: number;
  nutritionSource: NutritionSourceSelection;
  portion?: Awaited<ReturnType<typeof convertFoodPortionToGrams>>;
}) {
  const { food, grams, portion, nutritionSource } = params;
  const factor = grams / 100;
  const nutrients = food.nutrientsPer100g;

  const calculated = {
    caloriesKcal: roundNutrition(nutrients.caloriesKcal * factor) ?? 0,
    proteinG: roundNutrition(nutrients.proteinGrams * factor) ?? 0,
    carbG: roundNutrition(nutrients.carbsGrams * factor) ?? 0,
    fatG: roundNutrition(nutrients.fatGrams * factor) ?? 0,
    fiberG: roundNutrition((nutrients.fiberGrams ?? 0) * factor),
    sodiumMg: roundNutrition((nutrients.sodiumMg ?? 0) * factor),
  };

  return {
    calculated,
    snapshot: {
      capturedAt: new Date().toISOString(),
      foodId: food.id,
      scope: food.scope,
      name: food.name,
      brandName: food.brandName,
      category: food.category,
      status: food.status,
      mergedIntoFoodId: food.mergedIntoFoodId,
      source: food.source,
      nutritionSource,
      portion: portion
        ? {
            id: portion.portionId,
            label: portion.label,
            unit: portion.unit,
            quantity: portion.quantity,
            baseQuantity: portion.baseQuantity,
            baseGrams: portion.baseGrams,
          }
        : null,
      grams,
      nutrientsPer100g: nutrients,
      calculated,
    },
  };
}

export type EnrichMealItemsWithNutritionSnapshotsOptions = {
  recordUsage?: boolean;
};

export async function enrichMealItemsWithNutritionSnapshots(
  userId: number,
  items: MealItemInput[],
  options: EnrichMealItemsWithNutritionSnapshotsOptions = {},
) {
  const enriched: MealItemWithNutritionSnapshot[] = [];

  for (const item of items) {
    if (!item.foodId) {
      enriched.push({
        ...item,
        nutritionSource: deriveNutritionSourceForMealItem(item),
      });
      continue;
    }

    const { grams, portion } = await resolveMealItemGrams(userId, item);
    if (grams <= 0) {
      enriched.push({
        ...item,
        nutritionSource: deriveNutritionSourceForMealItem(item),
      });
      continue;
    }

    const food = await getGlobalFoodCatalogItem(userId, item.foodId);
    const nutritionSource = deriveNutritionSourceForMealItem(item, food);
    const { calculated, snapshot } = buildSnapshot({ food, grams, portion, nutritionSource });
    if (options.recordUsage !== false) {
      await recordGlobalFoodUsage(userId, food.id);
    }

    enriched.push({
      ...item,
      canonicalName: food.name,
      portionText: portion ? `${portion.quantity} ${portion.label}` : item.portionText,
      estimatedGrams: grams,
      calories: calculated.caloriesKcal,
      protein: calculated.proteinG,
      carbs: calculated.carbG,
      fat: calculated.fatG,
      foodId: food.id,
      grams,
      caloriesKcal: calculated.caloriesKcal,
      proteinG: calculated.proteinG,
      carbG: calculated.carbG,
      fatG: calculated.fatG,
      fiberG: calculated.fiberG,
      sodiumMg: calculated.sodiumMg,
      foodSnapshotJson: mergeConfirmedMealClassification(JSON.stringify(snapshot), item.classification) ?? undefined,
      nutritionSource,
      source: "catalog",
    });
  }

  return enriched;
}

export async function recordMealItemsCatalogUsage(userId: number, items: MealItemWithNutritionSnapshot[]) {
  for (const item of items) {
    if (item.foodId) {
      await recordGlobalFoodUsage(userId, item.foodId);
    }
  }
}
