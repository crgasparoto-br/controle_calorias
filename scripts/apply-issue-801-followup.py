from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"Expected one match in {path}, found {count}")
    file.write_text(text.replace(old, new, 1))


replace_once(
    "server/modules/foods/deprecationRegistry.ts",
    'const deprecatedKeysByUser = new Map<number, Set<string>>();\n',
    '''const deprecatedKeysByUser = new Map<number, Set<string>>();

type DeprecatedFoodCleanup = (userId: number, foodId: number) => void;
const deprecatedFoodCleanups = new Set<DeprecatedFoodCleanup>();

export function registerDeprecatedFoodCleanup(cleanup: DeprecatedFoodCleanup) {
  deprecatedFoodCleanups.add(cleanup);
  return () => deprecatedFoodCleanups.delete(cleanup);
}
''',
)
replace_once(
    "server/modules/foods/deprecationRegistry.ts",
    '  deprecatedKeysByUser.set(userId, keys);\n}\n',
    '''  deprecatedKeysByUser.set(userId, keys);

  for (const cleanup of deprecatedFoodCleanups) {
    cleanup(userId, foodId);
  }
}
''',
)

replace_once(
    "server/modules/foods/catalog.ts",
    '''  clearDeprecatedFoodRegistry,
  getDeprecatedIdentityKeys,
  isFoodDeprecatedInMemory,
} from "./deprecationRegistry";''',
    '''  clearDeprecatedFoodRegistry,
  getDeprecatedIdentityKeys,
  isFoodDeprecatedInMemory,
  registerDeprecatedFoodCleanup,
} from "./deprecationRegistry";''',
)
replace_once(
    "server/modules/foods/catalog.ts",
    '''  const userFoodStore = new Map<number, FoodSearchItem[]>();
  const favoriteFoodStore = new Map<number, Set<number>>();
  let foodIdSequence = 10000;''',
    '''  const userFoodStore = new Map<number, FoodSearchItem[]>();
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

  let foodIdSequence = 10000;''',
)

replace_once(
    "client/src/pages/foodsPageState.ts",
    '''export function getFoodCardActionState(params: {
''',
    '''export function removeFoodFromActiveList<T extends { id: number }>(
  foods: T[] | undefined,
  foodId: number
) {
  return foods?.filter(food => food.id !== foodId);
}

export function getFoodCardActionState(params: {
''',
)
replace_once(
    "client/src/pages/foodsPageState.test.ts",
    '''import { canDeleteLegacyFood, getFoodCardActionState } from "./foodsPageState";''',
    '''import {
  canDeleteLegacyFood,
  getFoodCardActionState,
  removeFoodFromActiveList,
} from "./foodsPageState";''',
)
replace_once(
    "client/src/pages/foodsPageState.test.ts",
    '''  it("blocks edit, favorite and duplicate delete actions while deleting", () => {''',
    '''  it("removes only the confirmed food from active cache data", () => {
    expect(
      removeFoodFromActiveList(
        [
          { id: 10, name: "Sleep Koala" },
          { id: 11, name: "Aveia" },
        ],
        10
      )
    ).toEqual([{ id: 11, name: "Aveia" }]);
    expect(removeFoodFromActiveList(undefined, 10)).toBeUndefined();
  });

  it("blocks edit, favorite and duplicate delete actions while deleting", () => {''',
)

replace_once(
    "client/src/pages/FoodsPage.tsx",
    '''import { canDeleteLegacyFood, getFoodCardActionState } from "./foodsPageState";''',
    '''import {
  canDeleteLegacyFood,
  getFoodCardActionState,
  removeFoodFromActiveList,
} from "./foodsPageState";''',
)
replace_once(
    "client/src/pages/FoodsPage.tsx",
    '''    onSuccess: async result => {
      if (form.foodId === result.foodId) setForm(emptyForm);
      setFoodToDelete(null);
      await Promise.all([
        utils.nutrition.foods.search.invalidate(),
        utils.nutrition.foods.recent.invalidate(),
      ]);
      toast.success("Alimento removido da sua base ativa.");
    },''',
    '''    onSuccess: async result => {
      utils.nutrition.foods.search.setData(
        { query, limit: 30 },
        current => removeFoodFromActiveList(current, result.foodId)
      );
      utils.nutrition.foods.recent.setData(
        undefined,
        current => removeFoodFromActiveList(current, result.foodId)
      );
      if (form.foodId === result.foodId) setForm(emptyForm);
      setFoodToDelete(null);
      await Promise.all([
        utils.nutrition.foods.search.invalidate(),
        utils.nutrition.foods.recent.invalidate(),
      ]);
      toast.success("Alimento removido da sua base ativa.");
    },''',
)

insights = Path("server/modules/insights/service.test.ts")
insights_text = insights.read_text()
marker = "\n});\n"
position = insights_text.rfind(marker)
if position < 0:
    raise SystemExit("Could not find insights describe terminator")
history_test = r'''

  it("mantém a classificação histórica por ID depois da depreciação", async () => {
    dbMocks.listUserMeals.mockResolvedValue([
      meal([
        mealItem({
          foodCatalogId: 801,
          foodName: "Sleep Koala",
          canonicalName: "Sleep Koala",
          portionText: "1 sachê",
          calories: 90,
          protein: 4,
        }),
      ]),
    ]);

    let deprecated = false;
    const historicalFood = () =>
      foodSearchItem({
        id: 801,
        name: "Sleep Koala",
        processingLevel: "ultra_processed",
        isUltraProcessed: true,
        status: deprecated ? "deprecated" : "active",
        isUserCreated: true,
        createdByUserId: 77,
      } as any);

    dbMocks.searchFoods.mockImplementation(async () =>
      deprecated ? [] : [historicalFood()]
    );
    dbMocks.getFoodsByIds.mockImplementation(async (_userId: number, ids: number[]) =>
      ids.includes(801) ? [historicalFood()] : []
    );

    const before = await getPeriodReportBundle(77, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    deprecated = true;

    const after = await getPeriodReportBundle(77, {
      startDate: "2026-06-01",
      endDate: "2026-06-01",
    });

    expect(after.quality.foodQuality).toEqual(before.quality.foodQuality);
    expect(after.quality.foodQuality).toMatchObject({
      classifiedCalories: 90,
      ultraProcessedCalories: 90,
      unclassifiedCalories: 0,
    });
    expect(dbMocks.getFoodsByIds).toHaveBeenLastCalledWith(77, [801]);
  });
'''
insights.write_text(insights_text[:position] + history_test + insights_text[position:])

Path("server/modules/foods/sleepKoalaRegression.test.ts").write_text(r'''import { describe, expect, it, vi } from "vitest";
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
''')

replace_once(
    "docs/design-docs/custom-foods.md",
    '''- uma seleção manual explícita de um alimento global ativo continua permitida.\n''',
    '''- uma seleção manual explícita de um alimento global ativo continua permitida;\n- após o commit da exclusão, stores e caches ativos removem o alimento e o favorito, mantendo apenas a referência histórica e a supressão de matching.\n''',
)
