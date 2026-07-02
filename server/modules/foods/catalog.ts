import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { fuzzyMatchesWords } from "../../fuzzyTextMatch";
import { foodCatalogDirectKey } from "../../foodCatalogKeys";
import type { FoodCatalogRepository } from "../../repositories/foodCatalogRepository";
import type { MealDraftItem } from "../../nutritionEngine";
import type { FoodProcessingLevel } from "../../../shared/reportsGoalAnalytics";

export type FoodSearchItem = {
  id: number;
  name: string;
  brandName?: string | null;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  processingLevel?: FoodProcessingLevel;
  isFruit: boolean;
  isVegetable: boolean;
  isUltraProcessed: boolean;
  source: string;
  foodType: "generic" | "branded";
  isUserCreated: boolean;
  createdByUserId?: number | null;
  isFavorite: boolean;
  lastUsedAt?: number | null;
};

export type FoodUpsertInput = {
  foodId?: number;
  name: string;
  brandName?: string | null;
  servingSize: number;
  servingUnit: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber?: number | null;
  isFruit?: boolean;
  isVegetable?: boolean;
  isUltraProcessed?: boolean;
  source: string;
  foodType: "generic" | "branded";
};

const referenceFoods: FoodSearchItem[] = FOOD_CATALOG_REFERENCE.map((food, index) => ({
  id: index + 1,
  name: food.name,
  brandName: null,
  servingSize: food.gramsPerServing,
  servingUnit: food.servingLabel.replace(String(food.gramsPerServing), "").trim() || "porção",
  calories: food.calories,
  protein: food.protein,
  carbs: food.carbs,
  fat: food.fat,
  fiber: null,
  processingLevel: food.processingLevel,
  isFruit: false,
  isVegetable: false,
  isUltraProcessed: false,
  source: "catalog",
  foodType: "generic",
  isUserCreated: false,
  createdByUserId: null,
  isFavorite: false,
  lastUsedAt: null,
}));

export function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function toSlug(value: string) {
  const normalized = normalizeCatalogText(value).replace(/[\s_]+/g, "-").replace(/-+/g, "-");
  return normalized || `food-${Date.now()}`;
}

function rankFoods(food: FoodSearchItem, query: string) {
  const normalizedQuery = normalizeCatalogText(query);
  const haystack = normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`);
  const exact = normalizedQuery && haystack.startsWith(normalizedQuery) ? 4 : 0;
  const favorite = food.isFavorite ? 3 : 0;
  const recent = food.lastUsedAt ? 2 : 0;
  const userCreated = food.isUserCreated ? 1 : 0;
  return exact + favorite + recent + userCreated;
}

function parseJsonArray<T>(value: string | null | undefined, fallback: T[]): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function setResolvedCatalogId(resolved: Map<string, number>, key: string | null | undefined, foodCatalogId: number) {
  if (key?.trim()) {
    resolved.set(key, foodCatalogId);
  }
}

export function createFoodsService(deps: {
  foodCatalogRepository: FoodCatalogRepository;
  findMealItemsWithDates: (userId: number) => Promise<Array<{ canonicalName?: string | null; foodName: string; occurredAt: number }>>;
  getUserMealsMemory: (userId: number) => Array<{ items: MealDraftItem[]; occurredAt: number }>;
  getDb: () => Promise<unknown>;
  onWarning: (scope: string, error: unknown) => void;
}) {
  const userFoodStore = new Map<number, FoodSearchItem[]>();
  const favoriteFoodStore = new Map<number, Set<number>>();
  let foodIdSequence = 10000;
  let dbSearchContext: { userId: number; promise: Promise<FoodSearchItem[]> } | null = null;

  function getMemoryFoodsForUser(userId: number) {
    const favorites = favoriteFoodStore.get(userId) ?? new Set<number>();
    const userFoods = userFoodStore.get(userId) ?? [];
    const recentMeals = deps.getUserMealsMemory(userId);
    const recentByName = new Map<string, number>();

    for (const meal of recentMeals) {
      for (const item of meal.items) {
        const key = normalizeCatalogText(item.canonicalName || item.foodName);
        recentByName.set(key, Math.max(recentByName.get(key) ?? 0, meal.occurredAt));
      }
    }

    return [...userFoods, ...referenceFoods].map(food => {
      const lastUsedAt = recentByName.get(normalizeCatalogText(food.name)) ?? food.lastUsedAt ?? null;
      return {
        ...food,
        isFavorite: favorites.has(food.id),
        lastUsedAt,
      };
    });
  }

  async function loadFavoriteFoodIdsFromDb(userId: number) {
    const db = await deps.getDb();
    if (!db) return favoriteFoodStore.get(userId) ?? new Set<number>();

    const ids = await deps.foodCatalogRepository.findFavoriteIdsByUserId(userId);
    favoriteFoodStore.set(userId, ids);
    return ids;
  }

  async function loadRecentFoodUsageFromDb(userId: number) {
    const db = await deps.getDb();
    if (!db) return new Map<string, number>();

    try {
      const items = await deps.findMealItemsWithDates(userId);
      const usage = new Map<string, number>();
      for (const item of items) {
        const key = normalizeCatalogText(item.canonicalName || item.foodName);
        usage.set(key, Math.max(usage.get(key) ?? 0, item.occurredAt));
      }
      return usage;
    } catch (error) {
      deps.onWarning("Recent foods read skipped", error);
      return new Map<string, number>();
    }
  }

  async function loadDbSearchFoods(userId: number) {
    const [favorites, rows, usage] = await Promise.all([
      loadFavoriteFoodIdsFromDb(userId),
      deps.foodCatalogRepository.findAll(),
      loadRecentFoodUsageFromDb(userId),
    ]);

    return rows
      .filter(row => !row.createdByUserId || row.createdByUserId === userId)
      .map(row => {
        const lastUsedAt = usage.get(normalizeCatalogText(row.name)) ?? null;
        return {
          id: row.id,
          name: row.name,
          brandName: row.brandName,
          servingSize: row.gramsPerServing,
          servingUnit: row.servingUnit,
          calories: row.calories,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
          fiber: row.fiber,
          isFruit: row.isFruit === 1,
          isVegetable: row.isVegetable === 1,
          isUltraProcessed: row.isUltraProcessed === 1,
          source: row.dataSource,
          foodType: row.foodType,
          isUserCreated: row.isUserCreated === 1,
          createdByUserId: row.createdByUserId,
          isFavorite: favorites.has(row.id),
          lastUsedAt,
        } satisfies FoodSearchItem;
      });
  }

  async function getDbSearchFoods(userId: number) {
    if (dbSearchContext?.userId === userId) {
      return dbSearchContext.promise;
    }

    const promise = loadDbSearchFoods(userId);
    dbSearchContext = { userId, promise };

    try {
      return await promise;
    } finally {
      if (dbSearchContext?.promise === promise) {
        dbSearchContext = null;
      }
    }
  }

  async function searchFoods(userId: number, query = "", limit = 20) {
    const normalizedQuery = normalizeCatalogText(query);
    const db = await deps.getDb();

    if (db) {
      try {
        const foods = await getDbSearchFoods(userId);
        return foods
          .filter(food => {
            if (!normalizedQuery) return true;
            const haystack = normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`);
            return haystack.includes(normalizedQuery) || fuzzyMatchesWords(normalizedQuery, haystack);
          })
          .sort((a, b) => rankFoods(b, query) - rankFoods(a, query) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
          .slice(0, limit);
      } catch (error) {
        deps.onWarning("Food search read skipped", error);
      }
    }

    return getMemoryFoodsForUser(userId)
      .filter(food => !normalizedQuery || normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`).includes(normalizedQuery))
      .sort((a, b) => rankFoods(b, query) - rankFoods(a, query) || (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) || a.name.localeCompare(b.name))
      .slice(0, limit);
  }

  async function listRecentFoods(userId: number, limit = 10) {
    return (await searchFoods(userId, "", 100)).filter(food => food.lastUsedAt).slice(0, limit);
  }

  async function upsertFavoriteFood(userId: number, foodId: number, favorite: boolean) {
    const favorites = new Set(favoriteFoodStore.get(userId) ?? []);
    if (favorite) favorites.add(foodId);
    else favorites.delete(foodId);
    favoriteFoodStore.set(userId, favorites);

    const db = await deps.getDb();
    if (db) {
      try {
        if (favorite) {
          await deps.foodCatalogRepository.upsertFavorite(userId, foodId);
        } else {
          await deps.foodCatalogRepository.deleteFavorite(userId, foodId);
        }
      } catch (error) {
        deps.onWarning("Food favorite write skipped", error);
      }
    }

    const [food] = await searchFoods(userId, "", 200);
    return (await searchFoods(userId, "", 200)).find(item => item.id === foodId) ?? food;
  }

  async function createUserFood(userId: number, input: FoodUpsertInput) {
    const food: FoodSearchItem = {
      id: foodIdSequence++,
      name: input.name,
      brandName: input.brandName ?? null,
      servingSize: input.servingSize,
      servingUnit: input.servingUnit,
      calories: input.calories,
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
      fiber: input.fiber ?? null,
      isFruit: input.isFruit ?? false,
      isVegetable: input.isVegetable ?? false,
      isUltraProcessed: input.isUltraProcessed ?? false,
      source: input.source || "manual",
      foodType: input.foodType,
      isUserCreated: true,
      createdByUserId: userId,
      isFavorite: false,
      lastUsedAt: null,
    };

    const db = await deps.getDb();
    if (db) {
      try {
        const insertedId = await deps.foodCatalogRepository.insert({
          slug: `${toSlug(`${input.brandName ?? ""} ${input.name}`)}-${userId}-${Date.now()}`,
          name: input.name,
          aliases: JSON.stringify([]),
          brandName: input.brandName ?? null,
          foodType: input.foodType,
          dataSource: input.source || "manual",
          servingLabel: `${input.servingSize} ${input.servingUnit}`,
          servingUnit: input.servingUnit,
          gramsPerServing: input.servingSize,
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber ?? null,
          isFruit: input.isFruit ? 1 : 0,
          isVegetable: input.isVegetable ? 1 : 0,
          isUltraProcessed: input.isUltraProcessed ? 1 : 0,
          isUserCreated: 1,
          createdByUserId: userId,
        });
        if (insertedId) food.id = insertedId;
      } catch (error) {
        deps.onWarning("Food creation persistence skipped", error);
      }
    }

    const current = userFoodStore.get(userId) ?? [];
    userFoodStore.set(userId, [food, ...current]);
    return food;
  }

  async function updateUserFood(userId: number, input: FoodUpsertInput & { foodId: number }) {
    const current = userFoodStore.get(userId) ?? [];
    const existing = current.find(food => food.id === input.foodId);
    if (!existing) {
      const dbFoods = await searchFoods(userId, "", 200);
      const dbExisting = dbFoods.find(food => food.id === input.foodId && food.isUserCreated && food.createdByUserId === userId);
      if (!dbExisting) {
        throw new Error("Alimento criado pelo usuário não encontrado.");
      }
    }

    const updated: FoodSearchItem = {
      ...(existing ?? { id: input.foodId, isFavorite: false, lastUsedAt: null }),
      id: input.foodId,
      name: input.name,
      brandName: input.brandName ?? null,
      servingSize: input.servingSize,
      servingUnit: input.servingUnit,
      calories: input.calories,
      protein: input.protein,
      carbs: input.carbs,
      fat: input.fat,
      fiber: input.fiber ?? null,
      isFruit: input.isFruit ?? false,
      isVegetable: input.isVegetable ?? false,
      isUltraProcessed: input.isUltraProcessed ?? false,
      source: input.source || "manual",
      foodType: input.foodType,
      isUserCreated: true,
      createdByUserId: userId,
    };

    const db = await deps.getDb();
    if (db) {
      try {
        await deps.foodCatalogRepository.update(input.foodId, userId, {
          name: input.name,
          brandName: input.brandName ?? null,
          foodType: input.foodType,
          dataSource: input.source || "manual",
          servingLabel: `${input.servingSize} ${input.servingUnit}`,
          servingUnit: input.servingUnit,
          gramsPerServing: input.servingSize,
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber ?? null,
          isFruit: input.isFruit ? 1 : 0,
          isVegetable: input.isVegetable ? 1 : 0,
          isUltraProcessed: input.isUltraProcessed ? 1 : 0,
        });
      } catch (error) {
        deps.onWarning("Food update persistence skipped", error);
      }
    }

    userFoodStore.set(userId, [updated, ...current.filter(food => food.id !== input.foodId)]);
    return updated;
  }

  async function resolveFoodCatalogIds(items: MealDraftItem[]) {
    const db = await deps.getDb();
    if (!db || !items.length) {
      return new Map<string, number>();
    }

    try {
      const rows = await deps.foodCatalogRepository.findAll();
      const validCatalogIds = new Set(rows.map(row => row.id));
      const catalogIndex = new Map<string, number>();

      for (const row of rows) {
        const aliases = parseJsonArray<string>(row.aliases, []);
        const keys = [row.name, ...aliases].map(normalizeCatalogText);
        for (const key of keys) {
          if (key) {
            catalogIndex.set(key, row.id);
          }
        }
      }

      const resolved = new Map<string, number>();
      for (const item of items) {
        const directId = Number(item.foodCatalogId);
        if (Number.isFinite(directId) && directId > 0 && validCatalogIds.has(directId)) {
          resolved.set(foodCatalogDirectKey(directId), directId);
          setResolvedCatalogId(resolved, item.canonicalName, directId);
          setResolvedCatalogId(resolved, item.foodName, directId);
          continue;
        }

        const directKey = normalizeCatalogText(item.canonicalName);
        const fallbackKey = normalizeCatalogText(item.foodName);
        const resolvedId = catalogIndex.get(directKey) ?? catalogIndex.get(fallbackKey);
        if (resolvedId) {
          setResolvedCatalogId(resolved, item.canonicalName, resolvedId);
          setResolvedCatalogId(resolved, item.foodName, resolvedId);
        }
      }
      return resolved;
    } catch (error) {
      deps.onWarning("Food catalog resolution skipped", error);
      return new Map<string, number>();
    }
  }

  function clearMemory(userId: number) {
    userFoodStore.delete(userId);
    favoriteFoodStore.delete(userId);
  }

  return {
    searchFoods,
    listRecentFoods,
    upsertFavoriteFood,
    createUserFood,
    updateUserFood,
    resolveFoodCatalogIds,
    clearMemory,
  };
}

export type FoodsService = ReturnType<typeof createFoodsService>;
