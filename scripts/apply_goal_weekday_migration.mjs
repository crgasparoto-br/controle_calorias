import mysql from "mysql2/promise";

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Environment variable ${name} is required`);
  }
  return value;
}

async function hasColumn(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tableName, columnName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function hasIndex(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as count
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function main() {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const connection = await mysql.createConnection(databaseUrl);

  try {
    const weekdayExists = await hasColumn(connection, "nutritionGoals", "weekday");

    if (!weekdayExists) {
      await connection.execute("ALTER TABLE `nutritionGoals` ADD COLUMN `weekday` int NULL");
      console.log("weekday column added");
    } else {
      console.log("weekday column already exists");
    }

    await connection.execute(`
      DELETE older
      FROM nutritionGoals older
      JOIN nutritionGoals newer
        ON older.userId = newer.userId
       AND older.id < newer.id
      WHERE older.weekday IS NULL
        AND newer.weekday IS NULL
    `);

    await connection.execute("UPDATE `nutritionGoals` SET `weekday` = 0 WHERE `weekday` IS NULL");

    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      await connection.execute(
        `INSERT INTO nutritionGoals (
          userId,
          weekday,
          calories,
          proteinGrams,
          carbsGrams,
          fatGrams,
          effectiveFrom,
          createdAt,
          updatedAt
        )
        SELECT
          base.userId,
          ?,
          base.calories,
          base.proteinGrams,
          base.carbsGrams,
          base.fatGrams,
          base.effectiveFrom,
          base.createdAt,
          base.updatedAt
        FROM nutritionGoals base
        WHERE base.weekday = 0
          AND NOT EXISTS (
            SELECT 1
            FROM nutritionGoals existing
            WHERE existing.userId = base.userId
              AND existing.weekday = ?
          )`,
        [weekday, weekday],
      );
    }

    await connection.execute("ALTER TABLE `nutritionGoals` MODIFY COLUMN `weekday` int NOT NULL");

    const indexExists = await hasIndex(connection, "nutritionGoals", "nutritionGoals_user_weekday_idx");
    if (!indexExists) {
      await connection.execute(
        "ALTER TABLE `nutritionGoals` ADD CONSTRAINT `nutritionGoals_user_weekday_idx` UNIQUE(`userId`, `weekday`)"
      );
      console.log("unique index created");
    } else {
      console.log("unique index already exists");
    }

    const [summaryRows] = await connection.execute(
      `SELECT userId, COUNT(*) as dayCount
       FROM nutritionGoals
       GROUP BY userId
       ORDER BY userId ASC`,
    );

    console.log(JSON.stringify(summaryRows, null, 2));
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
