import { sql, type SQL } from "drizzle-orm";

import { getDb } from "../../db";
import { getGlobalFoodCatalogItem } from "../foods/service";
import type { MealItemInput } from "./schemas";

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
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

function buildSnapshot(params: {
  food: Awaited<ReturnType<typeof getGlobalFoodCatalogItem>>;
  grams: number;
}) {
  const { food, grams } = params;
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

    const grams = item.estimatedGrams > 0 ? item.estimatedGrams : 0;
    if (grams <= 0) {
      enriched.push(item);
      continue;
    }

    const food = await getGlobalFoodCatalogItem(userId, item.foodId);
    const { calculated, snapshot } = buildSnapshot({ food, grams });

    enriched.push({
      ...item,
      canonicalName: food.name,
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
