import { describe, expect, it, vi } from "vitest";
import { createFoodsService, type FoodUpsertInput } from "./catalog";
import type {
  FoodCatalogInsertInput,
  FoodCatalogRepository,
  FoodCatalogUpdateInput,
} from "../../repositories/foodCatalogRepository";

function createFakeFoodCatalogRepository(
  overrides: Partial<FoodCatalogRepository> = {}
): FoodCatalogRepository {
  return {
    findAll: vi.fn(async () => []),
    findFavoriteIdsByUserId: vi.fn(async () => new Set<number>()),
    upsertFavorite: vi.fn(async () => undefined),
    deleteFavorite: vi.fn(async () => undefined),
    insert: vi.fn(async () => 0),
    update: vi.fn(async () => 1),
    ...overrides,
  } as FoodCatalogRepository;
}

function createService(
  overrides: Partial<Parameters<typeof createFoodsService>[0]> = {}
) {
  return createFoodsService({
    foodCatalogRepository: createFakeFoodCatalogRepository(),
    findMealItemsWithDates: async () => [],
    getUserMealsMemory: () => [],
    getDb: async () => null,
    onWarning: vi.fn(),
    ...overrides,
  });
}

function catalogRow(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  } as any;
}

function createMutableFoodCatalogRepository(
  options: { updateError?: Error } = {}
) {
  let nextId = 3000;
  const rows: any[] = [];

  const repository = createFakeFoodCatalogRepository({
    findAll: vi.fn(async () => rows as any),
    insert: vi.fn(async (input: FoodCatalogInsertInput) => {
      const id = nextId++;
      rows.unshift(
        catalogRow({
          id,
          slug: input.slug,
          name: input.name,
          aliases: input.aliases,
          brandName: input.brandName,
          foodType: input.foodType,
          dataSource: input.dataSource,
          servingLabel: input.servingLabel,
          servingUnit: input.servingUnit,
          gramsPerServing: input.gramsPerServing,
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber,
          isFruit: input.isFruit,
          isVegetable: input.isVegetable,
          isUltraProcessed: input.isUltraProcessed,
          processingLevel: input.processingLevel ?? null,
          classificationSource: input.classificationSource ?? null,
          classificationConfidence: input.classificationConfidence ?? null,
          isUserCreated: input.isUserCreated,
          createdByUserId: input.createdByUserId,
        })
      );
      return id;
    }),
    update: vi.fn(
      async (foodId: number, userId: number, input: FoodCatalogUpdateInput) => {
        if (options.updateError) {
          throw options.updateError;
        }

        const row = rows.find(
          item => item.id === foodId && item.createdByUserId === userId
        );
        if (!row) return 0;

        Object.assign(row, {
          name: input.name,
          brandName: input.brandName,
          foodType: input.foodType,
          dataSource: input.dataSource,
          servingLabel: input.servingLabel,
          servingUnit: input.servingUnit,
          gramsPerServing: input.gramsPerServing,
          calories: input.calories,
          protein: input.protein,
          carbs: input.carbs,
          fat: input.fat,
          fiber: input.fiber,
          isFruit: input.isFruit,
          isVegetable: input.isVegetable,
          isUltraProcessed: input.isUltraProcessed,
        });

        return 1;
      }
    ),
  });

  return { repository, rows };
}

const whatsappFood: FoodUpsertInput = {
  name: "Panqueca criada pelo WhatsApp",
  brandName: null,
  servingSize: 120,
  servingUnit: "g",
  calories: 210,
  protein: 11,
  carbs: 28,
  fat: 6,
  fiber: 2,
  isFruit: false,
  isVegetable: false,
  isUltraProcessed: false,
  source: "whatsapp_ai",
  foodType: "generic",
};

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
    expect(results[0]).toMatchObject({
      name: "Tapioca com queijo",
      isUserCreated: true,
      createdByUserId: 1,
    });
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
      findAll: vi.fn(async () => [catalogRow()]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds([
      { canonicalName: "arroz cozido", foodName: "arroz" } as any,
    ]);

    expect(resolved.get("arroz cozido")).toBe(55);
    expect(resolved.get("arroz")).toBe(55);
  });

  it("keeps only direct catalog ids that exist before meal persistence", async () => {
    const repository = createFakeFoodCatalogRepository({
      findAll: vi.fn(async () => [
        catalogRow({ id: 10, name: "Banana", aliases: "[]" }),
      ]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds([
      {
        foodCatalogId: 10,
        canonicalName: "texto divergente",
        foodName: "texto divergente",
      } as any,
      {
        foodCatalogId: 999,
        canonicalName: "sem cadastro",
        foodName: "sem cadastro",
      } as any,
    ]);

    expect(resolved.get("catalog:10")).toBe(10);
    expect(resolved.get("texto divergente")).toBe(10);
    expect(resolved.has("catalog:999")).toBe(false);
    expect(resolved.has("sem cadastro")).toBe(false);
  });

  it("falls back to catalog aliases when a direct catalog id is invalid", async () => {
    const repository = createFakeFoodCatalogRepository({
      findAll: vi.fn(async () => [
        catalogRow({
          id: 20,
          name: "Aveia",
          aliases: JSON.stringify(["flocos de aveia"]),
        }),
      ]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds([
      {
        foodCatalogId: 999,
        canonicalName: "sem id valido",
        foodName: "flocos de aveia",
      } as any,
    ]);

    expect(resolved.get("sem id valido")).toBe(20);
    expect(resolved.get("flocos de aveia")).toBe(20);
    expect(resolved.has("catalog:999")).toBe(false);
  });

  it("persists edits to user-created WhatsApp/AI foods and returns updated data on a later search", async () => {
    const { repository, rows } = createMutableFoodCatalogRepository();
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const created = await service.createUserFood(42, whatsappFood);

    await service.updateUserFood(42, {
      ...whatsappFood,
      foodId: created.id,
      name: "Panqueca ajustada pelo usuário",
      calories: 188,
      protein: 14,
      source: "ai_estimated",
    });

    const searchResults = await service.searchFoods(
      42,
      "panqueca ajustada",
      10
    );

    expect(rows[0]).toMatchObject({
      id: created.id,
      name: "Panqueca ajustada pelo usuário",
      calories: 188,
      protein: 14,
      dataSource: "ai_estimated",
    });
    expect(searchResults).toHaveLength(1);
    expect(searchResults[0]).toMatchObject({
      id: created.id,
      name: "Panqueca ajustada pelo usuário",
      calories: 188,
      protein: 14,
      isUserCreated: true,
      createdByUserId: 42,
    });
  });

  it("returns an error when update persistence fails and keeps later searches on persisted data", async () => {
    const updateError = new Error("database unavailable");
    const onWarning = vi.fn();
    const { repository } = createMutableFoodCatalogRepository({ updateError });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
      onWarning,
    });

    const created = await service.createUserFood(43, whatsappFood);

    await expect(
      service.updateUserFood(43, {
        ...whatsappFood,
        foodId: created.id,
        name: "Panqueca que não deve aparecer",
        calories: 300,
      })
    ).rejects.toThrow("Não foi possível salvar o alimento. Tente novamente.");

    const failedSearch = await service.searchFoods(43, "não deve aparecer", 10);
    const originalSearch = await service.searchFoods(43, "panqueca criada", 10);

    expect(onWarning).toHaveBeenCalledWith(
      "Food update persistence failed",
      updateError
    );
    expect(failedSearch).toHaveLength(0);
    expect(originalSearch[0]).toMatchObject({
      id: created.id,
      name: "Panqueca criada pelo WhatsApp",
      calories: 210,
    });
  });

  it("does not reuse a deprecated own identity or fall back to an equivalent global food", async () => {
    const global = catalogRow({
      id: 20,
      name: "Panqueca",
      aliases: "[]",
      status: "active",
    });
    const deprecatedOwn = catalogRow({
      id: 21,
      name: "Panqueca",
      aliases: "[]",
      status: "deprecated",
      isUserCreated: 1,
      createdByUserId: 7,
    });
    const repository = createFakeFoodCatalogRepository({
      findForResolution: vi.fn(async () => [global, deprecatedOwn]),
      insert: vi.fn(async () => 99),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds(
      [
        {
          foodCatalogId: 21,
          canonicalName: "Panqueca",
          foodName: "Panqueca",
          estimatedGrams: 100,
          portionText: "100 g",
          unit: "g",
          calories: 180,
          protein: 7,
          carbs: 25,
          fat: 6,
          confidence: 0.9,
          classification: {
            fiberGrams: 2,
            isFruit: false,
            isVegetable: false,
            processingLevel: "processed",
          },
        } as any,
      ],
      7
    );

    expect(resolved.get("Panqueca")).toBe(99);
    expect(resolved.has("catalog:21")).toBe(false);
    expect(repository.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        calories: 180,
        protein: 7,
        carbs: 25,
        fat: 6,
        createdByUserId: 7,
      })
    );
  });

  it("accepts an explicit active global id even when an old own identity is deprecated", async () => {
    const global = catalogRow({
      id: 20,
      name: "Panqueca",
      aliases: "[]",
      status: "active",
    });
    const deprecatedOwn = catalogRow({
      id: 21,
      name: "Panqueca",
      aliases: "[]",
      status: "deprecated",
      isUserCreated: 1,
      createdByUserId: 7,
    });
    const repository = createFakeFoodCatalogRepository({
      findForResolution: vi.fn(async () => [global, deprecatedOwn]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds(
      [
        {
          foodCatalogId: 20,
          canonicalName: "Panqueca",
          foodName: "Panqueca",
        } as any,
      ],
      7
    );
    expect(resolved.get("catalog:20")).toBe(20);
  });

  it("keeps deprecated own foods available only through historical id lookup", async () => {
    const deprecatedOwn = catalogRow({
      id: 21,
      name: "Panqueca",
      status: "deprecated",
      isUserCreated: 1,
      createdByUserId: 7,
    });
    const repository = createFakeFoodCatalogRepository({
      findActiveForUser: vi.fn(async () => []),
      findByIdsForUser: vi.fn(async () => [deprecatedOwn]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    expect(await service.searchFoods(7, "Panqueca")).toEqual([]);
    await expect(service.getFoodsByIds(7, [21])).resolves.toEqual([
      expect.objectContaining({ id: 21, status: "deprecated" }),
    ]);
  });

  it("reuses a new active own entry after the old identity was deprecated", async () => {
    const global = catalogRow({
      id: 20,
      name: "Panqueca",
      aliases: "[]",
      status: "active",
    });
    const deprecatedOwn = catalogRow({
      id: 21,
      name: "Panqueca",
      aliases: "[]",
      status: "deprecated",
      isUserCreated: 1,
      createdByUserId: 7,
    });
    const activeOwn = catalogRow({
      id: 99,
      name: "Panqueca",
      aliases: "[]",
      status: "active",
      isUserCreated: 1,
      createdByUserId: 7,
    });
    const repository = createFakeFoodCatalogRepository({
      findForResolution: vi.fn(async () => [global, deprecatedOwn, activeOwn]),
      insert: vi.fn(async () => 100),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds(
      [{ canonicalName: "Panqueca", foodName: "Panqueca" } as any],
      7
    );

    expect(resolved.get("Panqueca")).toBe(99);
    expect(repository.insert).not.toHaveBeenCalled();
  });

  it("rejects a direct id owned by another user even if a repository returns it", async () => {
    const foreignFood = catalogRow({
      id: 88,
      name: "Panqueca",
      aliases: "[]",
      status: "active",
      isUserCreated: 1,
      createdByUserId: 8,
    });
    const repository = createFakeFoodCatalogRepository({
      findForResolution: vi.fn(async () => [foreignFood]),
    });
    const service = createService({
      foodCatalogRepository: repository,
      getDb: async () => ({}),
    });

    const resolved = await service.resolveFoodCatalogIds(
      [
        {
          foodCatalogId: 88,
          canonicalName: "Panqueca",
          foodName: "Panqueca",
        } as any,
      ],
      7
    );

    expect(resolved.has("catalog:88")).toBe(false);
    expect(resolved.has("Panqueca")).toBe(false);
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
