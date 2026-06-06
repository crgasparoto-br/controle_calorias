import { TRPCError } from "@trpc/server";
import { sql, type SQL } from "drizzle-orm";
import {
  createUserFood,
  getDb,
  listRecentFoods,
  searchFoods,
  updateUserFood,
  upsertFavoriteFood,
} from "../../db";
import type { CatalogFoodSearchInput, FoodFormInput } from "./schemas";

type SqlExecutor = {
  execute: (query: SQL) => Promise<unknown>;
};

type CatalogFoodRow = {
  id: number;
  ownerUserId: number | null;
  sourceId: number | null;
  sourceSlug: string | null;
  sourceName: string | null;
  sourceVersion: string | null;
  sourceFoodCode: string | null;
  name: string;
  normalizedName: string;
  brandName: string | null;
  category: string | null;
  description: string | null;
  status: "active" | "deprecated" | "merged";
  mergedIntoFoodId: number | null;
  caloriesKcalPer100g: number;
  proteinGramsPer100g: number;
  carbsGramsPer100g: number;
  fatGramsPer100g: number;
  fiberGramsPer100g: number | null;
  sugarGramsPer100g: number | null;
  sodiumMgPer100g: number | null;
  nutrientsJson: string | null;
  isGlobal: number;
};

type CatalogFoodPortionRow = {
  id: number;
  label: string;
  unit: string;
  quantity: number;
  grams: number;
  isDefault: number;
};

function extractRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) {
    const [rows] = result;
    return Array.isArray(rows) ? rows as T[] : result as T[];
  }

  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows: unknown }).rows;
    return Array.isArray(rows) ? rows as T[] : [];
  }

  return [];
}

function normalizeCatalogSearchTerm(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function parseNutrientsJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function mapCatalogFood(row: CatalogFoodRow, portions: CatalogFoodPortionRow[] = []) {
  return {
    id: row.id,
    scope: row.isGlobal ? "global" : "user",
    ownerUserId: row.ownerUserId,
    source: row.sourceId
      ? {
          id: row.sourceId,
          slug: row.sourceSlug,
          name: row.sourceName,
          version: row.sourceVersion,
          foodCode: row.sourceFoodCode,
        }
      : null,
    name: row.name,
    normalizedName: row.normalizedName,
    brandName: row.brandName,
    category: row.category,
    description: row.description,
    status: row.status,
    mergedIntoFoodId: row.mergedIntoFoodId,
    nutrientsPer100g: {
      caloriesKcal: row.caloriesKcalPer100g,
      proteinGrams: row.proteinGramsPer100g,
      carbsGrams: row.carbsGramsPer100g,
      fatGrams: row.fatGramsPer100g,
      fiberGrams: row.fiberGramsPer100g,
      sugarGrams: row.sugarGramsPer100g,
      sodiumMg: row.sodiumMgPer100g,
      extra: parseNutrientsJson(row.nutrientsJson),
    },
    portions: portions.map(portion => ({
      id: portion.id,
      label: portion.label,
      unit: portion.unit,
      quantity: portion.quantity,
      grams: portion.grams,
      isDefault: Boolean(portion.isDefault),
    })),
  };
}

async function getCatalogDb() {
  const db = await getDb();
  if (!db) {
    throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Banco de dados indisponível para consulta do catálogo." });
  }
  return db as unknown as SqlExecutor;
}

export function searchFoodCatalog(userId: number, input: { query?: string; limit?: number }) {
  return searchFoods(userId, input.query ?? "", input.limit ?? 20);
}

export async function searchGlobalFoodCatalog(userId: number, input: CatalogFoodSearchInput) {
  const db = await getCatalogDb();
  const normalizedQuery = normalizeCatalogSearchTerm(input.query ?? "");
  const likeQuery = `%${normalizedQuery}%`;
  const prefixQuery = `${normalizedQuery}%`;
  const limit = input.limit ?? 20;

  const rows = extractRows<CatalogFoodRow>(await db.execute(sql`
    SELECT DISTINCT
      f.id AS id,
      f.owner_user_id AS ownerUserId,
      f.source_id AS sourceId,
      fs.slug AS sourceSlug,
      fs.name AS sourceName,
      fs.version AS sourceVersion,
      f.source_food_code AS sourceFoodCode,
      f.name AS name,
      f.normalized_name AS normalizedName,
      f.brand_name AS brandName,
      f.category AS category,
      f.description AS description,
      f.status AS status,
      f.merged_into_food_id AS mergedIntoFoodId,
      f.calories_kcal_per_100g AS caloriesKcalPer100g,
      f.protein_grams_per_100g AS proteinGramsPer100g,
      f.carbs_grams_per_100g AS carbsGramsPer100g,
      f.fat_grams_per_100g AS fatGramsPer100g,
      f.fiber_grams_per_100g AS fiberGramsPer100g,
      f.sugar_grams_per_100g AS sugarGramsPer100g,
      f.sodium_mg_per_100g AS sodiumMgPer100g,
      f.nutrients_json AS nutrientsJson,
      CASE WHEN f.owner_user_id IS NULL THEN 1 ELSE 0 END AS isGlobal
    FROM foods f
    LEFT JOIN food_aliases fa ON fa.food_id = f.id
    LEFT JOIN food_sources fs ON fs.id = f.source_id
    WHERE (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
      AND (${input.includeInactive} = TRUE OR f.status = 'active')
      AND (${normalizedQuery} = '' OR f.normalized_name LIKE ${likeQuery} OR fa.normalized_alias LIKE ${likeQuery})
    ORDER BY
      CASE f.status WHEN 'active' THEN 0 WHEN 'deprecated' THEN 1 ELSE 2 END,
      CASE WHEN f.normalized_name = ${normalizedQuery} THEN 0 ELSE 1 END,
      CASE WHEN f.normalized_name LIKE ${prefixQuery} THEN 0 ELSE 1 END,
      CASE WHEN f.source_id IS NOT NULL THEN 0 ELSE 1 END,
      isGlobal DESC,
      f.name ASC
    LIMIT ${limit}
  `));

  return rows.map(row => mapCatalogFood(row));
}

export async function getGlobalFoodCatalogItem(userId: number, foodId: number) {
  const db = await getCatalogDb();
  const rows = extractRows<CatalogFoodRow>(await db.execute(sql`
    SELECT
      f.id AS id,
      f.owner_user_id AS ownerUserId,
      f.source_id AS sourceId,
      fs.slug AS sourceSlug,
      fs.name AS sourceName,
      fs.version AS sourceVersion,
      f.source_food_code AS sourceFoodCode,
      f.name AS name,
      f.normalized_name AS normalizedName,
      f.brand_name AS brandName,
      f.category AS category,
      f.description AS description,
      f.status AS status,
      f.merged_into_food_id AS mergedIntoFoodId,
      f.calories_kcal_per_100g AS caloriesKcalPer100g,
      f.protein_grams_per_100g AS proteinGramsPer100g,
      f.carbs_grams_per_100g AS carbsGramsPer100g,
      f.fat_grams_per_100g AS fatGramsPer100g,
      f.fiber_grams_per_100g AS fiberGramsPer100g,
      f.sugar_grams_per_100g AS sugarGramsPer100g,
      f.sodium_mg_per_100g AS sodiumMgPer100g,
      f.nutrients_json AS nutrientsJson,
      CASE WHEN f.owner_user_id IS NULL THEN 1 ELSE 0 END AS isGlobal
    FROM foods f
    LEFT JOIN food_sources fs ON fs.id = f.source_id
    WHERE f.id = ${foodId}
      AND (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
    LIMIT 1
  `));

  const food = rows[0];
  if (!food) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alimento não encontrado no catálogo." });
  }

  const portions = extractRows<CatalogFoodPortionRow>(await db.execute(sql`
    SELECT
      id AS id,
      label AS label,
      unit AS unit,
      quantity AS quantity,
      grams AS grams,
      is_default AS isDefault
    FROM food_portions
    WHERE food_id = ${foodId}
    ORDER BY is_default DESC, grams ASC, label ASC
  `));

  return mapCatalogFood(food, portions);
}

export function listRecentlyUsedFoods(userId: number) {
  return listRecentFoods(userId);
}

export function setFoodFavorite(userId: number, input: { foodId: number; favorite: boolean }) {
  return upsertFavoriteFood(userId, input.foodId, input.favorite);
}

export function createFood(userId: number, input: FoodFormInput) {
  return createUserFood(userId, input);
}

export async function updateFood(userId: number, input: FoodFormInput & { foodId: number }) {
  try {
    return await updateUserFood(userId, input);
  } catch (error) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: error instanceof Error ? error.message : "Alimento não encontrado.",
    });
  }
}
