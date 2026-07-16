import { describe, expect, it, vi } from "vitest";
import { createFoodsService } from "./catalog";
import { clearDeprecatedFoodRegistry } from "./deprecationRegistry";
import { createLegacyFoodDeletionService } from "./legacyDeletion";
import type {
  FoodCatalogInsertInput,
  FoodCatalogRepository,
} from "../../repositories/foodCatalogRepository";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    slug: "sleep-koala-global",
    name: "Sleep Koala",
    aliases: JSON.stringify(["sleep koala suplemento"]),
    brandName: "Sleep Koala",
    foodType: "branded",
    dataSource: "catalog",
    servingLabel: "1 sachê",
    servingUnit: "sachê",
    gramsPerServing: 10,
    calories: 90,
    protein: 4,
    carbs: 8,
    fat: 4,
    fiber: 0,
    processingLevel: "ultra_processed",
    classificationSource: "catalog",
    classificationConfidence: 1,
    isFruit: 0,
    isVegetable: 0,
    isUltraProcessed: 1,
    isUserCreated: 0,
    createdByUserId: null,
    status: "active",
    ...overrides,
  } as any;
}

describe("Sleep Koala deletion regression", () => {
  it("deprecia a associação antiga, limpa os stores e persiste a classificação atual", async () => {
    const rows = [
      row(),
      row({
        id: 21,
        slug: "sleep-koala-user-7",
        dataSource: "ai_estimated",
        isUserCreated: 1,
        createdByUserId: 7,
      }),
    ];
    const favorites = new Set([21]);
    let nextId = 99;
    let databaseAvailable = true;

    const insert = vi.fn(async (input: FoodCatalogInsertInput) => {
      const id = nextId++;
      rows.push(row({ id, ...input, status: "active" }));
      return id;
    });

    const repository: FoodCatalogRepository = {
      findAll: vi.fn(async () => rows),
      findActiveForUser: vi.fn(async userId =>
        rows.filter(item =>
          item.status === "active" &&
          (item.createdByUserId == null || item.createdByUserId === userId)
        )
      ),
      findForResolution: vi.fn(async userId =>
        rows.filter(item =>
          (item.createdByUserId == null && item.status === "active") ||
          item.createdByUserId === userId
        )
      ),
      findByIdsForUser: vi.fn(async (userId, ids) =>
        rows.filter(item =>
          ids.includes(item.id) &&
          (item.createdByUserId == null || item.createdByUserId === userId)
        )
      ),
      findFavoriteIdsByUserId: vi.fn(async () => new Set(favorites)),
      upsertFavorite: vi.fn(async (_userId, foodId) => {
        favorites.add(foodId);
      }),
      deleteFavorite: vi.fn(async (_userId, foodId) => {
        favorites.delete(foodId);
      }),
      insert,
      update: vi.fn(async () => 1),
    };

    const foodsService = createFoodsService({
      foodCatalogRepository: repository,
      findMealItemsWithDates: async () => [],
      getUserMealsMemory: () => [],
      getDb: async () => (databaseAvailable ? {} : null),
      onWarning: vi.fn(),
    });

    const created = await foodsService.createUserFood(7, {
      name: "Sleep Koala",
      brandName: "Sleep Koala",
      servingSize: 10,
      servingUnit: "sachê",
      calories: 90,
      protein: 4,
      carbs: 8,
      fat: 4,
      fiber: 0,
      isFruit: false,
      isVegetable: false,
      isUltraProcessed: true,
      source: "ai_estimated",
      foodType: "branded",
    });
    await foodsService.upsertFavoriteFood(7, created.id, true);

    const execute = vi.fn(async () => {
      const call = execute.mock.calls.length;
      if (call == 1) {
        return [[{
          id: created.id,
          name: "Sleep Koala",
          aliases: JSON.stringify(["sleep koala suplemento"]),
          status: "active",
        }]];
      }
      if (call == 2) {
        const owned = rows.find(item => item.id === created.id);
        if (owned) owned.status = "deprecated";
        return [{ affectedRows: 1 }];
      }
      favorites.delete(created.id);
      return [{ affectedRows: 1 }];
    });

    const deletionService = createLegacyFoodDeletionService({
      getDb: async () => ({
        execute,
        transaction: async (callback: (transaction: { execute: typeof execute }) => Promise<unknown>) =>
          callback({ execute }),
      }),
      searchFoods: foodsService.searchFoods,
      onWarning: vi.fn(),
    });

    await deletionService.deleteFood(7, created.id);
    expect(rows.find(item => item.id === created.id)?.status).toBe("deprecated");
    expect(favorites.has(created.id)).toBe(false);

    databaseAvailable = false;
    clearDeprecatedFoodRegistry(7);
    expect(
      (await foodsService.searchFoods(7, "Sleep Koala", 20)).some(
        item => item.id === created.id
      )
    ).toBe(false);

    databaseAvailable = true;
    const currentAnalysis = {
      foodCatalogId: created.id,
      foodName: "Sleep Koala",
      canonicalName: "Sleep Koala",
      brand: "Sleep Koala",
      portionText: "1 sachê",
      estimatedGrams: 10,
      unit: "sachê",
      calories: 42,
      protein: 8,
      carbs: 2,
      fat: 1,
      confidence: 0.96,
      classification: {
        fiberGrams: 1,
        isFruit: false,
        isVegetable: false,
        processingLevel: "processed",
      },
    } as any;

    const resolvedOldDraft = await foodsService.resolveFoodCatalogIds(
      [currentAnalysis],
      7
    );
    expect(resolvedOldDraft.has(`catalog:${created.id}`)).toBe(false);
    expect(resolvedOldDraft.get("Sleep Koala")).toBe(99);
    expect(resolvedOldDraft.get("Sleep Koala")).not.toBe(20);
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calories: 42,
        protein: 8,
        carbs: 2,
        fat: 1,
        processingLevel: "processed",
        createdByUserId: 7,
      })
    );

    const resolvedNextRegistration = await foodsService.resolveFoodCatalogIds(
      [{ foodName: "Sleep Koala", canonicalName: "Sleep Koala" } as any],
      7
    );
    expect(resolvedNextRegistration.get("Sleep Koala")).toBe(99);
    expect(insert).toHaveBeenCalledTimes(1);
  });
});
