import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL não configurado.");
}

const connection = await mysql.createConnection(databaseUrl);

try {
  await connection.query(`
    CREATE TABLE IF NOT EXISTS appSecrets (
      id int AUTO_INCREMENT NOT NULL,
      secretKey varchar(64) NOT NULL,
      valueEncrypted text NOT NULL,
      updatedByUserId int,
      createdAt timestamp NOT NULL DEFAULT (now()),
      updatedAt timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT appSecrets_id PRIMARY KEY(id),
      CONSTRAINT appSecrets_secretKey_unique UNIQUE(secretKey)
    );
  `);

  const [rows] = await connection.query("SHOW TABLES LIKE 'appSecrets'");
  console.log(JSON.stringify({ ok: Array.isArray(rows) && rows.length > 0, table: "appSecrets" }));
} finally {
  await connection.end();
}
