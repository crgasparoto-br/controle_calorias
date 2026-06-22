import mysql from "mysql2/promise";

type Connection = mysql.Connection;
type RuntimeSchemaCompatibilityMode = "repair" | "verify";
type CompatibilityIssueKind = "missing_column" | "missing_table" | "column_shape";

type ColumnCompatibility = {
  name: string;
  sql: string;
};

type ColumnMetadata = {
  isNullable: string;
  columnDefault: string | number | null;
};

export type RuntimeSchemaCompatibilityIssue = {
  kind: CompatibilityIssueKind;
  table: string;
  column?: string;
  description: string;
  productionAction: string;
};

export type RuntimeSchemaCompatibilityResult = {
  mode: RuntimeSchemaCompatibilityMode;
  added: string[];
  updated: string[];
  pending: RuntimeSchemaCompatibilityIssue[];
};

const MIGRATION_REQUIRED_MESSAGE =
  "Runtime schema compatibility detected pending structural changes in production. Run the versioned Drizzle migrations before starting the server.";

const USERS_COLUMNS: ColumnCompatibility[] = [
  { name: "passwordHash", sql: "`passwordHash` text NULL" },
  { name: "loginMethod", sql: "`loginMethod` varchar(64) NULL" },
  { name: "role", sql: "`role` enum('user','admin') DEFAULT 'user' NOT NULL" },
  { name: "lastSignedIn", sql: "`lastSignedIn` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL" },
];

const NUTRITION_GOAL_COLUMNS: ColumnCompatibility[] = [
  { name: "weekday", sql: "`weekday` int NULL" },
  { name: "ruleType", sql: "`ruleType` enum('default','exception') DEFAULT 'default' NOT NULL" },
  { name: "durationType", sql: "`durationType` enum('1_week','2_weeks','3_weeks','always') DEFAULT 'always' NOT NULL" },
  { name: "effectiveUntil", sql: "`effectiveUntil` timestamp NULL" },
];

const FOOD_CATALOG_COLUMNS: ColumnCompatibility[] = [
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

const MEAL_ITEM_COLUMNS: ColumnCompatibility[] = [
  { name: "recipeId", sql: "`recipeId` int NULL" },
  { name: "portionId", sql: "`portionId` int NULL" },
  { name: "itemType", sql: "`itemType` enum('food','recipe','free_text') DEFAULT 'food' NOT NULL" },
  { name: "quantity", sql: "`quantity` double DEFAULT 1 NOT NULL" },
  { name: "unit", sql: "`unit` varchar(40) DEFAULT 'serving' NOT NULL" },
];

const USER_PROFILE_COLUMNS: ColumnCompatibility[] = [
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

export class RuntimeSchemaCompatibilityError extends Error {
  readonly issues: RuntimeSchemaCompatibilityIssue[];

  constructor(issues: RuntimeSchemaCompatibilityIssue[]) {
    super(`${MIGRATION_REQUIRED_MESSAGE} Pending change(s): ${issues.map(formatIssue).join(", ")}`);
    this.name = "RuntimeSchemaCompatibilityError";
    this.issues = issues;
  }
}

function getRuntimeSchemaCompatibilityMode(): RuntimeSchemaCompatibilityMode {
  return process.env.NODE_ENV === "production" ? "verify" : "repair";
}

function formatIssue(issue: RuntimeSchemaCompatibilityIssue): string {
  return issue.column ? `${issue.table}.${issue.column}` : issue.table;
}

function createIssue(
  kind: CompatibilityIssueKind,
  table: string,
  description: string,
  column?: string
): RuntimeSchemaCompatibilityIssue {
  return {
    kind,
    table,
    column,
    description,
    productionAction: "Run the versioned Drizzle migrations before deploying or starting production.",
  };
}

async function tableExists(connection: Connection, tableName: string): Promise<boolean> {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnExists(connection: Connection, tableName: string, columnName: string): Promise<boolean> {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName]
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function getColumnMetadata(
  connection: Connection,
  tableName: string,
  columnName: string
): Promise<ColumnMetadata | null> {
  const [rows] = await connection.execute<mysql.RowDataPacket[]>(
    "SELECT IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS columnDefault FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName]
  );
  const row = rows[0];

  if (!row) {
    return null;
  }

  return {
    isNullable: String(row.isNullable),
    columnDefault: row.columnDefault as string | number | null,
  };
}

async function ensureColumns(
  connection: Connection,
  tableName: string,
  columns: ColumnCompatibility[],
  mode: RuntimeSchemaCompatibilityMode
): Promise<Pick<RuntimeSchemaCompatibilityResult, "added" | "pending">> {
  if (!(await tableExists(connection, tableName))) {
    return { added: [], pending: [] };
  }

  const added: string[] = [];
  const pending: RuntimeSchemaCompatibilityIssue[] = [];

  for (const column of columns) {
    if (await columnExists(connection, tableName, column.name)) {
      continue;
    }

    if (mode === "verify") {
      pending.push(
        createIssue(
          "missing_column",
          tableName,
          `Column ${tableName}.${column.name} is required by the current Drizzle schema.`,
          column.name
        )
      );
      continue;
    }

    await connection.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN ${column.sql}`);
    added.push(`${tableName}.${column.name}`);
  }

  return { added, pending };
}

async function ensureWhatsappOnboardingLeadsTable(
  connection: Connection,
  mode: RuntimeSchemaCompatibilityMode
): Promise<Pick<RuntimeSchemaCompatibilityResult, "added" | "pending">> {
  if (await tableExists(connection, "whatsapp_onboarding_leads")) {
    return { added: [], pending: [] };
  }

  if (mode === "verify") {
    return {
      added: [],
      pending: [
        createIssue(
          "missing_table",
          "whatsapp_onboarding_leads",
          "Table whatsapp_onboarding_leads is required by the current onboarding flow."
        ),
      ],
    };
  }

  await connection.execute(`
    CREATE TABLE \`whatsapp_onboarding_leads\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`phoneNumber\` varchar(32) NOT NULL,
      \`name\` varchar(255),
      \`email\` varchar(255),
      \`status\` enum('collecting_name','collecting_email','ready_for_signup','converted','expired') DEFAULT 'collecting_name' NOT NULL,
      \`source\` varchar(80) DEFAULT 'whatsapp' NOT NULL,
      \`signupTokenHash\` varchar(128),
      \`signupTokenExpiresAt\` timestamp NULL,
      \`convertedUserId\` int,
      \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
      \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
      \`lastInteractionAt\` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT \`whatsapp_onboarding_leads_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`whatsapp_onboarding_leads_phone_unique\` UNIQUE(\`phoneNumber\`),
      CONSTRAINT \`whatsapp_onboarding_leads_token_unique\` UNIQUE(\`signupTokenHash\`)
    );
  `);

  return { added: ["whatsapp_onboarding_leads"], pending: [] };
}

async function ensureQuickEditTokensTable(
  connection: Connection,
  mode: RuntimeSchemaCompatibilityMode
): Promise<Pick<RuntimeSchemaCompatibilityResult, "added" | "pending">> {
  if (await tableExists(connection, "quickEditTokens")) {
    return { added: [], pending: [] };
  }

  if (mode === "verify") {
    return {
      added: [],
      pending: [
        createIssue(
          "missing_table",
          "quickEditTokens",
          "Table quickEditTokens is required by the WhatsApp quick edit link flow."
        ),
      ],
    };
  }

  await connection.execute(`
    CREATE TABLE \`quickEditTokens\` (
      \`id\` int AUTO_INCREMENT NOT NULL,
      \`userId\` int NOT NULL,
      \`mealId\` int NOT NULL,
      \`tokenHash\` varchar(64) NOT NULL,
      \`expiresAt\` timestamp NOT NULL,
      \`usedAt\` timestamp NULL,
      \`lastAccessedAt\` timestamp NULL,
      \`createdAt\` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
      \`updatedAt\` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
      CONSTRAINT \`quickEditTokens_id\` PRIMARY KEY(\`id\`),
      CONSTRAINT \`quickEditTokens_tokenHash_unique\` UNIQUE(\`tokenHash\`),
      CONSTRAINT \`quickEditTokens_userId_users_id_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`users\`(\`id\`) ON DELETE cascade,
      CONSTRAINT \`quickEditTokens_mealId_meals_id_fk\` FOREIGN KEY (\`mealId\`) REFERENCES \`meals\`(\`id\`) ON DELETE cascade
    );
  `);
  await connection.execute(
    "CREATE INDEX `quickEditTokens_user_meal_idx` ON `quickEditTokens` (`userId`, `mealId`)"
  );
  await connection.execute(
    "CREATE INDEX `quickEditTokens_expiresAt_idx` ON `quickEditTokens` (`expiresAt`)"
  );

  return { added: ["quickEditTokens"], pending: [] };
}

async function normalizeNutritionGoalsWeekday(
  connection: Connection,
  mode: RuntimeSchemaCompatibilityMode
): Promise<Pick<RuntimeSchemaCompatibilityResult, "updated" | "pending">> {
  if (!(await tableExists(connection, "nutritionGoals"))) {
    return { updated: [], pending: [] };
  }

  if (!(await columnExists(connection, "nutritionGoals", "weekday"))) {
    return { updated: [], pending: [] };
  }

  const metadata = await getColumnMetadata(connection, "nutritionGoals", "weekday");
  const defaultValue = metadata?.columnDefault == null ? null : String(metadata.columnDefault);
  const hasExpectedShape = metadata?.isNullable === "NO" && defaultValue === "-1";

  if (hasExpectedShape) {
    return { updated: [], pending: [] };
  }

  if (mode === "verify") {
    return {
      updated: [],
      pending: [
        createIssue(
          "column_shape",
          "nutritionGoals",
          "Column nutritionGoals.weekday must be NOT NULL with DEFAULT -1 according to the current Drizzle schema.",
          "weekday"
        ),
      ],
    };
  }

  await connection.execute("UPDATE `nutritionGoals` SET `weekday` = -1 WHERE `weekday` IS NULL");
  await connection.execute("ALTER TABLE `nutritionGoals` MODIFY COLUMN `weekday` int NOT NULL DEFAULT -1");

  return { updated: ["nutritionGoals.weekday"], pending: [] };
}

function createConnectionOptions(databaseUrl: string): mysql.ConnectionOptions {
  const parsedUrl = new URL(databaseUrl);
  return {
    host: parsedUrl.hostname,
    port: parsedUrl.port ? Number(parsedUrl.port) : 4000,
    user: decodeURIComponent(parsedUrl.username),
    password: decodeURIComponent(parsedUrl.password),
    database: parsedUrl.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2" },
  };
}

async function createSchemaConnection(databaseUrl: string): Promise<Connection> {
  if (process.env.TIDB_ENABLE_SSL !== "true") {
    return mysql.createConnection(databaseUrl);
  }

  return mysql.createConnection(createConnectionOptions(databaseUrl));
}

function mergeResult(
  target: RuntimeSchemaCompatibilityResult,
  partial: Partial<RuntimeSchemaCompatibilityResult>
): void {
  target.added.push(...(partial.added ?? []));
  target.updated.push(...(partial.updated ?? []));
  target.pending.push(...(partial.pending ?? []));
}

export async function ensureRuntimeSchemaCompatibility(): Promise<RuntimeSchemaCompatibilityResult> {
  const databaseUrl = process.env.DATABASE_URL;
  const mode = getRuntimeSchemaCompatibilityMode();
  const result: RuntimeSchemaCompatibilityResult = { mode, added: [], updated: [], pending: [] };

  if (!databaseUrl) {
    return result;
  }

  const connection = await createSchemaConnection(databaseUrl);
  try {
    mergeResult(result, await ensureColumns(connection, "users", USERS_COLUMNS, mode));
    mergeResult(result, await ensureColumns(connection, "nutritionGoals", NUTRITION_GOAL_COLUMNS, mode));
    mergeResult(result, await ensureColumns(connection, "foodCatalog", FOOD_CATALOG_COLUMNS, mode));
    mergeResult(result, await ensureColumns(connection, "mealItems", MEAL_ITEM_COLUMNS, mode));
    mergeResult(result, await ensureColumns(connection, "userProfiles", USER_PROFILE_COLUMNS, mode));
    mergeResult(result, await ensureWhatsappOnboardingLeadsTable(connection, mode));
    mergeResult(result, await ensureQuickEditTokensTable(connection, mode));
    mergeResult(result, await normalizeNutritionGoalsWeekday(connection, mode));

    if (mode === "verify" && result.pending.length > 0) {
      throw new RuntimeSchemaCompatibilityError(result.pending);
    }

    return result;
  } finally {
    await connection.end();
  }
}
