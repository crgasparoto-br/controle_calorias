import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL não está definida.");
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

async function tableExists(tableName) {
  const [rows] = await connection.query("SHOW TABLES LIKE ?", [tableName]);
  return rows.length > 0;
}

try {
  const hasWaterGoals = await tableExists("waterGoals");
  const hasWaterLogs = await tableExists("waterLogs");

  if (!hasWaterGoals) {
    await connection.query(`
      CREATE TABLE waterGoals (
        id int AUTO_INCREMENT NOT NULL,
        userId int NOT NULL,
        dailyTargetMl int NOT NULL DEFAULT 2500,
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT waterGoals_id PRIMARY KEY(id),
        CONSTRAINT waterGoals_userId_unique UNIQUE(userId)
      )
    `);
    console.log("Tabela waterGoals criada com sucesso.");
  } else {
    console.log("Tabela waterGoals já existe. Nenhuma ação necessária.");
  }

  if (!hasWaterLogs) {
    await connection.query(`
      CREATE TABLE waterLogs (
        id int AUTO_INCREMENT NOT NULL,
        userId int NOT NULL,
        amountMl int NOT NULL,
        occurredAt timestamp NOT NULL DEFAULT (now()),
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT waterLogs_id PRIMARY KEY(id)
      )
    `);
    console.log("Tabela waterLogs criada com sucesso.");
  } else {
    console.log("Tabela waterLogs já existe. Nenhuma ação necessária.");
  }

  console.log("Migração 0006 aplicada com sucesso.");
} catch (error) {
  console.error("Falha ao aplicar a migração 0006.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
