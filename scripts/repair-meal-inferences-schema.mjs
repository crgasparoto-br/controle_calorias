import mysql from "mysql2/promise";

const TABLE_NAME = "mealInferences";

function buildConnectionOptions() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to repair mealInferences schema.");
  }

  const useSsl = process.env.TIDB_ENABLE_SSL === "true" || databaseUrl.includes("tidbcloud.com");
  if (!useSsl) {
    return databaseUrl;
  }

  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    ssl: { minVersion: "TLSv1.2" },
  };
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [tableName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function columnIsNullable(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    "SELECT IS_NULLABLE AS isNullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?",
    [tableName, columnName],
  );
  return String(rows[0]?.isNullable ?? "YES") === "YES";
}

async function indexExists(connection, tableName, indexName) {
  const [rows] = await connection.execute(
    "SELECT COUNT(*) AS total FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?",
    [tableName, indexName],
  );
  return Number(rows[0]?.total ?? 0) > 0;
}

async function ensureColumn(connection, columnName, definition) {
  if (await columnExists(connection, TABLE_NAME, columnName)) {
    console.log(`[Database] ${TABLE_NAME}.${columnName} already exists.`);
    return;
  }

  console.log(`[Database] Adding ${TABLE_NAME}.${columnName}.`);
  await connection.execute(`ALTER TABLE \`${TABLE_NAME}\` ADD COLUMN ${definition}`);
}

async function ensureIndex(connection, indexName, sql) {
  if (await indexExists(connection, TABLE_NAME, indexName)) {
    console.log(`[Database] ${indexName} already exists.`);
    return;
  }

  console.log(`[Database] Creating ${indexName}.`);
  await connection.execute(sql);
}

async function ensureDraftIdCanBeUnique(connection) {
  const [duplicates] = await connection.execute(
    `SELECT draftId, COUNT(*) AS total
     FROM \`${TABLE_NAME}\`
     GROUP BY draftId
     HAVING COUNT(*) > 1
     LIMIT 5`,
  );

  if (duplicates.length) {
    throw new Error(
      `Cannot create unique index on ${TABLE_NAME}.draftId because duplicate draftId values exist. Resolve duplicates before retrying.`,
    );
  }
}

async function main() {
  const connection = await mysql.createConnection(buildConnectionOptions());
  try {
    if (!(await tableExists(connection, TABLE_NAME))) {
      throw new Error(`${TABLE_NAME} table does not exist in the configured database.`);
    }

    await ensureColumn(connection, "sourceText", "`sourceText` text NULL AFTER `requestSummary`");
    await ensureColumn(connection, "transcript", "`transcript` text NULL AFTER `sourceText`");
    await ensureColumn(connection, "mediaJson", "`mediaJson` text NULL AFTER `transcript`");

    console.log("[Database] Backfilling missing mediaJson values.");
    await connection.execute(`UPDATE \`${TABLE_NAME}\` SET \`mediaJson\` = '[]' WHERE \`mediaJson\` IS NULL`);

    if (await columnIsNullable(connection, TABLE_NAME, "mediaJson")) {
      console.log("[Database] Making mealInferences.mediaJson required.");
      await connection.execute(`ALTER TABLE \`${TABLE_NAME}\` MODIFY COLUMN \`mediaJson\` text NOT NULL`);
    }

    await ensureDraftIdCanBeUnique(connection);
    await ensureIndex(
      connection,
      "mealInferences_draftId_unique",
      `CREATE UNIQUE INDEX \`mealInferences_draftId_unique\` ON \`${TABLE_NAME}\` (\`draftId\`)`,
    );
    await ensureIndex(
      connection,
      "mealInferences_userId_idx",
      `CREATE INDEX \`mealInferences_userId_idx\` ON \`${TABLE_NAME}\` (\`userId\`)`,
    );
    await ensureIndex(
      connection,
      "mealInferences_mealId_idx",
      `CREATE INDEX \`mealInferences_mealId_idx\` ON \`${TABLE_NAME}\` (\`mealId\`)`,
    );

    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`,
      [TABLE_NAME],
    );
    console.table(columns);
    console.log("[Database] mealInferences schema repair completed.");
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error("[Database] mealInferences schema repair failed:", error);
  process.exit(1);
});
