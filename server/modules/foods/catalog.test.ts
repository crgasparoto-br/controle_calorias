import { describe, expect, it, vi } from "vitest";
import { createFoodsService } from "./catalog";
import type { FoodCatalogRepository } from "../../repositories/foodCatalogRepository";

function createFakeFoodCatalogRepository(overrides: Partial<FoodCatalogRepository> = {}): FoodCatalogRepository {
  return {
    findAll: vi.fn(async () => []),
    findFavoriteIdsByUserId: vi.fn(async () => new Set<number>()),
    upsertFavorite: vi.fn(async () => undefined),
    deleteFavorite: vi.fn(async () => undefined),
    insert: vi.fn(async () => 0),
    update: vi.fn(async () => undefined),
    ...overrides,
  } as FoodCatalogRepository;
}

function createService(overrides: Partial<Parameters<typeof createFoodsService>[0]> = {}) {
  return createFoodsService({
    foodCatalogRepository: createFakeFoodCatalogRepository(),
    findMealItemsWithDates: async () => [],
    getUserMealsMemory: () => [],
    getDb: async () => null,
    onWarning: vi.fn(),
    ...overrides,
  });
}

describe("foods catalog service", () => {
  it("finds a user-created food from memory when the database is unavailable", async () => {
    const service = createService();

    await service.createUserFood(1, {
      name: "Tapioca com queijo",
      servingSize: 100,
      servingUnit: "g",
      calories: 200,
      protein: 5,
      carbs: 30,
      fat: 4,
      source: "manual",
      foodType: "generic",
    });

    const results = await service.searchFoods(1, "tapioca");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: "Tapioca com queijo", isUserCreated: true, createdByUserId: 1 });
  });

  it("toggles favorite state in memory and reflects it back in search results", async () => {
    const service = createService();
    const created = await service.createUserFood(2, {
      name: "Banana",
      servingSize: 100,
      servingUnit: "g",
      calories: 90,
      protein: 1,
      carbs: 23,
      fat: 0,
      source: "manual",
      foodType: "generic",
    });

    const favorited = await service.upsertFavoriteFood(2, created.id, true);
    expect(favorited?.isFavorite).toBe(true);

    const unfavorited = await service.upsertFavoriteFood(2, created.id, false);
    expect(unfavorited?.isFavorite).toBe(false);
  });

  it("resolves catalog ids by canonical name, alias or food name", async () => {
    const repository = createFakeFoodCatalogRepository({
      findAll: vi.fn(async () => [{
        id: 55,
        slug: "arroz-branco",
        name: "Arroz branco",
        aliases: JSON.stringify(["arroz cozido"]),
        brandName: null,
        foodType: "generic",
        dataSource: "catalog",
        servingLabel: "100 g",
        servingUnit: "g",
        gramsPerServing: 100,
        calories: 130,
        protein: 2.7,
        carbs: 28,
        fat: 0.3,
        fiber: 0.4,
        isFruit: 0,
        isVegetable: 0,
        isUltraProcessed: 0,
        isUserCreated: 0,
        createdByUserId: null,
      } as any]),
    });
    const service = createService({ foodCatalogRepository: repository, getDb: async () => ({}) });

    const resolved = await service.resolveFoodCatalogIds([
      { canonicalName: "arroz cozido", foodName: "arroz" } as any,
    ]);

    expect(resolved.get("arroz cozido")).toBe(55);
    expect(resolved.get("arroz")).toBe(55);
  });

  it("clears user-created foods and favorites from memory", async () => {
    const service = createService();
    const created = await service.createUserFood(3, {
      name: "Aveia",
      servingSize: 30,
      servingUnit: "g",
      calories: 110,
      protein: 4,
      carbs: 20,
      fat: 2,
      source: "manual",
      foodType: "generic",
    });
    await service.upsertFavoriteFood(3, created.id, true);

    service.clearMemory(3);

    const results = await service.searchFoods(3, "aveia");
    expect(results.some(food => food.id === created.id)).toBe(false);
  });
});
