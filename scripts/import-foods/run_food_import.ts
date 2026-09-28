import mysql, {
  type ConnectionOptions,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

import { generateAliases } from "./generate_aliases.ts";
import {
  normalizeFoodName,
  normalizeSourceCode,
} from "./normalize_food_name.ts";
import { createSourceContentHash } from "./sourceFingerprint.ts";
import type { ImportFood, ImportPayload, ImportReport } from "./types.ts";

type DbConnection = mysql.Connection;

type FoodIdRow = RowDataPacket & {
  id: number;
};

type SourceRow = RowDataPacket & {
  id: number;
  contentHash: string | null;
};

type EnsuredSource = {
  sourceId: number;
  contentConflict: boolean;
};

type ImportIssue = {
  sourceFoodCode?: string;
  name?: string;
  reason: string;
};

export type ImportPreviewReport = {
  phase: "preview";
  sourceSlug: string;
  sourceVersion: string;
  sourceContentHash: string;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  missingRequired: number;
  duplicateCodes: string[];
  unitConversionsApplied: number;
  possibleDuplicates: Array<{
    sourceFoodCode: string;
    normalizedName: string;
    existingFoodIds: number[];
  }>;
  errors: ImportIssue[];
  sourceConflict: boolean;
  canPublish: boolean;
};

export type ImportFoodsOptions = {
  transactionBatchSize?: number;
  connectionFactory?: () => Promise<DbConnection>;
  initiatedBy?: string;
  expectedPreviewHash?: string;
};

export class FoodImportValidationError extends Error {
  constructor(
    public readonly errors: Array<{
      sourceFoodCode?: string;
      name?: string;
      reason: string;
    }>
  ) {
    super("Carga de alimentos rejeitada por falha de validação");
    this.name = "FoodImportValidationError";
  }
}

export class SourceContentConflictError extends Error {
  constructor(sourceSlug: string, sourceVersion: string) {
    super(
      `Fonte ${sourceSlug}@${sourceVersion} já possui outra identidade material; use uma nova versão`
    );
    this.name = "SourceContentConflictError";
  }
}

export class ImportPreviewMismatchError extends Error {
  constructor() {
    super(
      "A prévia não corresponde exatamente ao arquivo, fonte, versão ou origem informados"
    );
    this.name = "ImportPreviewMismatchError";
  }
}

function requireDatabaseUrl() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to import foods");
  }
  return databaseUrl;
}

function createConnectionOptions(
  databaseUrl: string
): string | ConnectionOptions {
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

async function createImportConnection() {
  const connectionOptions = createConnectionOptions(requireDatabaseUrl());
  if (typeof connectionOptions === "string") {
    return mysql.createConnection(connectionOptions);
  }
  return mysql.createConnection(connectionOptions);
}

function numberOrNull(value: number | undefined) {
  return Number.isFinite(value) ? value : null;
}

function optionalTrim(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function normalizeImportPayload(payload: ImportPayload): ImportPayload {
  return {
    source: {
      ...payload.source,
      slug: payload.source.slug.trim().toLowerCase(),
      name: payload.source.name.trim(),
      version: payload.source.version.trim(),
      countryCode: optionalTrim(payload.source.countryCode)?.toUpperCase(),
      sourceUrl: optionalTrim(payload.source.sourceUrl),
      sourceReference: optionalTrim(payload.source.sourceReference),
      collectedAt: optionalTrim(payload.source.collectedAt),
      notes: optionalTrim(payload.source.notes),
    },
    foods: payload.foods.map(food => ({
      ...food,
      sourceFoodCode: normalizeSourceCode(food.sourceFoodCode),
      name: food.name.trim(),
      brandName: optionalTrim(food.brandName),
      category: optionalTrim(food.category),
      description: optionalTrim(food.description),
      aliases: food.aliases?.map(alias => alias.trim()),
      portions: food.portions?.map(portion => ({
        ...portion,
        label: portion.label.trim(),
        unit: portion.unit?.trim().toLowerCase() || "serving",
        sourcePortionCode: (() => {
          const code = optionalTrim(portion.sourcePortionCode);
          return code ? normalizeSourceCode(code) : undefined;
        })(),
      })),
    })),
  };
}

function validateSource(payload: ImportPayload) {
  const source = payload.source;
  const sensitiveMetadataPattern =
    /(api[_ -]?key|access[_ -]?token|secret|password|bearer)/i;
  if (!source.slug.trim()) throw new Error("source.slug vazio");
  if (!source.name.trim()) throw new Error("source.name vazio");
  if (!source.version.trim()) throw new Error("source.version vazio");
  if (source.slug.length > 80)
    throw new Error("source.slug excede 80 caracteres");
  if (source.name.length > 160)
    throw new Error("source.name excede 160 caracteres");
  if (source.version.length > 80)
    throw new Error("source.version excede 80 caracteres");
  if (source.countryCode && source.countryCode.length > 2)
    throw new Error("source.countryCode inválido");
  if (source.sourceUrl && source.sourceUrl.length > 255)
    throw new Error("source.sourceUrl excede 255 caracteres");
  if (source.sourceUrl) {
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(source.sourceUrl);
    } catch {
      throw new Error("source.sourceUrl inválido");
    }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      throw new Error("source.sourceUrl deve usar http ou https");
    }
    if (
      parsedUrl.username ||
      parsedUrl.password ||
      [...parsedUrl.searchParams.keys()].some(key =>
        sensitiveMetadataPattern.test(key)
      )
    ) {
      throw new Error("source.sourceUrl não pode conter credenciais ou tokens");
    }
  }
  if (source.sourceReference && source.sourceReference.length > 255) {
    throw new Error("source.sourceReference excede 255 caracteres");
  }
  if (
    source.sourceReference &&
    sensitiveMetadataPattern.test(source.sourceReference)
  ) {
    throw new Error("source.sourceReference não pode conter segredo ou token");
  }
  if (source.notes && sensitiveMetadataPattern.test(source.notes)) {
    throw new Error("source.notes não pode conter segredo ou token");
  }
  if (
    source.collectedAt &&
    !Number.isFinite(new Date(source.collectedAt).getTime())
  ) {
    throw new Error("source.collectedAt inválido");
  }
}

function validateFood(food: ImportFood) {
  const requiredNumbers = [
    food.caloriesKcalPer100g,
    food.proteinGramsPer100g,
    food.carbsGramsPer100g,
    food.fatGramsPer100g,
  ];

  if (!normalizeSourceCode(food.sourceFoodCode)) return "sourceFoodCode vazio";
  if (normalizeSourceCode(food.sourceFoodCode).length > 120)
    return "sourceFoodCode excede 120 caracteres";
  if (!food.name.trim()) return "name vazio";
  if (food.name.length > 255) return "name excede 255 caracteres";
  if (food.brandName && food.brandName.length > 255)
    return "brandName excede 255 caracteres";
  if (food.category && food.category.length > 160)
    return "category excede 160 caracteres";
  if (requiredNumbers.some(value => !Number.isFinite(value) || value < 0)) {
    return "macros principais invalidos";
  }
  if (food.aliases?.some(alias => !alias || alias.length > 255)) {
    return "alias invalido";
  }
  if (
    food.portions?.some(
      portion =>
        !portion.label ||
        portion.label.length > 120 ||
        !portion.unit ||
        portion.unit.length > 40 ||
        !Number.isFinite(portion.quantity ?? 1) ||
        (portion.quantity ?? 1) <= 0 ||
        !Number.isFinite(portion.grams) ||
        portion.grams <= 0 ||
        (portion.sourcePortionCode !== undefined &&
          portion.sourcePortionCode.length > 120)
    )
  ) {
    return "porcao invalida";
  }
  return null;
}

export function collectValidationErrors(payload: ImportPayload): ImportIssue[] {
  if (payload.foods.length === 0) return [{ reason: "foods vazio" }];
  const seenCodes = new Set<string>();
  const errors = payload.foods.flatMap(food => {
    const reason = validateFood(food);
    const normalizedCode = normalizeSourceCode(food.sourceFoodCode);
    const duplicateReason =
      normalizedCode && seenCodes.has(normalizedCode)
        ? "sourceFoodCode duplicado na mesma carga"
        : null;
    if (normalizedCode) seenCodes.add(normalizedCode);
    const finalReason = reason ?? duplicateReason;
    return finalReason
      ? [
          {
            sourceFoodCode: food.sourceFoodCode,
            name: food.name,
            reason: finalReason,
          },
        ]
      : [];
  });
  return errors;
}

function validatePayload(payload: ImportPayload) {
  const errors = collectValidationErrors(payload);
  if (errors.length > 0) throw new FoodImportValidationError(errors);
}

function createImportReport(
  payload: ImportPayload,
  sourceContentHash: string,
  importId: number
): ImportReport {
  return {
    sourceSlug: payload.source.slug,
    sourceVersion: payload.source.version,
    sourceContentHash,
    importId,
    inserted: 0,
    updated: 0,
    ignored: 0,
    aliasesInserted: 0,
    portionsInserted: 0,
    possibleDuplicates: [],
    errors: [],
  };
}

function chunkFoods(foods: ImportFood[], batchSize: number) {
  const chunks: ImportFood[][] = [];
  for (let index = 0; index < foods.length; index += batchSize) {
    chunks.push(foods.slice(index, index + batchSize));
  }
  return chunks;
}

function importActor(explicitActor?: string) {
  const value = (
    explicitActor ??
    process.env.FOOD_IMPORT_ACTOR ??
    "cli:food-import"
  )
    .trim()
    .replace(/[^a-zA-Z0-9:._-]/g, "_")
    .slice(0, 120);
  return value || "cli:food-import";
}

function collectedAt(payload: ImportPayload) {
  return payload.source.collectedAt
    ? new Date(payload.source.collectedAt)
    : null;
}

async function ensureSource(
  connection: DbConnection,
  payload: ImportPayload,
  contentHash: string
): Promise<EnsuredSource> {
  const source = payload.source;
  await connection.execute<ResultSetHeader>(
    `INSERT INTO food_sources (slug, name, version, country_code, source_url, source_reference, content_hash, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE id = id`,
    [
      source.slug,
      source.name,
      source.version,
      source.countryCode ?? null,
      source.sourceUrl ?? null,
      source.sourceReference ?? source.name,
      null,
      null,
    ]
  );

  const [candidateRows] = await connection.execute<SourceRow[]>(
    "SELECT id, content_hash AS contentHash FROM food_sources WHERE slug = ? AND version = ? LIMIT 1",
    [source.slug, source.version]
  );
  const candidate = candidateRows[0];
  if (!candidate)
    throw new Error(
      `Fonte não encontrada após upsert: ${source.slug}@${source.version}`
    );

  if (candidate.contentHash && candidate.contentHash !== contentHash) {
    return { sourceId: candidate.id, contentConflict: true };
  }
  return { sourceId: candidate.id, contentConflict: false };
}

async function claimSourceContentHash(
  connection: DbConnection,
  sourceId: number,
  contentHash: string,
  source: ImportPayload["source"]
) {
  await connection.execute<ResultSetHeader>(
    `UPDATE food_sources
     SET name = ?, country_code = ?, source_url = ?, source_reference = ?, content_hash = ?
     WHERE id = ? AND content_hash IS NULL`,
    [
      source.name,
      source.countryCode ?? null,
      source.sourceUrl ?? null,
      source.sourceReference ?? source.name,
      contentHash,
      sourceId,
    ]
  );
  const [rows] = await connection.execute<SourceRow[]>(
    "SELECT id, content_hash AS contentHash FROM food_sources WHERE id = ? LIMIT 1",
    [sourceId]
  );
  const row = rows[0];
  if (!row || row.contentHash !== contentHash) {
    throw new SourceContentConflictError(source.slug, source.version);
  }
}

async function createImportRun(
  connection: DbConnection,
  payload: ImportPayload,
  sourceId: number,
  contentHash: string,
  initiatedBy?: string
) {
  const [result] = await connection.execute<ResultSetHeader>(
    `INSERT INTO food_source_imports (source_id, content_hash, initiated_by, status, collected_at, record_count)
     VALUES (?, ?, ?, 'running', ?, ?)`,
    [
      sourceId,
      contentHash,
      importActor(initiatedBy),
      collectedAt(payload),
      payload.foods.length,
    ]
  );
  return result.insertId;
}

function reportSummary(
  report: ImportReport,
  status: "succeeded" | "warning" | "failed",
  errorCode?: string
) {
  const failed = status === "failed";
  return JSON.stringify({
    sourceContentHash: report.sourceContentHash,
    recordCount: failed ? 0 : report.inserted + report.updated,
    inserted: failed ? 0 : report.inserted,
    updated: failed ? 0 : report.updated,
    ignored: failed ? report.errors.length : report.ignored,
    aliasesInserted: failed ? 0 : report.aliasesInserted,
    portionsInserted: failed ? 0 : report.portionsInserted,
    possibleDuplicates: failed ? 0 : report.possibleDuplicates.length,
    errors: report.errors.length,
    errorCode: errorCode ?? null,
  });
}

function errorCode(error: unknown) {
  if (error instanceof FoodImportValidationError) return "invalid_food_row";
  if (error instanceof SourceContentConflictError)
    return "source_content_conflict";
  if (error instanceof ImportPreviewMismatchError) return "preview_mismatch";
  return "persistence_error";
}

async function finishImportRun(
  connection: DbConnection,
  importId: number,
  status: "succeeded" | "warning" | "failed",
  report: ImportReport,
  failureCode?: string
) {
  await connection.execute<ResultSetHeader>(
    `UPDATE food_source_imports
     SET status = ?, finished_at = CURRENT_TIMESTAMP, inserted_count = ?, updated_count = ?,
         ignored_count = ?, aliases_inserted = ?, portions_inserted = ?, error_code = ?, result_json = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [
      status,
      status === "failed" ? 0 : report.inserted,
      status === "failed" ? 0 : report.updated,
      status === "failed" ? report.errors.length : report.ignored,
      status === "failed" ? 0 : report.aliasesInserted,
      status === "failed" ? 0 : report.portionsInserted,
      failureCode ?? null,
      reportSummary(report, status, failureCode),
      importId,
    ]
  );
}

async function findPossibleDuplicates(
  connection: DbConnection,
  sourceId: number,
  food: ImportFood
) {
  const normalizedName = normalizeFoodName(food.name);
  const sourceFoodCode = normalizeSourceCode(food.sourceFoodCode);
  const [rows] = await connection.execute<FoodIdRow[]>(
    `SELECT id FROM foods
     WHERE owner_user_id IS NULL
       AND normalized_name = ?
       AND (source_id IS NULL OR source_id <> ? OR source_food_code <> ?)
     LIMIT 10`,
    [normalizedName, sourceId, sourceFoodCode]
  );
  return { normalizedName, existingFoodIds: rows.map(row => row.id) };
}

async function findExistingSource(
  connection: DbConnection,
  payload: ImportPayload
): Promise<SourceRow | undefined> {
  const [rows] = await connection.execute<SourceRow[]>(
    "SELECT id, content_hash AS contentHash FROM food_sources WHERE slug = ? AND version = ? LIMIT 1",
    [payload.source.slug, payload.source.version]
  );
  return rows[0];
}

function countUnitConversions(payload: ImportPayload) {
  return payload.foods.reduce(
    (count, food) =>
      count +
      (food.portions?.filter(
        portion =>
          portion.unit?.toLowerCase() === "g" &&
          Number.isFinite(portion.grams) &&
          Number.isFinite(portion.quantity) &&
          portion.grams !== portion.quantity
      ).length ?? 0),
    0
  );
}

export async function previewFoods(
  payload: ImportPayload,
  options: Pick<ImportFoodsOptions, "connectionFactory"> = {}
): Promise<ImportPreviewReport> {
  const normalizedPayload = normalizeImportPayload(payload);
  validateSource(normalizedPayload);
  const sourceContentHash = createSourceContentHash(normalizedPayload);
  const errors = collectValidationErrors(normalizedPayload);
  const connection = await (
    options.connectionFactory ?? createImportConnection
  )();

  try {
    const existingSource = await findExistingSource(connection, normalizedPayload);
    const sourceConflict = Boolean(
      existingSource?.contentHash &&
        existingSource.contentHash !== sourceContentHash
    );
    const sourceId = existingSource?.id ?? 0;
    const possibleDuplicates: ImportPreviewReport["possibleDuplicates"] = [];
    for (const food of normalizedPayload.foods) {
      const hasRowError = errors.some(
        error =>
          error.sourceFoodCode === food.sourceFoodCode ||
          error.name === food.name
      );
      if (hasRowError) continue;
      const duplicateInfo = await findPossibleDuplicates(connection, sourceId, food);
      if (duplicateInfo.existingFoodIds.length > 0) {
        possibleDuplicates.push({
          sourceFoodCode: normalizeSourceCode(food.sourceFoodCode),
          normalizedName: duplicateInfo.normalizedName,
          existingFoodIds: duplicateInfo.existingFoodIds,
        });
      }
    }
    const allErrors = sourceConflict
      ? [
          ...errors,
          {
            reason:
              "A mesma fonte e versão já estão vinculadas a outro conteúdo; publique uma nova versão.",
          },
        ]
      : errors;
    const duplicateCodes = allErrors
      .filter(error => error.reason.includes("sourceFoodCode duplicado"))
      .map(error => normalizeSourceCode(error.sourceFoodCode ?? ""))
      .filter(Boolean);
    const missingRequired = allErrors.filter(error =>
      /vazio|macros principais invalidos|porcao invalida/i.test(error.reason)
    ).length;
    return {
      phase: "preview",
      sourceSlug: normalizedPayload.source.slug,
      sourceVersion: normalizedPayload.source.version,
      sourceContentHash,
      totalRows: normalizedPayload.foods.length,
      validRows: Math.max(0, normalizedPayload.foods.length - errors.length),
      invalidRows: errors.length,
      missingRequired,
      duplicateCodes: [...new Set(duplicateCodes)],
      unitConversionsApplied: countUnitConversions(normalizedPayload),
      possibleDuplicates,
      errors: allErrors,
      sourceConflict,
      canPublish: errors.length === 0 && !sourceConflict,
    };
  } finally {
    await connection.end();
  }
}

async function upsertFood(
  connection: DbConnection,
  sourceId: number,
  food: ImportFood
) {
  const normalizedName = normalizeFoodName(food.name);
  const sourceFoodCode = normalizeSourceCode(food.sourceFoodCode);
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
      sourceFoodCode,
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
    ]
  );

  const [rows] = await connection.execute<FoodIdRow[]>(
    "SELECT id FROM foods WHERE source_id = ? AND source_food_code = ? LIMIT 1",
    [sourceId, sourceFoodCode]
  );
  const foodRow = rows[0];
  if (!foodRow)
    throw new Error(
      `Alimento não encontrado após upsert: ${food.sourceFoodCode}`
    );

  return { foodId: foodRow.id, affectedRows: result.affectedRows };
}

async function insertAliases(
  connection: DbConnection,
  sourceId: number,
  foodId: number,
  food: ImportFood
) {
  let inserted = 0;
  for (const alias of generateAliases(food.name, food.aliases)) {
    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO food_aliases (food_id, alias, normalized_alias, source_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
      [foodId, alias.alias, alias.normalizedAlias, sourceId]
    );
    inserted += result.affectedRows;
  }
  return inserted;
}

async function insertPortions(
  connection: DbConnection,
  sourceId: number,
  foodId: number,
  food: ImportFood
) {
  let inserted = 0;
  for (const portion of food.portions ?? []) {
    const label = portion.label.trim();

    const [result] = await connection.execute<ResultSetHeader>(
      `INSERT INTO food_portions (
         food_id, label, normalized_label, unit, quantity, grams, is_default, source_id, source_portion_code
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE id = id`,
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
      ]
    );
    inserted += result.affectedRows;
  }
  return inserted;
}

async function importFoodBatch(
  connection: DbConnection,
  sourceId: number,
  foods: ImportFood[],
  report: ImportReport
) {
  for (const food of foods) {
    const duplicateInfo = await findPossibleDuplicates(
      connection,
      sourceId,
      food
    );
    if (duplicateInfo.existingFoodIds.length > 0) {
      report.possibleDuplicates.push({
        sourceFoodCode: normalizeSourceCode(food.sourceFoodCode),
        normalizedName: duplicateInfo.normalizedName,
        existingFoodIds: duplicateInfo.existingFoodIds,
      });
    }

    const { foodId, affectedRows } = await upsertFood(
      connection,
      sourceId,
      food
    );
    if (affectedRows === 1) report.inserted += 1;
    else report.updated += 1;

    report.aliasesInserted += await insertAliases(
      connection,
      sourceId,
      foodId,
      food
    );
    report.portionsInserted += await insertPortions(
      connection,
      sourceId,
      foodId,
      food
    );
  }
}

export async function importFoods(
  payload: ImportPayload,
  options: ImportFoodsOptions = {}
): Promise<ImportReport> {
  const normalizedPayload = normalizeImportPayload(payload);
  validateSource(normalizedPayload);
  const sourceContentHash = createSourceContentHash(normalizedPayload);
  if (
    options.expectedPreviewHash &&
    options.expectedPreviewHash !== sourceContentHash
  ) {
    throw new ImportPreviewMismatchError();
  }
  const connection = await (
    options.connectionFactory ?? createImportConnection
  )();
  let importId = 0;
  let report: ImportReport | null = null;
  let transactionStarted = false;

  try {
    const ensuredSource = await ensureSource(
      connection,
      normalizedPayload,
      sourceContentHash
    );
    importId = await createImportRun(
      connection,
      normalizedPayload,
      ensuredSource.sourceId,
      sourceContentHash,
      options.initiatedBy
    );
    report = createImportReport(normalizedPayload, sourceContentHash, importId);

    try {
      if (ensuredSource.contentConflict) {
        throw new SourceContentConflictError(
          normalizedPayload.source.slug,
          normalizedPayload.source.version
        );
      }
      validatePayload(normalizedPayload);
      const batchSize =
        options.transactionBatchSize && options.transactionBatchSize > 0
          ? Math.floor(options.transactionBatchSize)
          : normalizedPayload.foods.length;
      const batches = chunkFoods(
        normalizedPayload.foods,
        Math.max(1, batchSize)
      );

      await connection.beginTransaction();
      transactionStarted = true;
      await claimSourceContentHash(
        connection,
        ensuredSource.sourceId,
        sourceContentHash,
        normalizedPayload.source
      );
      for (const batch of batches) {
        await importFoodBatch(
          connection,
          ensuredSource.sourceId,
          batch,
          report
        );
      }
      await finishImportRun(
        connection,
        importId,
        report.possibleDuplicates.length > 0 ? "warning" : "succeeded",
        report
      );
      await connection.commit();
      transactionStarted = false;
      return report;
    } catch (error) {
      if (error instanceof FoodImportValidationError) {
        report.errors.push(...error.errors);
        report.ignored = error.errors.length;
      }
      if (transactionStarted) {
        await connection.rollback();
        transactionStarted = false;
      }
      await finishImportRun(
        connection,
        importId,
        "failed",
        report,
        errorCode(error)
      );
      throw error;
    }
  } finally {
    if (transactionStarted) await connection.rollback().catch(() => undefined);
    await connection.end();
  }
}

export function printImportReport(report: ImportReport) {
  console.log(JSON.stringify(report, null, 2));
}
