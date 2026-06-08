import { sql, type SQL } from "drizzle-orm";

import { getDb } from "../../db";
import { convertFoodPortionToGrams, getGlobalFoodCatalogItem, recordGlobalFoodUsage } from "../foods/service";
import type { MealItemInput } from "./schemas";

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

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
  portion?: Awaited<ReturnType<typeof convertFoodPortionToGrams>>;
}) {
  const { food, grams, portion } = params;
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

export async function enrichMealItemsWithNutritionSnapshots(userId: number, items: MealItemInput[]) {
  const enriched: MealItemWithNutritionSnapshot[] = [];

  for (const item of items) {
    if (!item.foodId) {
      enriched.push(item);
      continue;
    }

    const { grams, portion } = await resolveMealItemGrams(userId, item);
    if (grams <= 0) {
      enriched.push(item);
      continue;
    }

    const food = await getGlobalFoodCatalogItem(userId, item.foodId);
    const { calculated, snapshot } = buildSnapshot({ food, grams, portion });
    await recordGlobalFoodUsage(userId, food.id);

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
      foodSnapshotJson: JSON.stringify(snapshot),
      source: "catalog",
    });
  }

  return enriched;
}

export async function persistMealItemNutritionSnapshots(mealId: number, items: MealItemWithNutritionSnapshot[]) {
  const itemsWithSnapshots = items.filter(item => item.foodId && item.foodSnapshotJson);
  if (!itemsWithSnapshots.length) return;

  const db = await getDb();
  if (!db) return;

  const executor = db as unknown as SqlExecutor;
  for (const item of itemsWithSnapshots) {
    await executor.execute(sql`
      UPDATE mealItems
      SET
        foodId = ${item.foodId ?? null},
        grams = ${item.grams ?? item.estimatedGrams},
        caloriesKcal = ${item.caloriesKcal ?? item.calories},
        proteinG = ${item.proteinG ?? item.protein},
        carbG = ${item.carbG ?? item.carbs},
        fatG = ${item.fatG ?? item.fat},
        fiberG = ${item.fiberG ?? null},
        sodiumMg = ${item.sodiumMg ?? null},
        foodSnapshotJson = ${item.foodSnapshotJson ?? null}
      WHERE mealId = ${mealId}
        AND foodName = ${item.foodName}
        AND canonicalName = ${item.canonicalName}
        AND portionText = ${item.portionText}
    `);
  }
}
