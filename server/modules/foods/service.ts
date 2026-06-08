import { randomUUID } from "node:crypto";
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
import type {
  AdminCatalogFoodCurationInput,
  CatalogFoodFavoriteInput,
  CatalogFoodRecentInput,
  CatalogFoodSearchInput,
  CustomFoodInput,
  FoodFormInput,
  UpdateCustomFoodInput,
} from "./schemas";

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
  isFavorite?: number | boolean | null;
  usageCount?: number | null;
  lastUsedAt?: Date | string | null;
};

type CatalogFoodPortionRow = {
  id: number;
  label: string;
  unit: string;
  quantity: number;
  grams: number;
  isDefault: number;
};

type CatalogFoodPortionConversionRow = CatalogFoodPortionRow & {
  foodId: number;
};

type CustomFoodOwnershipRow = {
  id: number;
};

type GlobalFoodLookupRow = {
  id: number;
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

function normalizeTimestamp(value: Date | string | null | undefined) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
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
    userSignals: {
      favorite: Boolean(row.isFavorite),
      usageCount: Number(row.usageCount ?? 0),
      lastUsedAt: normalizeTimestamp(row.lastUsedAt),
    },
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

function normalizeOptionalString(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function serializeNutrients(value: Record<string, unknown> | null | undefined) {
  return value ? JSON.stringify(value) : null;
}

function uniqueNormalizedAliases(name: string, aliases: string[]) {
  const seen = new Set<string>();
  const values = [name, ...aliases]
    .map(alias => ({ alias: alias.trim(), normalizedAlias: normalizeCatalogSearchTerm(alias) }))
    .filter(({ alias, normalizedAlias }) => alias && normalizedAlias);

  return values.filter(({ normalizedAlias }) => {
    if (seen.has(normalizedAlias)) return false;
    seen.add(normalizedAlias);
    return true;
  });
}

export function calculatePortionGrams(params: { portionGrams: number; portionQuantity: number; requestedQuantity: number }) {
  const baseQuantity = params.portionQuantity > 0 ? params.portionQuantity : 1;
  return Math.round((params.portionGrams * params.requestedQuantity / baseQuantity) * 100) / 100;
}

async function assertOwnedCustomFood(db: SqlExecutor, userId: number, foodId: number) {
  const rows = extractRows<CustomFoodOwnershipRow>(await db.execute(sql`
    SELECT id AS id
    FROM foods
    WHERE id = ${foodId}
      AND owner_user_id = ${userId}
    LIMIT 1
  `));

  if (!rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alimento personalizado não encontrado." });
  }
}

async function assertGlobalFood(db: SqlExecutor, foodId: number) {
  const rows = extractRows<GlobalFoodLookupRow>(await db.execute(sql`
    SELECT id AS id
    FROM foods
    WHERE id = ${foodId}
      AND owner_user_id IS NULL
    LIMIT 1
  `));

  if (!rows[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Alimento global não encontrado." });
  }
}

async function insertCustomFoodAliases(db: SqlExecutor, foodId: number, name: string, aliases: string[]) {
  for (const { alias, normalizedAlias } of uniqueNormalizedAliases(name, aliases)) {
    await db.execute(sql`
      INSERT INTO food_aliases (food_id, alias, normalized_alias, source_id)
      VALUES (${foodId}, ${alias}, ${normalizedAlias}, NULL)
    `);
  }
}

async function replaceCustomFoodPortions(db: SqlExecutor, foodId: number, portions: CustomFoodInput["portions"]) {
  await db.execute(sql`DELETE FROM food_portions WHERE food_id = ${foodId}`);

  for (const portion of portions) {
    await db.execute(sql`
      INSERT INTO food_portions (food_id, label, normalized_label, unit, quantity, grams, is_default, source_id)
      VALUES (
        ${foodId},
        ${portion.label},
        ${normalizeCatalogSearchTerm(portion.label)},
        ${portion.unit},
        ${portion.quantity},
        ${portion.grams},
        ${portion.isDefault},
        NULL
      )
    `);
  }
}

async function replaceCustomFoodAliases(db: SqlExecutor, foodId: number, name: string, aliases: string[]) {
  await db.execute(sql`DELETE FROM food_aliases WHERE food_id = ${foodId}`);
  await insertCustomFoodAliases(db, foodId, name, aliases);
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
      CASE WHEN f.owner_user_id IS NULL THEN 1 ELSE 0 END AS isGlobal,
      CASE WHEN uff.id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      COALESCE(ufus.usage_count, 0) AS usageCount,
      ufus.last_used_at AS lastUsedAt
    FROM foods f
    LEFT JOIN food_aliases fa ON fa.food_id = f.id
    LEFT JOIN food_sources fs ON fs.id = f.source_id
    LEFT JOIN user_food_favorites uff ON uff.food_id = f.id AND uff.user_id = ${userId}
    LEFT JOIN user_food_usage_stats ufus ON ufus.food_id = f.id AND ufus.user_id = ${userId}
    WHERE (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
      AND (${input.includeInactive} = TRUE OR f.status = 'active')
      AND (${normalizedQuery} = '' OR f.normalized_name LIKE ${likeQuery} OR fa.normalized_alias LIKE ${likeQuery})
    ORDER BY
      CASE f.status WHEN 'active' THEN 0 WHEN 'deprecated' THEN 1 ELSE 2 END,
      isFavorite DESC,
      CASE WHEN ufus.last_used_at IS NULL THEN 1 ELSE 0 END,
      ufus.last_used_at DESC,
      ufus.usage_count DESC,
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
      CASE WHEN f.owner_user_id IS NULL THEN 1 ELSE 0 END AS isGlobal,
      CASE WHEN uff.id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      COALESCE(ufus.usage_count, 0) AS usageCount,
      ufus.last_used_at AS lastUsedAt
    FROM foods f
    LEFT JOIN food_sources fs ON fs.id = f.source_id
    LEFT JOIN user_food_favorites uff ON uff.food_id = f.id AND uff.user_id = ${userId}
    LEFT JOIN user_food_usage_stats ufus ON ufus.food_id = f.id AND ufus.user_id = ${userId}
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

export async function listGlobalRecentlyUsedFoods(userId: number, input: CatalogFoodRecentInput = { limit: 20 }) {
  const db = await getCatalogDb();
  const limit = input.limit ?? 20;

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
      CASE WHEN f.owner_user_id IS NULL THEN 1 ELSE 0 END AS isGlobal,
      CASE WHEN uff.id IS NULL THEN 0 ELSE 1 END AS isFavorite,
      ufus.usage_count AS usageCount,
      ufus.last_used_at AS lastUsedAt
    FROM user_food_usage_stats ufus
    INNER JOIN foods f ON f.id = ufus.food_id
    LEFT JOIN food_sources fs ON fs.id = f.source_id
    LEFT JOIN user_food_favorites uff ON uff.food_id = f.id AND uff.user_id = ${userId}
    WHERE ufus.user_id = ${userId}
      AND f.status = 'active'
      AND (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
    ORDER BY ufus.last_used_at DESC, ufus.usage_count DESC, f.name ASC
    LIMIT ${limit}
  `));

  return rows.map(row => mapCatalogFood(row));
}

export async function setGlobalFoodFavorite(userId: number, input: CatalogFoodFavoriteInput) {
  const db = await getCatalogDb();
  await getGlobalFoodCatalogItem(userId, input.foodId);

  if (input.favorite) {
    await db.execute(sql`
      INSERT INTO user_food_favorites (user_id, food_id)
      VALUES (${userId}, ${input.foodId})
      ON DUPLICATE KEY UPDATE created_at = created_at
    `);
  } else {
    await db.execute(sql`
      DELETE FROM user_food_favorites
      WHERE user_id = ${userId}
        AND food_id = ${input.foodId}
    `);
  }

  return getGlobalFoodCatalogItem(userId, input.foodId);
}

export async function recordGlobalFoodUsage(userId: number, foodId: number) {
  const db = await getCatalogDb();
  await getGlobalFoodCatalogItem(userId, foodId);

  await db.execute(sql`
    INSERT INTO user_food_usage_stats (user_id, food_id, usage_count, last_used_at)
    VALUES (${userId}, ${foodId}, 1, CURRENT_TIMESTAMP)
    ON DUPLICATE KEY UPDATE
      usage_count = usage_count + 1,
      last_used_at = CURRENT_TIMESTAMP,
      updated_at = CURRENT_TIMESTAMP
  `);
}

export async function curateGlobalFood(userId: number, input: AdminCatalogFoodCurationInput) {
  const db = await getCatalogDb();
  await assertGlobalFood(db, input.foodId);

  if (input.status === "merged") {
    await assertGlobalFood(db, input.mergedIntoFoodId as number);
  }

  const mergedIntoFoodId = input.status === "merged" ? input.mergedIntoFoodId : null;

  await db.execute(sql`
    UPDATE foods
    SET
      status = ${input.status},
      merged_into_food_id = ${mergedIntoFoodId ?? null},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${input.foodId}
      AND owner_user_id IS NULL
  `);

  return getGlobalFoodCatalogItem(userId, input.foodId);
}

export async function convertFoodPortionToGrams(userId: number, input: { foodId: number; portionId: number; quantity: number }) {
  const db = await getCatalogDb();
  const rows = extractRows<CatalogFoodPortionConversionRow>(await db.execute(sql`
    SELECT
      fp.id AS id,
      fp.food_id AS foodId,
      fp.label AS label,
      fp.unit AS unit,
      fp.quantity AS quantity,
      fp.grams AS grams,
      fp.is_default AS isDefault
    FROM food_portions fp
    INNER JOIN foods f ON f.id = fp.food_id
    WHERE fp.id = ${input.portionId}
      AND fp.food_id = ${input.foodId}
      AND (f.owner_user_id IS NULL OR f.owner_user_id = ${userId})
    LIMIT 1
  `));

  const portion = rows[0];
  if (!portion) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Porção não encontrada para este alimento." });
  }

  return {
    portionId: portion.id,
    foodId: portion.foodId,
    label: portion.label,
    unit: portion.unit,
    quantity: input.quantity,
    baseQuantity: portion.quantity,
    baseGrams: portion.grams,
    grams: calculatePortionGrams({
      portionGrams: portion.grams,
      portionQuantity: portion.quantity,
      requestedQuantity: input.quantity,
    }),
  };
}

export async function createCustomFood(userId: number, input: CustomFoodInput) {
  const db = await getCatalogDb();
  const normalizedName = normalizeCatalogSearchTerm(input.name);
  const sourceFoodCode = `custom:${userId}:${randomUUID()}`;
  const nutrientsJson = serializeNutrients(input.nutrients);

  await db.execute(sql`
    INSERT INTO foods (
      owner_user_id,
      source_id,
      source_food_code,
      name,
      normalized_name,
      brand_name,
      category,
      description,
      status,
      calories_kcal_per_100g,
      protein_grams_per_100g,
      carbs_grams_per_100g,
      fat_grams_per_100g,
      fiber_grams_per_100g,
      sugar_grams_per_100g,
      sodium_mg_per_100g,
      nutrients_json
    )
    VALUES (
      ${userId},
      NULL,
      ${sourceFoodCode},
      ${input.name},
      ${normalizedName},
      ${normalizeOptionalString(input.brandName)},
      ${normalizeOptionalString(input.category)},
      ${normalizeOptionalString(input.description)},
      'active',
      ${input.caloriesKcalPer100g},
      ${input.proteinGramsPer100g},
      ${input.carbsGramsPer100g},
      ${input.fatGramsPer100g},
      ${input.fiberGramsPer100g ?? null},
      ${input.sugarGramsPer100g ?? null},
      ${input.sodiumMgPer100g ?? null},
      ${nutrientsJson}
    )
  `);

  const createdRows = extractRows<{ id: number }>(await db.execute(sql`
    SELECT id AS id
    FROM foods
    WHERE owner_user_id = ${userId}
      AND source_food_code = ${sourceFoodCode}
    LIMIT 1
  `));
  const foodId = createdRows[0]?.id;

  if (!foodId) {
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Não foi possível criar o alimento personalizado." });
  }

  await insertCustomFoodAliases(db, foodId, input.name, input.aliases);
  await replaceCustomFoodPortions(db, foodId, input.portions);

  return getGlobalFoodCatalogItem(userId, foodId);
}

export async function updateCustomFood(userId: number, input: UpdateCustomFoodInput) {
  const db = await getCatalogDb();
  await assertOwnedCustomFood(db, userId, input.foodId);

  const normalizedName = normalizeCatalogSearchTerm(input.name);
  const nutrientsJson = serializeNutrients(input.nutrients);

  await db.execute(sql`
    UPDATE foods
    SET
      name = ${input.name},
      normalized_name = ${normalizedName},
      brand_name = ${normalizeOptionalString(input.brandName)},
      category = ${normalizeOptionalString(input.category)},
      description = ${normalizeOptionalString(input.description)},
      status = 'active',
      calories_kcal_per_100g = ${input.caloriesKcalPer100g},
      protein_grams_per_100g = ${input.proteinGramsPer100g},
      carbs_grams_per_100g = ${input.carbsGramsPer100g},
      fat_grams_per_100g = ${input.fatGramsPer100g},
      fiber_grams_per_100g = ${input.fiberGramsPer100g ?? null},
      sugar_grams_per_100g = ${input.sugarGramsPer100g ?? null},
      sodium_mg_per_100g = ${input.sodiumMgPer100g ?? null},
      nutrients_json = ${nutrientsJson},
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ${input.foodId}
      AND owner_user_id = ${userId}
  `);

  await replaceCustomFoodAliases(db, input.foodId, input.name, input.aliases);
  await replaceCustomFoodPortions(db, input.foodId, input.portions);

  return getGlobalFoodCatalogItem(userId, input.foodId);
}

export async function deleteCustomFood(userId: number, foodId: number) {
  const db = await getCatalogDb();
  await assertOwnedCustomFood(db, userId, foodId);

  await db.execute(sql`
    UPDATE foods
    SET status = 'deprecated', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${foodId}
      AND owner_user_id = ${userId}
  `);

  return {
    success: true,
    foodId,
    status: "deprecated" as const,
  };
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
