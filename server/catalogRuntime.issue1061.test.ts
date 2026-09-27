import { beforeEach, describe, expect, it, vi } from "vitest";

const { drizzleMock, dbMock, chainMock } = vi.hoisted(() => {
  const chain = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  return {
    drizzleMock: vi.fn(),
    dbMock: { select: vi.fn() },
    chainMock: chain,
  };
});

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: drizzleMock,
}));

vi.mock("drizzle-orm", () => ({
  desc: vi.fn((value: unknown) => ({ direction: "desc", value })),
  eq: vi.fn((left: unknown, right: unknown) => ({ operator: "eq", left, right })),
}));

vi.mock("../drizzle/schema", () => ({
  foodCatalog: {
    id: "id",
    slug: "slug",
    name: "name",
    aliases: "aliases",
    brandName: "brandName",
    productVariant: "productVariant",
    foodType: "foodType",
    servingLabel: "servingLabel",
    gramsPerServing: "gramsPerServing",
    calories: "calories",
    protein: "protein",
    carbs: "carbs",
    fat: "fat",
    fiber: "fiber",
    processingLevel: "processingLevel",
    isFruit: "isFruit",
    isVegetable: "isVegetable",
    isUltraProcessed: "isUltraProcessed",
    researchIdentityKey: "researchIdentityKey",
    sourceUrls: "sourceUrls",
    sourceEvidence: "sourceEvidence",
    sourceVerifiedAt: "sourceVerifiedAt",
    sourceConfidence: "sourceConfidence",
    status: "status",
    updatedAt: "updatedAt",
  },
}));

function row(overrides: Record<string, unknown> = {}) {
  return {
    slug: "runtime-food",
    name: "Runtime food",
    aliases: JSON.stringify(["runtime food"]),
    brandName: null,
    productVariant: null,
    foodType: "generic",
    servingLabel: "100 g",
    gramsPerServing: 100,
    calories: 100,
    protein: 2,
    carbs: 10,
    fat: 3,
    fiber: null,
    processingLevel: "processed",
    isFruit: 0,
    isVegetable: 0,
    isUltraProcessed: 0,
    researchIdentityKey: null,
    sourceUrls: null,
    sourceEvidence: null,
    sourceVerifiedAt: null,
    sourceConfidence: null,
    ...overrides,
  };
}

describe("catalog runtime boot bounds (#1061)", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("DATABASE_URL", "mysql://test/catalog");

    chainMock.from.mockReturnValue(chainMock);
    chainMock.where.mockReturnValue(chainMock);
    chainMock.orderBy.mockReturnValue(chainMock);
    chainMock.limit.mockReturnValue(chainMock);
    dbMock.select.mockReturnValue(chainMock);
    drizzleMock.mockReturnValue(dbMock);
  });

  it("consulta somente registros ativos, seleciona campos necessários e aplica limite bounded", async () => {
    chainMock.limit.mockResolvedValue([
      row({ slug: "recent-researched", sourceEvidence: "Evidence retained" }),
    ]);

    const { CATALOG_CACHE_MAX_ROWS, getCatalogCache, refreshCatalogCache } =
      await import("./catalogRuntime");
    await refreshCatalogCache();

    expect(CATALOG_CACHE_MAX_ROWS).toBe(1000);
    expect(chainMock.where).toHaveBeenCalledTimes(1);
    expect(chainMock.orderBy).toHaveBeenCalledTimes(1);
    expect(chainMock.limit).toHaveBeenCalledWith(CATALOG_CACHE_MAX_ROWS);
    expect(getCatalogCache()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        slug: "recent-researched",
        sourceEvidence: "Evidence retained",
        processingLevel: "processed",
      }),
      expect.objectContaining({ slug: "agua" }),
    ]));
    expect(getCatalogCache().some(food => food.slug === "runtime-food")).toBe(false);
  });

  it("mantém as referências canônicas mesmo quando o recorte mais recente do banco não as contém", async () => {
    chainMock.limit.mockResolvedValue([row({ slug: "newest-only" })]);

    const { getCatalogCache, refreshCatalogCache } = await import("./catalogRuntime");
    await refreshCatalogCache();

    expect(getCatalogCache().map(food => food.slug)).toEqual(
      expect.arrayContaining(["newest-only", "cafe-sem-acucar", "agua"]),
    );
  });

  it("falha fechado para o catálogo estático se o banco não estiver disponível", async () => {
    drizzleMock.mockImplementation(() => {
      throw new Error("database unavailable");
    });

    const { getCatalogCache, refreshCatalogCache } = await import("./catalogRuntime");
    await refreshCatalogCache();

    expect(getCatalogCache().some(food => food.slug === "agua")).toBe(true);
    expect(getCatalogCache().some(food => food.slug === "runtime-food")).toBe(false);
  });
});
