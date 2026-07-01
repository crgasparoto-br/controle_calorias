import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { normalizeCatalogText, type FoodSearchItem } from "../foods/catalog";
import { roundNutritionValue } from "../../../shared/mealTotals";
import type { FoodQualityDay, FoodQualityUnclassifiedReason } from "../../../shared/reportsGoalAnalytics";

export type FoodLookupEntry = {
  id?: number;
  fiber?: number | null;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  servingSize: number;
};

export type FoodLookup = {
  foodsById: Map<number, FoodLookupEntry>;
  foodsByName: Map<string, FoodLookupEntry>;
  fuzzyMatchers: Array<{ key: string; entry: FoodLookupEntry }>;
};

export type MealFoodQualityItem = {
  foodCatalogId?: number | null;
  foodName: string;
  canonicalName: string;
  portionText: string;
  servings: number;
  estimatedGrams: number;
  calories: number;
  protein: number;
};

export type MealForFoodQuality = {
  mealLabel: string;
  items: MealFoodQualityItem[];
};

export function createFoodLookup(foods: FoodSearchItem[]): FoodLookup {
  const foodsById = new Map<number, FoodLookupEntry>();
  const foodsByName = new Map<string, FoodLookupEntry>();

  for (const food of FOOD_CATALOG_REFERENCE) {
    const entry: FoodLookupEntry = {
      fiber: food.fiber ?? null,
      isFruit: Boolean(food.isFruit),
      isVegetable: Boolean(food.isVegetable),
      isUltraProcessed: Boolean(food.isUltraProcessed),
      servingSize: food.gramsPerServing,
    };

    foodsByName.set(normalizeCatalogText(food.name), entry);
    for (const alias of food.aliases) {
      foodsByName.set(normalizeCatalogText(alias), entry);
    }
  }

  for (const food of foods) {
    const existing = foodsByName.get(normalizeCatalogText(food.name));
    const entry: FoodLookupEntry = {
      id: food.id,
      fiber: food.fiber ?? existing?.fiber ?? null,
      isFruit: food.isFruit || existing?.isFruit || false,
      isVegetable: food.isVegetable || existing?.isVegetable || false,
      isUltraProcessed: food.isUltraProcessed || existing?.isUltraProcessed || false,
      servingSize: food.servingSize || existing?.servingSize || 0,
    };
    foodsByName.set(normalizeCatalogText(food.name), entry);
    if (Number.isFinite(food.id) && food.id > 0) {
      foodsById.set(food.id, entry);
    }
  }

  const fuzzyMatchers = Array.from(foodsByName.entries())
    .filter(([key, entry]) => key.length >= 4 && (entry.isVegetable || entry.isFruit || entry.isUltraProcessed || entry.fiber))
    .sort((first, second) => second[0].length - first[0].length)
    .map(([key, entry]) => ({ key, entry }));

  return {
    foodsById,
    foodsByName,
    fuzzyMatchers,
  };
}

function resolveFoodLookupEntryByText(foodLookup: FoodLookup, ...names: Array<string | undefined>) {
  for (const name of names) {
    if (!name) continue;
    const normalized = normalizeCatalogText(name);
    const exact = foodLookup.foodsByName.get(normalized);
    if (exact) return exact;

    const fuzzy = foodLookup.fuzzyMatchers.find(candidate => normalized.includes(candidate.key) || candidate.key.includes(normalized));
    if (fuzzy) return fuzzy.entry;
  }

  return null;
}

function resolveFoodLookupEntry(foodLookup: FoodLookup, item: MealFoodQualityItem) {
  if (item.foodCatalogId) {
    const byId = foodLookup.foodsById.get(item.foodCatalogId);
    if (byId) return byId;
  }

  return resolveFoodLookupEntryByText(foodLookup, item.canonicalName, item.foodName, item.portionText);
}

function getUnclassifiedReason(item: MealFoodQualityItem, hasLookup: boolean): FoodQualityUnclassifiedReason {
  if (!hasLookup) return "unknown";
  if (item.foodCatalogId) return "catalog_id_not_found";
  return "missing_catalog_id";
}

function buildUnclassifiedFoodQualityItem(
  item: MealFoodQualityItem,
  calories: number,
  reason: FoodQualityUnclassifiedReason,
): FoodQualityDay["items"][number] {
  return {
    calories,
    foodCatalogId: item.foodCatalogId ?? null,
    foodName: item.foodName,
    canonicalName: item.canonicalName,
    portionText: item.portionText,
    isClassified: false,
    unclassifiedReason: reason,
  };
}

function calculateRegularityScore(meals: Array<{ mealLabel: string }>) {
  if (!meals.length) return 0;
  const labels = new Set(meals.map(meal => normalizeCatalogText(meal.mealLabel)));
  const hasMainMeal = ["cafe da manha", "almoco", "jantar"].filter(label => labels.has(label)).length;
  return Math.min(Math.round(((Math.min(meals.length, 4) / 4) * 60) + ((hasMainMeal / 3) * 40)), 100);
}

export function calculateQualityIndicators(
  meals: MealForFoodQuality[],
  waterMl: number,
  foodLookup?: FoodLookup,
) {
  if (!meals.length) {
    return {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: roundNutritionValue(waterMl),
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
      foodQualityItems: [] as FoodQualityDay["items"],
    };
  }

  const quality = meals.reduce(
    (acc, meal) => {
      for (const item of meal.items) {
        const itemCalories = Number(item.calories || 0);
        acc.proteinGrams += Number(item.protein || 0);

        if (!foodLookup) {
          acc.foodQualityItems.push(buildUnclassifiedFoodQualityItem(item, itemCalories, "unknown"));
          continue;
        }

        const food = resolveFoodLookupEntry(foodLookup, item);
        if (!food) {
          acc.foodQualityItems.push(buildUnclassifiedFoodQualityItem(item, itemCalories, getUnclassifiedReason(item, true)));
          continue;
        }

        const servingFactor = food.servingSize > 0 && item.estimatedGrams > 0 ? item.estimatedGrams / food.servingSize : item.servings || 1;
        acc.fiberGrams += Number(food.fiber || 0) * servingFactor;
        if (food.isFruit) acc.fruitServings += servingFactor;
        if (food.isVegetable) acc.vegetableServings += servingFactor;
        if (food.isUltraProcessed) acc.ultraProcessedServings += servingFactor;
        acc.foodQualityItems.push({
          calories: itemCalories,
          isClassified: true,
          isFruit: food.isFruit,
          isVegetable: food.isVegetable,
          isUltraProcessed: food.isUltraProcessed,
        });
      }
      return acc;
    },
    {
      proteinGrams: 0,
      fiberGrams: 0,
      waterMl: roundNutritionValue(waterMl),
      fruitServings: 0,
      vegetableServings: 0,
      ultraProcessedServings: 0,
      mealCount: 0,
      regularityScore: 0,
      foodQualityItems: [] as FoodQualityDay["items"],
    },
  );

  quality.mealCount = meals.length;
  quality.regularityScore = calculateRegularityScore(meals);

  return {
    proteinGrams: roundNutritionValue(quality.proteinGrams),
    fiberGrams: roundNutritionValue(quality.fiberGrams),
    waterMl: roundNutritionValue(waterMl),
    fruitServings: roundNutritionValue(quality.fruitServings),
    vegetableServings: roundNutritionValue(quality.vegetableServings),
    ultraProcessedServings: roundNutritionValue(quality.ultraProcessedServings),
    mealCount: quality.mealCount,
    regularityScore: quality.regularityScore,
    foodQualityItems: quality.foodQualityItems,
  };
}
