import mysql from "mysql2/promise";

type Connection = mysql.Connection;

const NUTRITION_GOAL_COLUMNS = [
  { name: "weekday", sql: "`weekday` int NULL" },
  { name: "ruleType", sql: "`ruleType` enum('default','exception') DEFAULT 'default' NOT NULL" },
  { name: "durationType", sql: "`durationType` enum('1_week','2_weeks','3_weeks','always') DEFAULT 'always' NOT NULL" },
  { name: "effectiveUntil", sql: "`effectiveUntil` timestamp NULL" },
];

const FOOD_CATALOG_COLUMNS = [
  { name: "brandId", sql: "`brandId` int NULL" },
  { name: "brandName", sql: "`brandName` varchar(255) NULL" },
  { name: "foodType", sql: "`foodType` enum('generic','branded') DEFAULT 'generic' NOT NULL" },
  { name: "barcode", sql: "`barcode` varchar(64) NULL" },
  { name: "dataSource", sql: "`dataSource` varchar(80) DEFAULT 'manual' NOT NULL" },
  { name: "servingUnit", sql: "`servingUnit` varchar(40) DEFAULT 'g' NOT NULL" },
  { name: "fiber", sql: "`fiber` double NULL" },
  { name: "isFruit", sql: "`isFruit` int DEFAULT 0 NOT NULL" },
  { name: "isVegetable", sql: "`isVegetable` int DEFAULT 0 NOT NULL" },
  { name: "isUltraProcessed", sql: "`isUltraProcessed` int DEFAULT 0 NOT NULL" },
  { name: "isUserCreated", sql: "`isUserCreated` int DEFAULT 0 NOT NULL" },
  { name: "createdByUserId", sql: "`createdByUserId` int NULL" },
];

const MEAL_ITEM_COLUMNS = [
  { name: "recipeId", sql: "`recipeId` int NULL" },
  { name: "portionId", sql: "`portionId` int NULL" },
  { name: "itemType", sql: "`itemType` enum('food','recipe','free_text') DEFAULT 'food' NOT NULL" },
  { name: "quantity", sql: "`quantity` double DEFAULT 1 NOT NULL" },
  { name: "unit", sql: "`unit` varchar(40) DEFAULT 'serving' NOT NULL" },
];

const USER_PROFILE_COLUMNS = [
  { name: "displayName", sql: "`displayName` varchar(255) NULL" },
  { name: "ageYears", sql: "`ageYears` int NULL" },
  { name: "birthDate", sql: "`birthDate` varchar(10) NULL" },
  { name: "sex", sql: "`sex` enum('female','male','non_binary','prefer_not_to_say') DEFAULT 'prefer_not_to_say' NOT NULL" },
  { name: "heightCm", sql: "`heightCm` double NULL" },
  { name: "currentWeightKg", sql: "`currentWeightKg` double NULL" },
  { name: "nutritionObjective", sql: "`nutritionObjective` enum('emagrecer','manter_peso','ganhar_massa','melhorar_habitos') NULL" },
  { name: "activityLevel", sql: "`activityLevel` enum('sedentary','light','moderate','active','very_active') NULL" },
  { name: "trackingExperience", sql: "`trackingExperience` enum('beginner','intermediate','advanced') NULL" },
  { name: "eatingRoutine", sql: "`eatingRoutine` enum('cozinha_em_casa','come_fora','delivery','marmita','misto') NULL" },
  { name: "mainDifficulty", sql: "`mainDifficulty` enum('fome','ansiedade','falta_de_tempo','beliscos','doces','comer_fora','falta_de_planejamento') NULL" },
  { name: "onboardingCompletedAt", sql: "`onboardingCompletedAt` timestamp NULL" },
  { name: "timezone", sql: "`timezone` varchar(80) DEFAULT 'UTC' NOT NULL" },
  { name: "locale", sql: "`locale` varchar(16) DEFAULT 'pt-BR' NOT NULL" },
];

async function tableExists(connection: Connection, tableName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnExists(connection: Connection, tableName: string, columnName: string) {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function addMissingColumns(
  connection: Connection,
  tableName: string,
  columns: Array<{ name: string; sql: string }>,
) {
  if (!(await tableExists(connection, tableName))) {
    return [];
  }

  const added: string[] = [];
  for (const column of columns) {
    if (await columnExists(connection, tableName, column.name)) {
      continue;
    }

    await connection.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN ${column.sql}`);
    added.push(`${tableName}.${column.name}`);
  }

  return added;
}

async function normalizeNutritionGoalsWeekday(connection: Connection) {
  if (!(await tableExists(connection, "nutritionGoals"))) {
    return;
  }
  if (!(await columnExists(connection, "nutritionGoals", "weekday"))) {
    return;
  }

  await connection.execute("UPDATE `nutritionGoals` SET `weekday` = -1 WHERE `weekday` IS NULL");
  await connection.execute("ALTER TABLE `nutritionGoals` MODIFY COLUMN `weekday` int NOT NULL DEFAULT -1");
}

function createConnectionOptions(databaseUrl: string): mysql.ConnectionOptions {
  return {
    uri: databaseUrl,
    ssl: {
      minVersion: "TLSv1.2",
    },
  };
}

async function createSchemaConnection(databaseUrl: string) {
  if (process.env.TIDB_ENABLE_SSL !== "true") {
    return mysql.createConnection(databaseUrl);
  }

  return mysql.createConnection(createConnectionOptions(databaseUrl));
}

export async function ensureRuntimeSchemaCompatibility() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { added: [] as string[] };
  }

  const connection = await createSchemaConnection(databaseUrl);
  try {
    const added = [
      ...(await addMissingColumns(connection, "nutritionGoals", NUTRITION_GOAL_COLUMNS)),
      ...(await addMissingColumns(connection, "foodCatalog", FOOD_CATALOG_COLUMNS)),
      ...(await addMissingColumns(connection, "mealItems", MEAL_ITEM_COLUMNS)),
      ...(await addMissingColumns(connection, "userProfiles", USER_PROFILE_COLUMNS)),
    ];

    await normalizeNutritionGoalsWeekday(connection);
    return { added };
  } finally {
    await connection.end();
  }
}
