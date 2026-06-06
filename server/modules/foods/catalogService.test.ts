import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../../db";
import { getGlobalFoodCatalogItem, searchGlobalFoodCatalog } from "./service";

vi.mock("../../db", () => ({
  createUserFood: vi.fn(),
  getDb: vi.fn(),
  listRecentFoods: vi.fn(),
  searchFoods: vi.fn(),
  updateUserFood: vi.fn(),
  upsertFavoriteFood: vi.fn(),
}));

const selectDistinct = vi.fn();
const select = vi.fn();
const queryResults: unknown[][] = [];
let selectCallCount = 0;

function buildQueryChain(result: unknown[], terminal: "limit" | "orderBy") {
  const chain = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => terminal === "orderBy" ? result : chain),
    limit: vi.fn(() => result),
  };

  return chain;
}

const baseFoodRow = {
  id: 10,
  ownerUserId: null,
  sourceId: 1,
  sourceSlug: "curadoria-br-inicial",
  sourceName: "Curadoria interna",
  sourceVersion: "2026-06-06",
  sourceFoodCode: "BR-COMMON-001",
  name: "Arroz branco cozido",
  normalizedName: "arroz branco cozido",
  brandName: null,
  category: "Cereais",
  description: null,
  status: "active" as const,
  mergedIntoFoodId: null,
  caloriesKcalPer100g: 128,
  proteinGramsPer100g: 2.5,
  carbsGramsPer100g: 28.1,
  fatGramsPer100g: 0.2,
  fiberGramsPer100g: 1.6,
  sugarGramsPer100g: null,
  sodiumMgPer100g: 1,
  nutrientsJson: '{"iron_mg":0.1}',
  isGlobal: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  queryResults.length = 0;
  selectCallCount = 0;
  selectDistinct.mockImplementation(() => buildQueryChain(queryResults.shift() ?? [], "limit"));
  select.mockImplementation(() => buildQueryChain(queryResults.shift() ?? [], selectCallCount++ === 0 ? "limit" : "orderBy"));
  vi.mocked(getDb).mockResolvedValue({ selectDistinct, select } as never);
});

describe("catalog food service", () => {
  it("retorna alimentos globais e personalizados mapeados para o contrato do catalogo", async () => {
    queryResults.push([baseFoodRow, { ...baseFoodRow, id: 11, ownerUserId: 7, isGlobal: 0, name: "Arroz da casa" }]);

    const result = await searchGlobalFoodCatalog(7, { query: "arroz branco", limit: 20, includeInactive: false });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 10,
      scope: "global",
      source: { slug: "curadoria-br-inicial", foodCode: "BR-COMMON-001" },
      nutrientsPer100g: { caloriesKcal: 128, extra: { iron_mg: 0.1 } },
    });
    expect(result[1]).toMatchObject({ id: 11, scope: "user", ownerUserId: 7 });
  });

  it("retorna porcoes cadastradas ao consultar um alimento permitido", async () => {
    queryResults.push(
      [baseFoodRow],
      [
        { id: 1, label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: 1 },
        { id: 2, label: "escumadeira", unit: "un", quantity: 1, grams: 80, isDefault: 0 },
      ],
    );

    const result = await getGlobalFoodCatalogItem(7, 10);

    expect(result.portions).toEqual([
      { id: 1, label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: true },
      { id: 2, label: "escumadeira", unit: "un", quantity: 1, grams: 80, isDefault: false },
    ]);
  });

  it("bloqueia consulta de alimento inexistente ou fora do escopo do usuario", async () => {
    queryResults.push([]);

    await expect(getGlobalFoodCatalogItem(7, 999)).rejects.toBeInstanceOf(TRPCError);
  });
});
