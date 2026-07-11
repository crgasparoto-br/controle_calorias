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

async function main() {
  const databaseUrl = requiredEnv("DATABASE_URL");
  const useSsl = process.env.TIDB_ENABLE_SSL === "true";
  const connection = await mysql.createConnection(
    useSsl ? { uri: databaseUrl, ssl: { minVersion: "TLSv1.2" } } : databaseUrl,
  );

  try {
    const columnExists = await hasColumn(connection, "nutritionGoals", "includeExerciseCalories");

    if (!columnExists) {
      await connection.execute(
        "ALTER TABLE `nutritionGoals` ADD COLUMN `includeExerciseCalories` boolean NOT NULL DEFAULT true",
      );
      console.log("includeExerciseCalories column added");
    } else {
      console.log("includeExerciseCalories column already exists");
    }
  } finally {
    await connection.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
