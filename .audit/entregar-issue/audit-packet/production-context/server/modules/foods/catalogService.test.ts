import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { getDb } from "../../db";
import {
  curateGlobalFood,
  getGlobalFoodCatalogItem,
  listGlobalRecentlyUsedFoods,
  searchGlobalFoodCatalog,
  setGlobalFoodFavorite,
} from "./service";

vi.mock("../../db", () => ({
  createUserFood: vi.fn(),
  getDb: vi.fn(),
  listRecentFoods: vi.fn(),
  searchFoods: vi.fn(),
  updateUserFood: vi.fn(),
  upsertFavoriteFood: vi.fn(),
}));

const execute = vi.fn();

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
  isFavorite: 0,
  usageCount: 0,
  lastUsedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getDb).mockResolvedValue({ execute } as never);
});

describe("catalog food service", () => {
  it("retorna alimentos globais e personalizados mapeados para o contrato do catalogo", async () => {
    execute.mockResolvedValueOnce([[baseFoodRow, { ...baseFoodRow, id: 11, ownerUserId: 7, isGlobal: 0, name: "Arroz da casa" }]]);

    const result = await searchGlobalFoodCatalog(7, { query: "arroz branco", limit: 20, includeInactive: false });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      id: 10,
      scope: "global",
      source: { slug: "curadoria-br-inicial", foodCode: "BR-COMMON-001" },
      nutrientsPer100g: { caloriesKcal: 128, extra: { iron_mg: 0.1 } },
      userSignals: { favorite: false, usageCount: 0, lastUsedAt: null },
    });
    expect(result[1]).toMatchObject({ id: 11, scope: "user", ownerUserId: 7 });
  });

  it("retorna porcoes cadastradas ao consultar um alimento permitido", async () => {
    execute
      .mockResolvedValueOnce([[baseFoodRow]])
      .mockResolvedValueOnce([[
        { id: 1, label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: 1 },
        { id: 2, label: "escumadeira", unit: "un", quantity: 1, grams: 80, isDefault: 0 },
      ]]);

    const result = await getGlobalFoodCatalogItem(7, 10);

    expect(result.portions).toEqual([
      { id: 1, label: "100 g", unit: "g", quantity: 100, grams: 100, isDefault: true },
      { id: 2, label: "escumadeira", unit: "un", quantity: 1, grams: 80, isDefault: false },
    ]);
  });

  it("lista alimentos recentes com sinais de favorito e uso", async () => {
    execute.mockResolvedValueOnce([[
      {
        ...baseFoodRow,
        isFavorite: 1,
        usageCount: 4,
        lastUsedAt: "2026-06-08 10:00:00",
      },
    ]]);

    const result = await listGlobalRecentlyUsedFoods(7, { limit: 10 });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 10,
      userSignals: { favorite: true, usageCount: 4, lastUsedAt: "2026-06-08 10:00:00" },
    });
  });

  it("alterna favorito global e retorna o alimento atualizado", async () => {
    execute
      .mockResolvedValueOnce([[baseFoodRow]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ ...baseFoodRow, isFavorite: 1 }]])
      .mockResolvedValueOnce([[]]);

    const result = await setGlobalFoodFavorite(7, { foodId: 10, favorite: true });

    expect(result.userSignals.favorite).toBe(true);
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("permite curadoria administrativa de status de alimento global", async () => {
    execute
      .mockResolvedValueOnce([[{ id: 10 }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[{ ...baseFoodRow, status: "deprecated" }]])
      .mockResolvedValueOnce([[]]);

    const result = await curateGlobalFood(1, { foodId: 10, status: "deprecated", mergedIntoFoodId: null });

    expect(result.status).toBe("deprecated");
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("bloqueia consulta de alimento inexistente ou fora do escopo do usuario", async () => {
    execute.mockResolvedValueOnce([[]]);

    await expect(getGlobalFoodCatalogItem(7, 999)).rejects.toBeInstanceOf(TRPCError);
  });
});
