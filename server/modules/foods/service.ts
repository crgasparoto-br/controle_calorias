import { TRPCError } from "@trpc/server";
import { and, eq, isNull, like, or, sql } from "drizzle-orm";
import { foodAliases, foodPortions, foods, foodSources } from "../../../drizzle/schema";
import {
  createUserFood,
  getDb,
  listRecentFoods,
  searchFoods,
  updateUserFood,
  upsertFavoriteFood,
} from "../../db";
import type { CatalogFoodSearchInput, FoodFormInput } from "./schemas";

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
  return db;
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
  const predicates = [
    or(isNull(foods.ownerUserId), eq(foods.ownerUserId, userId)),
    input.includeInactive ? undefined : eq(foods.status, "active"),
    normalizedQuery
      ? or(like(foods.normalizedName, likeQuery), like(foodAliases.normalizedAlias, likeQuery))
      : undefined,
  ].filter(Boolean);

  const rows = await db
    .selectDistinct({
      id: foods.id,
      ownerUserId: foods.ownerUserId,
      sourceId: foods.sourceId,
      sourceSlug: foodSources.slug,
      sourceName: foodSources.name,
      sourceVersion: foodSources.version,
      sourceFoodCode: foods.sourceFoodCode,
      name: foods.name,
      normalizedName: foods.normalizedName,
      brandName: foods.brandName,
      category: foods.category,
      description: foods.description,
      status: foods.status,
      mergedIntoFoodId: foods.mergedIntoFoodId,
      caloriesKcalPer100g: foods.caloriesKcalPer100g,
      proteinGramsPer100g: foods.proteinGramsPer100g,
      carbsGramsPer100g: foods.carbsGramsPer100g,
      fatGramsPer100g: foods.fatGramsPer100g,
      fiberGramsPer100g: foods.fiberGramsPer100g,
      sugarGramsPer100g: foods.sugarGramsPer100g,
      sodiumMgPer100g: foods.sodiumMgPer100g,
      nutrientsJson: foods.nutrientsJson,
      isGlobal: sql<number>`CASE WHEN ${foods.ownerUserId} IS NULL THEN 1 ELSE 0 END`,
    })
    .from(foods)
    .leftJoin(foodAliases, eq(foodAliases.foodId, foods.id))
    .leftJoin(foodSources, eq(foodSources.id, foods.sourceId))
    .where(and(...predicates))
    .orderBy(
      sql`CASE ${foods.status} WHEN 'active' THEN 0 WHEN 'deprecated' THEN 1 ELSE 2 END`,
      sql`CASE WHEN ${foods.normalizedName} = ${normalizedQuery} THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${foods.normalizedName} LIKE ${prefixQuery} THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${foods.sourceId} IS NOT NULL THEN 0 ELSE 1 END`,
      sql`CASE WHEN ${foods.ownerUserId} IS NULL THEN 1 ELSE 0 END DESC`,
      foods.name,
    )
    .limit(limit);

  return rows.map(row => mapCatalogFood(row));
}

export async function getGlobalFoodCatalogItem(userId: number, foodId: number) {
  const db = await getCatalogDb();
  const rows = await db
    .select({
      id: foods.id,
      ownerUserId: foods.ownerUserId,
      sourceId: foods.sourceId,
      sourceSlug: foodSources.slug,
      sourceName: foodSources.name,
      sourceVersion: foodSources.version,
      sourceFoodCode: foods.sourceFoodCode,
      name: foods.name,
      normalizedName: foods.normalizedName,
      brandName: foods.brandName,
      category: foods.category,
      description: foods.description,
      status: foods.status,
      mergedIntoFoodId: foods.mergedIntoFoodId,
      caloriesKcalPer100g: foods.caloriesKcalPer100g,
      proteinGramsPer100g: foods.proteinGramsPer100g,
      carbsGramsPer100g: foods.carbsGramsPer100g,
      fatGramsPer100g: foods.fatGramsPer100g,
      fiberGramsPer100g: foods.fiberGramsPer100g,
      sugarGramsPer100g: foods.sugarGramsPer100g,
      sodiumMgPer100g: foods.sodiumMgPer100g,
      nutrientsJson: foods.nutrientsJson,
      isGlobal: sql<number>`CASE WHEN ${foods.ownerUserId} IS NULL THEN 1 ELSE 0 END`,
    })
    .from(foods)
    .leftJoin(foodSources, eq(foodSources.id, foods.sourceId))
    .where(and(eq(foods.id, foodId), or(isNull(foods.ownerUserId), eq(foods.ownerUserId, userId))))
    .limit(1);

  const food = rows[0];
  if (!food) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alimento não encontrado no catálogo." });
  }

  const portions = await db
    .select({
      id: foodPortions.id,
      label: foodPortions.label,
      unit: foodPortions.unit,
      quantity: foodPortions.quantity,
      grams: foodPortions.grams,
      isDefault: foodPortions.isDefault,
    })
    .from(foodPortions)
    .where(eq(foodPortions.foodId, foodId))
    .orderBy(sql`${foodPortions.isDefault} DESC`, foodPortions.grams, foodPortions.label);

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
