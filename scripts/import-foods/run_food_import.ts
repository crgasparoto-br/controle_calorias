import mysql, { type ResultSetHeader } from "mysql2/promise";

import { generateAliases } from "./generate_aliases.ts";
import { normalizeFoodName } from "./normalize_food_name.ts";
import type { ImportFood, ImportPayload, ImportReport } from "./types.ts";

type DbConnection = mysql.Connection;

function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to import foods");
  }
  return databaseUrl;
}

function createConnectionOptions(databaseUrl: string): string | mysql.ConnectionOptions {
  if (process.env.TIDB_ENABLE_SSL !== "true") {
    return databaseUrl;
  }

  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: {
      minVersion: "TLSv1.2",
    },
  };
}

function numberOrNull(value: number | undefined) {
  return Number.isFinite(value) ? value : null;
}

function validateFood(food: ImportFood) {
  const requiredNumbers = [
    food.caloriesKcalPer100g,
    food.proteinGramsPer100g,
    food.carbsGramsPer100g,
    food.fatGramsPer100g,
  ];

  if (!food.sourceFoodCode.trim()) return "sourceFoodCode vazio";
  if (!food.name.trim()) return "name vazio";
  if (requiredNumbers.some(value => !Number.isFinite(value) || value < 0)) {
    return "macros principais invalidos";
  }
  return null;
}

async function ensureSource(connection: DbConnection, payload: ImportPayload) {
  const source = payload.source;
  await connection.execute<ResultSetHeader>(
    `INSERT INTO food_sources (slug, name, version, country_code, source_url, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       country_code = VALUES(country_code),
       source_url = VALUES(source_url),
       notes = VALUES(notes),
       updated_at = CURRENT_TIMESTAMP`,
    [source.slug, source.name, source.version, source.countryCode ?? null, source.sourceUrl ?? null, source.notes ?? null],
  );

  const [rows] = await connection.execute<Array<{ id: number }>>(
    "SELECT id FROM food_sources WHERE slug = ? AND version = ? LIMIT 1",
    [source.slug, source.version],
  );
  const sourceRow = rows[0];
  if (!sourceRow) throw new Error(`Fonte nao encontrada apos upsert: ${source.slug}@${source.version}`);
  return sourceRow.id;
}

async function findPossibleDuplicates(connection: DbConnection, sourceId: number, food: ImportFood) {
  const normalizedName = normalizeFoodName(food.name);
  const [rows] = await connection.execute<Array<{ id: number }>>(
    `SELECT id FROM foods
     WHERE owner_user_id IS NULL
       AND normalized_name = ?
       AND (source_id IS NULL OR source_id <> ? OR source_food_code <> ?)
     LIMIT 10`,
    [normalizedName, sourceId, food.sourceFoodCode],
  );
  return { normalizedName, existingFoodIds: rows.map(row => row.id) };
}

async function upsertFood(connection: DbConnection, sourceId: number, food: ImportFood) {
  const normalizedName = normalizeFoodName(food.name);
  const nutrientsJson = food.nutrients ? JSON.stringify(food.nutrients) : null;

  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO foods (
       owner_user_id, source_id, source_food_code, name, normalized_name, brand_name, category, description,
       status, calories_kcal_per_100g, protein_grams_per_100g, carbs_grams_per_100g, fat_grams_per_100g,
       fiber_grams_per_100g, sugar_grams_per_100g, sodium_mg_per_100g, nutrients_json
     ) VALUES (NULL, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       name = VALUES(name),
       normalized_name = VALUES(normalized_name),
       brand_name = VALUES(brand_name),
       category = VALUES(category),
       description = VALUES(description),
       status = 'active',
       calories_kcal_per_100g = VALUES(calories_kcal_per_100g),
       protein_grams_per_100g = VALUES(protein_grams_per_100g),
       carbs_grams_per_100g = VALUES(carbs_grams_per_100g),
       fat_grams_per_100g = VALUES(fat_grams_per_100g),
       fiber_grams_per_100g = VALUES(fiber_grams_per_100g),
       sugar_grams_per_100g = VALUES(sugar_grams_per_100g),
       sodium_mg_per_100g = VALUES(sodium_mg_per_100g),
       nutrients_json = VALUES(nutrients_json),
       updated_at = CURRENT_TIMESTAMP`,
    [
      sourceId,
      food.sourceFoodCode,
      food.name,
      normalizedName,
      food.brandName ?? null,
      food.category ?? null,
      food.description ?? null,
      food.caloriesKcalPer100g,
      food.proteinGramsPer100g,
      food.carbsGramsPer100g,
      food.fatGramsPer100g,
      numberOrNull(food.fiberGramsPer100g),
      numberOrNull(food.sugarGramsPer100g),
      numberOrNull(food.sodiumMgPer100g),
      nutrientsJson,
    ],
  );

  const [rows] = await connection.execute<Array<{ id: number }>>(
    "SELECT id FROM foods WHERE source_id = ? AND source_food_code = ? LIMIT 1",
    [sourceId, food.sourceFoodCode],
  );
  const foodRow = rows[0];
  if (!foodRow) throw new Error(`Alimento nao encontrado apos upsert: ${food.sourceFoodCode}`);

  return { foodId: foodRow.id, affectedRows: result.affectedRows };
}

async function insertAliases(connection: DbConnection, sourceId: number, foodId: number, food: ImportFood) {
  let inserted = 0;
  for (const alias of generateAliases(food.name, food.aliases)) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO food_aliases (food_id, alias, normalized_alias, source_id)
       VALUES (?, ?, ?, ?)`,
      [foodId, alias.alias, alias.normalizedAlias, sourceId],
    );
    inserted += result.affectedRows;
  }
  return inserted;
}

async function insertPortions(connection: DbConnection, sourceId: number, foodId: number, food: ImportFood) {
  let inserted = 0;
  for (const portion of food.portions ?? []) {
    const label = portion.label.trim();
    if (!label || !Number.isFinite(portion.grams) || portion.grams <= 0) continue;

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT IGNORE INTO food_portions (
         food_id, label, normalized_label, unit, quantity, grams, is_default, source_id, source_portion_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        foodId,
        label,
        normalizeFoodName(label),
        portion.unit ?? "serving",
        portion.quantity ?? 1,
        portion.grams,
        portion.isDefault ? 1 : 0,
        sourceId,
        portion.sourcePortionCode ?? null,
      ],
    );
    inserted += result.affectedRows;
  }
  return inserted;
}

export async function importFoods(payload: ImportPayload): Promise<ImportReport> {
  const report: ImportReport = {
    sourceSlug: payload.source.slug,
    sourceVersion: payload.source.version,
    inserted: 0,
    updated: 0,
    ignored: 0,
    aliasesInserted: 0,
    portionsInserted: 0,
    possibleDuplicates: [],
    errors: [],
  };

  const connection = await mysql.createConnection(createConnectionOptions(requireDatabaseUrl()));
  try {
    await connection.beginTransaction();
    const sourceId = await ensureSource(connection, payload);

    for (const food of payload.foods) {
      const error = validateFood(food);
      if (error) {
        report.ignored += 1;
        report.errors.push({ sourceFoodCode: food.sourceFoodCode, name: food.name, reason: error });
        continue;
      }

      const duplicateInfo = await findPossibleDuplicates(connection, sourceId, food);
      if (duplicateInfo.existingFoodIds.length > 0) {
        report.possibleDuplicates.push({
          sourceFoodCode: food.sourceFoodCode,
          normalizedName: duplicateInfo.normalizedName,
          existingFoodIds: duplicateInfo.existingFoodIds,
        });
      }

      const { foodId, affectedRows } = await upsertFood(connection, sourceId, food);
      if (affectedRows === 1) report.inserted += 1;
      else report.updated += 1;

      report.aliasesInserted += await insertAliases(connection, sourceId, foodId, food);
      report.portionsInserted += await insertPortions(connection, sourceId, foodId, food);
    }

    await connection.commit();
    return report;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    await connection.end();
  }
}

export function printImportReport(report: ImportReport) {
  console.log(JSON.stringify(report, null, 2));
}
