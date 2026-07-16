import { FOOD_CATALOG_REFERENCE } from "../../foodCatalogReference";
import { fuzzyMatchesWords } from "../../fuzzyTextMatch";
import { foodCatalogDirectKey } from "../../foodCatalogKeys";
import type { FoodCatalogRepository } from "../../repositories/foodCatalogRepository";
import type { MealDraftItem } from "../../nutritionEngine";
import type { FoodProcessingLevel } from "../../../shared/reportsGoalAnalytics";
import {
  clearDeprecatedFoodRegistry,
  getDeprecatedIdentityKeys,
  isFoodDeprecatedInMemory,
  registerDeprecatedFoodCleanup,
} from "./deprecationRegistry";

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
  status?: "active" | "deprecated";
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

const referenceFoods: FoodSearchItem[] = FOOD_CATALOG_REFERENCE.map(
  (food, index) => ({
    id: index + 1,
    name: food.name,
    brandName: null,
    servingSize: food.gramsPerServing,
    servingUnit:
      food.servingLabel.replace(String(food.gramsPerServing), "").trim() ||
      "porção",
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
  })
);

export function normalizeCatalogText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s-]/g, "")
    .toLowerCase()
    .trim();
}

function toSlug(value: string) {
  const normalized = normalizeCatalogText(value)
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-");
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

function parseJsonArray<T>(
  value: string | null | undefined,
  fallback: T[]
): T[] {
  if (!value) return fallback;
  try {
    const parsed = JSON.parse(value) as T[];
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function setResolvedCatalogId(
  resolved: Map<string, number>,
  key: string | null | undefined,
  foodCatalogId: number
) {
  if (key?.trim()) {
    resolved.set(key, foodCatalogId);
  }
}

function foodAlreadyMatchesInput(food: FoodSearchItem, input: FoodUpsertInput) {
  return (
    food.name === input.name &&
    (food.brandName ?? null) === (input.brandName ?? null) &&
    food.servingSize === input.servingSize &&
    food.servingUnit === input.servingUnit &&
    food.calories === input.calories &&
    food.protein === input.protein &&
    food.carbs === input.carbs &&
    food.fat === input.fat &&
    (food.fiber ?? null) === (input.fiber ?? null) &&
    food.isFruit === (input.isFruit ?? false) &&
    food.isVegetable === (input.isVegetable ?? false) &&
    food.isUltraProcessed === (input.isUltraProcessed ?? false) &&
    food.source === (input.source || "manual") &&
    food.foodType === input.foodType
  );
}

export function createFoodsService(deps: {
  foodCatalogRepository: FoodCatalogRepository;
  findMealItemsWithDates: (userId: number) => Promise<
    Array<{
      canonicalName?: string | null;
      foodName: string;
      occurredAt: number;
    }>
  >;
  getUserMealsMemory: (
    userId: number
  ) => Array<{ items: MealDraftItem[]; occurredAt: number }>;
  getDb: () => Promise<unknown>;
  onWarning: (scope: string, error: unknown) => void;
}) {
  const userFoodStore = new Map<number, FoodSearchItem[]>();
  const favoriteFoodStore = new Map<number, Set<number>>();

  registerDeprecatedFoodCleanup((deprecatedUserId, foodId) => {
    const foods = userFoodStore.get(deprecatedUserId);
    if (foods) {
      userFoodStore.set(
        deprecatedUserId,
        foods.filter(food => food.id !== foodId)
      );
    }

    const favorites = favoriteFoodStore.get(deprecatedUserId);
    if (favorites) {
      const updatedFavorites = new Set(favorites);
      updatedFavorites.delete(foodId);
      favoriteFoodStore.set(deprecatedUserId, updatedFavorites);
    }
  });

  let foodIdSequence = 10000;
  let dbSearchContext: {
    userId: number;
    promise: Promise<FoodSearchItem[]>;
  } | null = null;

  function getMemoryFoodsForUser(userId: number) {
    const favorites = favoriteFoodStore.get(userId) ?? new Set<number>();
    const userFoods = userFoodStore.get(userId) ?? [];
    const recentMeals = deps.getUserMealsMemory(userId);
    const recentByName = new Map<string, number>();

    for (const meal of recentMeals) {
      for (const item of meal.items) {
        const key = normalizeCatalogText(item.canonicalName || item.foodName);
        recentByName.set(
          key,
          Math.max(recentByName.get(key) ?? 0, meal.occurredAt)
        );
      }
    }

    return [...userFoods, ...referenceFoods]
      .filter(food => !isFoodDeprecatedInMemory(userId, food.id))
      .map(food => {
        const lastUsedAt =
          recentByName.get(normalizeCatalogText(food.name)) ??
          food.lastUsedAt ??
          null;
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

    const ids =
      await deps.foodCatalogRepository.findFavoriteIdsByUserId(userId);
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

  function mapCatalogRow(
    row: Awaited<ReturnType<FoodCatalogRepository["findAll"]>>[number],
    favorites: Set<number>,
    usage: Map<string, number>
  ): FoodSearchItem {
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
      processingLevel: row.processingLevel ?? undefined,
      isFruit: row.isFruit === 1,
      isVegetable: row.isVegetable === 1,
      isUltraProcessed: row.isUltraProcessed === 1,
      source: row.dataSource,
      foodType: row.foodType,
      isUserCreated: row.isUserCreated === 1,
      createdByUserId: row.createdByUserId,
      status: row.status ?? "active",
      isFavorite:
        (row.status ?? "active") === "active" && favorites.has(row.id),
      lastUsedAt: usage.get(normalizeCatalogText(row.name)) ?? null,
    };
  }

  async function loadDbSearchFoods(userId: number) {
    const [favorites, allRows, usage] = await Promise.all([
      loadFavoriteFoodIdsFromDb(userId),
      deps.foodCatalogRepository.findActiveForUser
        ? deps.foodCatalogRepository.findActiveForUser(userId)
        : deps.foodCatalogRepository.findAll(),
      loadRecentFoodUsageFromDb(userId),
    ]);

    return allRows
      .filter(row => (row.status ?? "active") === "active")
      .filter(row => !row.createdByUserId || row.createdByUserId === userId)
      .filter(row => !isFoodDeprecatedInMemory(userId, row.id))
      .map(row => mapCatalogRow(row, favorites, usage));
  }

  async function getFoodsByIds(userId: number, ids: number[]) {
    if (!ids.length) return [];
    const uniqueIds = Array.from(new Set(ids));
    const db = await deps.getDb();

    if (!db) {
      const historicalFoods = [
        ...(userFoodStore.get(userId) ?? []),
        ...referenceFoods,
      ];
      return historicalFoods.filter(food => uniqueIds.includes(food.id));
    }

    const [favorites, rows] = await Promise.all([
      loadFavoriteFoodIdsFromDb(userId),
      deps.foodCatalogRepository.findByIdsForUser
        ? deps.foodCatalogRepository.findByIdsForUser(userId, uniqueIds)
        : deps.foodCatalogRepository
            .findAll()
            .then(allRows => allRows.filter(row => uniqueIds.includes(row.id))),
    ]);
    return rows
      .filter(row => !row.createdByUserId || row.createdByUserId === userId)
      .map(row => mapCatalogRow(row, favorites, new Map()));
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
            const haystack = normalizeCatalogText(
              `${food.name} ${food.brandName ?? ""}`
            );
            return (
              haystack.includes(normalizedQuery) ||
              fuzzyMatchesWords(normalizedQuery, haystack)
            );
          })
          .sort(
            (a, b) =>
              rankFoods(b, query) - rankFoods(a, query) ||
              (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) ||
              a.name.localeCompare(b.name)
          )
          .slice(0, limit);
      } catch (error) {
        deps.onWarning("Food search read skipped", error);
      }
    }

    return getMemoryFoodsForUser(userId)
      .filter(
        food =>
          !normalizedQuery ||
          normalizeCatalogText(`${food.name} ${food.brandName ?? ""}`).includes(
            normalizedQuery
          )
      )
      .sort(
        (a, b) =>
          rankFoods(b, query) - rankFoods(a, query) ||
          (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0) ||
          a.name.localeCompare(b.name)
      )
      .slice(0, limit);
  }

  async function listRecentFoods(userId: number, limit = 10) {
    return (await searchFoods(userId, "", 100))
      .filter(food => food.lastUsedAt)
      .slice(0, limit);
  }

  async function upsertFavoriteFood(
    userId: number,
    foodId: number,
    favorite: boolean
  ) {
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
    return (
      (await searchFoods(userId, "", 200)).find(item => item.id === foodId) ??
      food
    );
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

  async function updateUserFood(
    userId: number,
    input: FoodUpsertInput & { foodId: number }
  ) {
    const current = userFoodStore.get(userId) ?? [];
    let existing = current.find(food => food.id === input.foodId);
    if (!existing) {
      const dbFoods = await searchFoods(userId, "", 200);
      existing = dbFoods.find(
        food =>
          food.id === input.foodId &&
          food.isUserCreated &&
          food.createdByUserId === userId
      );
      if (!existing) {
        throw new Error("Alimento criado pelo usuário não encontrado.");
      }
    }

    const updated: FoodSearchItem = {
      ...existing,
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
        const updatedRows = await deps.foodCatalogRepository.update(
          input.foodId,
          userId,
          {
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
          }
        );

        if (updatedRows < 1 && !foodAlreadyMatchesInput(existing, input)) {
          throw new Error("Alimento criado pelo usuário não encontrado.");
        }
      } catch (error) {
        if (
          error instanceof Error &&
          error.message === "Alimento criado pelo usuário não encontrado."
        ) {
          throw error;
        }

        deps.onWarning("Food update persistence failed", error);
        throw new Error("Não foi possível salvar o alimento. Tente novamente.");
      }
    }

    userFoodStore.set(userId, [
      updated,
      ...current.filter(food => food.id !== input.foodId),
    ]);
    return updated;
  }

  function buildAutoClassifiedCatalogSlug(userId: number, name: string) {
    const base =
      normalizeCatalogText(name)
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "alimento";
    return `user-${userId}-${base}-${Date.now()}-${Math.round(Math.random() * 1e6)}`.slice(
      0,
      128
    );
  }

  async function createAutoClassifiedCatalogEntry(
    userId: number,
    item: MealDraftItem
  ) {
    const classification = item.classification;
    if (!classification || !item.estimatedGrams || item.estimatedGrams <= 0) {
      return null;
    }

    try {
      const foodId = await deps.foodCatalogRepository.insert({
        slug: buildAutoClassifiedCatalogSlug(
          userId,
          item.canonicalName || item.foodName
        ),
        name: item.canonicalName || item.foodName,
        aliases: JSON.stringify([item.foodName].filter(Boolean)),
        brandName: item.brand ?? null,
        foodType: "generic",
        dataSource: "ai_estimated",
        servingLabel: item.portionText || `${item.estimatedGrams} g`,
        servingUnit: item.unit || "g",
        gramsPerServing: item.estimatedGrams,
        calories: item.calories,
        protein: item.protein,
        carbs: item.carbs,
        fat: item.fat,
        fiber: classification.fiberGrams,
        isFruit: classification.isFruit ? 1 : 0,
        isVegetable: classification.isVegetable ? 1 : 0,
        isUltraProcessed:
          classification.processingLevel === "ultra_processed" ? 1 : 0,
        processingLevel: classification.processingLevel,
        classificationSource: "ai_estimated",
        classificationConfidence: item.confidence,
        isUserCreated: 1,
        createdByUserId: userId,
      });
      return foodId > 0 ? foodId : null;
    } catch (error) {
      deps.onWarning("Auto food classification persistence skipped", error);
      return null;
    }
  }

  function rowIdentityKeys(
    row: Awaited<ReturnType<FoodCatalogRepository["findAll"]>>[number]
  ) {
    return [row.name, ...parseJsonArray<string>(row.aliases, [])]
      .map(normalizeCatalogText)
      .filter(Boolean);
  }

  async function resolveFoodCatalogIds(items: MealDraftItem[], userId: number) {
    const db = await deps.getDb();
    if (!db || !items.length) return new Map<string, number>();

    try {
      const rows = deps.foodCatalogRepository.findForResolution
        ? await deps.foodCatalogRepository.findForResolution(userId)
        : (await deps.foodCatalogRepository.findAll()).filter(
            row => !row.createdByUserId || row.createdByUserId === userId
          );
      const scopedRows = rows.filter(
        row => !row.createdByUserId || row.createdByUserId === userId
      );
      const activeRows = scopedRows.filter(
        row =>
          (row.status ?? "active") === "active" &&
          !isFoodDeprecatedInMemory(userId, row.id)
      );
      const deprecatedOwnRows = scopedRows.filter(
        row =>
          row.createdByUserId === userId &&
          (row.status ?? "active") === "deprecated"
      );
      const activeOwnKeys = new Set(
        activeRows
          .filter(row => row.createdByUserId === userId)
          .flatMap(rowIdentityKeys)
      );
      const blockedKeys = getDeprecatedIdentityKeys(userId);
      for (const key of activeOwnKeys) blockedKeys.delete(key);
      for (const row of deprecatedOwnRows) {
        for (const key of rowIdentityKeys(row)) {
          if (!activeOwnKeys.has(key)) blockedKeys.add(key);
        }
      }

      const validCatalogIds = new Set(activeRows.map(row => row.id));
      const catalogIndex = new Map<string, number>();
      for (const row of activeRows.filter(row => !row.createdByUserId)) {
        for (const key of rowIdentityKeys(row)) {
          if (!blockedKeys.has(key)) catalogIndex.set(key, row.id);
        }
      }
      for (const row of activeRows.filter(
        row => row.createdByUserId === userId
      )) {
        for (const key of rowIdentityKeys(row)) catalogIndex.set(key, row.id);
      }

      const resolved = new Map<string, number>();
      for (const item of items) {
        const directId = Number(item.foodCatalogId);
        if (
          Number.isFinite(directId) &&
          directId > 0 &&
          validCatalogIds.has(directId)
        ) {
          resolved.set(foodCatalogDirectKey(directId), directId);
          setResolvedCatalogId(resolved, item.canonicalName, directId);
          setResolvedCatalogId(resolved, item.foodName, directId);
          continue;
        }

        const directKey = normalizeCatalogText(item.canonicalName);
        const fallbackKey = normalizeCatalogText(item.foodName);
        const nominalMatchBlocked =
          blockedKeys.has(directKey) || blockedKeys.has(fallbackKey);
        const resolvedId = nominalMatchBlocked
          ? undefined
          : (catalogIndex.get(directKey) ?? catalogIndex.get(fallbackKey));
        if (resolvedId) {
          setResolvedCatalogId(resolved, item.canonicalName, resolvedId);
          setResolvedCatalogId(resolved, item.foodName, resolvedId);
          continue;
        }

        if (!resolved.has(directKey) && !resolved.has(fallbackKey)) {
          const createdId = await createAutoClassifiedCatalogEntry(
            userId,
            item
          );
          if (createdId) {
            if (directKey) catalogIndex.set(directKey, createdId);
            if (fallbackKey) catalogIndex.set(fallbackKey, createdId);
            blockedKeys.delete(directKey);
            blockedKeys.delete(fallbackKey);
            setResolvedCatalogId(resolved, item.canonicalName, createdId);
            setResolvedCatalogId(resolved, item.foodName, createdId);
          }
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
    clearDeprecatedFoodRegistry(userId);
  }

  return {
    searchFoods,
    getFoodsByIds,
    listRecentFoods,
    upsertFavoriteFood,
    createUserFood,
    updateUserFood,
    resolveFoodCatalogIds,
    clearMemory,
  };
}
