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
  if (await tableExists("exercises")) {
    console.log("Tabela exercises já existe. Nenhuma ação necessária.");
  } else {
    await connection.query(`
      CREATE TABLE exercises (
        id int AUTO_INCREMENT NOT NULL,
        userId int NOT NULL,
        activityType varchar(120) NOT NULL,
        durationMinutes int NOT NULL,
        caloriesBurned double NOT NULL,
        notes text,
        occurredAt timestamp NOT NULL DEFAULT (now()),
        createdAt timestamp NOT NULL DEFAULT (now()),
        updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT exercises_id PRIMARY KEY(id)
      )
    `);
    console.log("Migração 0005 aplicada com sucesso.");
  }
} catch (error) {
  console.error("Falha ao aplicar a migração 0005.");
  console.error(error);
  process.exitCode = 1;
} finally {
  await connection.end();
}
