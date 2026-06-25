import "dotenv/config";
import mysql from "mysql2/promise";

const WRONG_CANONICAL_NAME = "Leite integral";
const CORRECT_CANONICAL_NAME = "Bolo com cobertura de chantilly e recheio de doce de leite";
const JSON_WRONG_CANONICAL = `"canonicalName":"${WRONG_CANONICAL_NAME}"`;
const JSON_CORRECT_CANONICAL = `"canonicalName":"${CORRECT_CANONICAL_NAME}"`;

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

async function runUpdate(pool, sql, params) {
  const [result] = await pool.execute(sql, params);
  return Number(result?.affectedRows ?? 0);
}

async function main() {
  const pool = createPool();

  try {
    const mealItemsAffected = await runUpdate(
      pool,
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
      pool,
      `UPDATE mealInferences
       SET itemsJson = REPLACE(itemsJson, ?, ?)
       WHERE itemsJson LIKE ?
         AND LOWER(itemsJson) LIKE '%bolo%'
         AND LOWER(itemsJson) LIKE '%chantilly%'
         AND LOWER(itemsJson) LIKE '%doce de leite%'`,
      [JSON_WRONG_CANONICAL, JSON_CORRECT_CANONICAL, `%${JSON_WRONG_CANONICAL}%`],
    );

    const mealFavoritesAffected = await runUpdate(
      pool,
      `UPDATE mealFavorites
       SET itemsJson = REPLACE(itemsJson, ?, ?)
       WHERE itemsJson LIKE ?
         AND LOWER(itemsJson) LIKE '%bolo%'
         AND LOWER(itemsJson) LIKE '%chantilly%'
         AND LOWER(itemsJson) LIKE '%doce de leite%'`,
      [JSON_WRONG_CANONICAL, JSON_CORRECT_CANONICAL, `%${JSON_WRONG_CANONICAL}%`],
    );

    console.log(JSON.stringify({
      correctedCanonicalName: CORRECT_CANONICAL_NAME,
      affectedRows: {
        mealItems: mealItemsAffected,
        mealInferences: mealInferencesAffected,
        mealFavorites: mealFavoritesAffected,
      },
    }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
