import "dotenv/config";
import mysql from "mysql2/promise";

const WRONG_CANONICAL_NAME = "Leite integral";
const CORRECT_CANONICAL_NAME = "Bolo com cobertura de chantilly e recheio de doce de leite";
const JSON_WRONG_CANONICAL = `"canonicalName":"${WRONG_CANONICAL_NAME}"`;
const JSON_CORRECT_CANONICAL = `"canonicalName":"${CORRECT_CANONICAL_NAME}"`;
const DEFAULT_REPORT_LIMIT = 50;

function envFlagEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function envFlagDisabled(value) {
  return ["0", "false", "no", "off"].includes(String(value ?? "").toLowerCase());
}

function shouldEnableSsl(connectionString) {
  const explicitValue = process.env.TIDB_ENABLE_SSL;
  if (envFlagEnabled(explicitValue)) return true;
  if (envFlagDisabled(explicitValue)) return false;
  return connectionString.includes("tidbcloud.com");
}

function createPool() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL não configurada.");
  }

  return mysql.createPool({
    uri: databaseUrl,
    waitForConnections: true,
    connectionLimit: Number(process.env.DATABASE_CONNECTION_LIMIT ?? 10),
    ...(shouldEnableSsl(databaseUrl) ? { ssl: { minVersion: "TLSv1.2" } } : {}),
  });
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function includesAllTerms(value, terms) {
  const normalized = normalizeText(value);
  return terms.every(term => normalized.includes(term));
}

function isExactBoloChantillyDoceDeLeite(value) {
  return includesAllTerms(value, ["bolo", "chantilly", "doce de leite"]);
}

function isSuspiciousLeiteAssociation(foodName) {
  const normalized = normalizeText(foodName);
  const hasMilkTerm = /\bleite\b/.test(normalized) || normalized.includes("milk") || normalized.includes("molico");
  const hasDessertTerm = [
    "bolo",
    "chantilly",
    "cobertura",
    "recheio",
    "doce",
    "torta",
    "pudim",
    "brigadeiro",
    "beijinho",
    "chocolate",
    "sorvete",
    "cookie",
    "biscoito",
    "bombom",
    "sobremesa",
  ].some(term => normalized.includes(term));

  return !hasMilkTerm || hasDessertTerm;
}

function toSafeMealItemReport(row) {
  return {
    id: row.id,
    mealId: row.mealId,
    foodName: row.foodName,
    canonicalName: row.canonicalName,
    foodCatalogId: row.foodCatalogId,
    portionId: row.portionId,
    source: row.source,
    estimatedGrams: Number(row.estimatedGrams ?? 0),
    calories: Number(row.calories ?? 0),
  };
}

async function countRows(pool, sql, params) {
  const [rows] = await pool.execute(sql, params);
  return Number(rows?.[0]?.count ?? 0);
}

async function loadReport(pool, reportLimit) {
  const [mealItemRows] = await pool.execute(
    `SELECT id, mealId, foodName, canonicalName, foodCatalogId, portionId, source, estimatedGrams, calories
     FROM mealItems
     WHERE canonicalName = ?
     ORDER BY id`,
    [WRONG_CANONICAL_NAME],
  );

  const allLeiteMealItems = Array.isArray(mealItemRows) ? mealItemRows : [];
  const suspiciousMealItems = allLeiteMealItems.filter(row => isSuspiciousLeiteAssociation(row.foodName));
  const boloMealItems = allLeiteMealItems.filter(row => normalizeText(row.foodName).includes("bolo"));
  const exactRepairCandidates = allLeiteMealItems.filter(row => isExactBoloChantillyDoceDeLeite(row.foodName));

  const allInferenceWrongCanonical = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM mealInferences WHERE itemsJson LIKE ?",
    [`%${JSON_WRONG_CANONICAL}%`],
  );
  const boloInferenceWrongCanonical = await countRows(
    pool,
    `SELECT COUNT(*) AS count FROM mealInferences
     WHERE itemsJson LIKE ?
       AND LOWER(itemsJson) LIKE '%bolo%'`,
    [`%${JSON_WRONG_CANONICAL}%`],
  );
  const exactInferenceRepairCandidates = await countRows(
    pool,
    `SELECT COUNT(*) AS count FROM mealInferences
     WHERE itemsJson LIKE ?
       AND LOWER(itemsJson) LIKE '%bolo%'
       AND LOWER(itemsJson) LIKE '%chantilly%'
       AND LOWER(itemsJson) LIKE '%doce de leite%'`,
    [`%${JSON_WRONG_CANONICAL}%`],
  );

  const allFavoriteWrongCanonical = await countRows(
    pool,
    "SELECT COUNT(*) AS count FROM mealFavorites WHERE itemsJson LIKE ?",
    [`%${JSON_WRONG_CANONICAL}%`],
  );
  const boloFavoriteWrongCanonical = await countRows(
    pool,
    `SELECT COUNT(*) AS count FROM mealFavorites
     WHERE itemsJson LIKE ?
       AND LOWER(itemsJson) LIKE '%bolo%'`,
    [`%${JSON_WRONG_CANONICAL}%`],
  );
  const exactFavoriteRepairCandidates = await countRows(
    pool,
    `SELECT COUNT(*) AS count FROM mealFavorites
     WHERE itemsJson LIKE ?
       AND LOWER(itemsJson) LIKE '%bolo%'
       AND LOWER(itemsJson) LIKE '%chantilly%'
       AND LOWER(itemsJson) LIKE '%doce de leite%'`,
    [`%${JSON_WRONG_CANONICAL}%`],
  );

  return {
    wrongCanonicalName: WRONG_CANONICAL_NAME,
    intendedCanonicalName: CORRECT_CANONICAL_NAME,
    mealItems: {
      totalWithLeiteIntegralCanonical: allLeiteMealItems.length,
      suspiciousLeiteAssociations: suspiciousMealItems.length,
      boloAssociatedToLeite: boloMealItems.length,
      exactRepairCandidates: exactRepairCandidates.length,
      suspiciousSamples: suspiciousMealItems.slice(0, reportLimit).map(toSafeMealItemReport),
      boloSamples: boloMealItems.slice(0, reportLimit).map(toSafeMealItemReport),
      exactRepairSamples: exactRepairCandidates.slice(0, reportLimit).map(toSafeMealItemReport),
    },
    mealInferences: {
      totalJsonWithLeiteIntegralCanonical: allInferenceWrongCanonical,
      boloJsonWithLeiteIntegralCanonical: boloInferenceWrongCanonical,
      exactRepairCandidates: exactInferenceRepairCandidates,
    },
    mealFavorites: {
      totalJsonWithLeiteIntegralCanonical: allFavoriteWrongCanonical,
      boloJsonWithLeiteIntegralCanonical: boloFavoriteWrongCanonical,
      exactRepairCandidates: exactFavoriteRepairCandidates,
    },
  };
}

async function runUpdate(connection, sql, params) {
  const [result] = await connection.execute(sql, params);
  return Number(result?.affectedRows ?? 0);
}

async function applyExactRepair(pool) {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const mealItemsAffected = await runUpdate(
      connection,
      `UPDATE mealItems
       SET canonicalName = ?,
           foodCatalogId = NULL,
           portionId = NULL,
           source = CASE WHEN source = 'catalog' THEN 'hybrid' ELSE source END
       WHERE canonicalName = ?
         AND LOWER(foodName) LIKE '%bolo%'
         AND LOWER(foodName) LIKE '%chantilly%'
         AND LOWER(foodName) LIKE '%doce de leite%'`,
      [CORRECT_CANONICAL_NAME, WRONG_CANONICAL_NAME],
    );

    const mealInferencesAffected = await runUpdate(
      connection,
      `UPDATE mealInferences
       SET itemsJson = REPLACE(itemsJson, ?, ?)
       WHERE itemsJson LIKE ?
         AND LOWER(itemsJson) LIKE '%bolo%'
         AND LOWER(itemsJson) LIKE '%chantilly%'
         AND LOWER(itemsJson) LIKE '%doce de leite%'`,
      [JSON_WRONG_CANONICAL, JSON_CORRECT_CANONICAL, `%${JSON_WRONG_CANONICAL}%`],
    );

    const mealFavoritesAffected = await runUpdate(
      connection,
      `UPDATE mealFavorites
       SET itemsJson = REPLACE(itemsJson, ?, ?)
       WHERE itemsJson LIKE ?
         AND LOWER(itemsJson) LIKE '%bolo%'
         AND LOWER(itemsJson) LIKE '%chantilly%'
         AND LOWER(itemsJson) LIKE '%doce de leite%'`,
      [JSON_WRONG_CANONICAL, JSON_CORRECT_CANONICAL, `%${JSON_WRONG_CANONICAL}%`],
    );

    await connection.commit();

    return {
      mealItems: mealItemsAffected,
      mealInferences: mealInferencesAffected,
      mealFavorites: mealFavoritesAffected,
    };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const shouldApply = args.has("--apply");
  const reportLimit = Number(process.env.REPAIR_BOLO_REPORT_LIMIT ?? DEFAULT_REPORT_LIMIT);
  const pool = createPool();

  try {
    const before = await loadReport(pool, Number.isFinite(reportLimit) && reportLimit > 0 ? reportLimit : DEFAULT_REPORT_LIMIT);
    const result = {
      mode: shouldApply ? "apply" : "dry-run",
      before,
      appliedRows: null,
      nextStep: shouldApply
        ? "Reparo aplicado apenas nos candidatos exatos com bolo, chantilly e doce de leite. Revise os demais suspeitos do relatório."
        : "Nenhum dado foi alterado. Revise os suspeitos e execute com --apply apenas para corrigir os candidatos exatos.",
    };

    if (shouldApply) {
      result.appliedRows = await applyExactRepair(pool);
      result.after = await loadReport(pool, Number.isFinite(reportLimit) && reportLimit > 0 ? reportLimit : DEFAULT_REPORT_LIMIT);
    }

    console.log(JSON.stringify(result, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
