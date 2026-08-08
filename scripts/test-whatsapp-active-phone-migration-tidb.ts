import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the WhatsApp active-phone migration test."
  );
}

function connectionOptions() {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 4000),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
    multipleStatements: true,
  };
}

function isDuplicateEntryError(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    if (typeof current !== "object") return false;
    const candidate = current as {
      code?: string;
      errno?: number;
      cause?: unknown;
    };
    if (candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

async function applyDrizzleMigration(
  connection: mysql.Connection,
  migration: string
) {
  const statements = migration
    .split("--> statement-breakpoint")
    .map(statement => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await connection.query(statement);
  }
}

const connection = await mysql.createConnection(connectionOptions());
try {
  await connection.query("DROP TABLE IF EXISTS whatsappConnections");
  await connection.query(`
    CREATE TABLE whatsappConnections (
      id int AUTO_INCREMENT NOT NULL,
      userId int NOT NULL,
      phoneNumber varchar(32) NOT NULL,
      displayName varchar(255),
      status enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT whatsappConnections_id PRIMARY KEY(id)
    );
    CREATE INDEX whatsappConnections_userId_idx
      ON whatsappConnections (userId);
    CREATE INDEX whatsappConnections_phoneNumber_idx
      ON whatsappConnections (phoneNumber);
  `);

  await connection.query(`
    INSERT INTO whatsappConnections
      (userId, phoneNumber, displayName, status, createdAt, updatedAt)
    VALUES
      (700, '5511999999910', 'Registro antigo', 'active',
       '2026-07-20 10:00:00', '2026-07-20 10:00:00'),
      (701, '5511999999910', 'Registro mais recente', 'active',
       '2026-07-21 10:00:00', '2026-07-21 10:00:00'),
      (702, '5511999999910', 'Histórico já desativado', 'disabled',
       '2026-07-19 10:00:00', '2026-07-19 10:00:00');
  `);

  const migration = await readFile(
    path.join(
      process.cwd(),
      "drizzle",
      "0040_whatsapp_active_phone_uniqueness.sql"
    ),
    "utf8"
  );
  await applyDrizzleMigration(connection, migration);

  const [rows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT userId, phoneNumber, activePhoneKey, status
    FROM whatsappConnections
    WHERE phoneNumber = '5511999999910'
    ORDER BY userId
  `);
  const activeRows = rows.filter(row => row.status === "active");
  const disabledRows = rows.filter(row => row.status === "disabled");
  if (
    activeRows.length !== 1 ||
    Number(activeRows[0]?.userId) !== 701 ||
    activeRows[0]?.activePhoneKey !== "5511999999910"
  ) {
    throw new Error(
      "The migration did not preserve only the newest active WhatsApp link."
    );
  }
  if (
    disabledRows.length !== 2 ||
    disabledRows.some(row => row.activePhoneKey !== null)
  ) {
    throw new Error(
      "The migration did not preserve disabled history outside the unique key."
    );
  }

  let duplicateRejected = false;
  try {
    await connection.query(`
      INSERT INTO whatsappConnections
        (userId, phoneNumber, displayName, status)
      VALUES (703, '5511999999910', 'Concorrente', 'active')
    `);
  } catch (error) {
    duplicateRejected = isDuplicateEntryError(error);
  }
  if (!duplicateRejected) {
    throw new Error("The unique active-phone constraint was not enforced.");
  }

  await connection.query(`
    INSERT INTO whatsappConnections
      (userId, phoneNumber, displayName, status)
    VALUES (703, '5511999999910', 'Histórico permitido', 'disabled')
  `);
  await connection.query(`
    UPDATE whatsappConnections
    SET status = 'disabled'
    WHERE userId = 701 AND phoneNumber = '5511999999910'
  `);
  await connection.query(`
    INSERT INTO whatsappConnections
      (userId, phoneNumber, displayName, status)
    VALUES (704, '5511999999910', 'Novo vínculo ativo', 'active')
  `);

  const [finalRows] = await connection.query<mysql.RowDataPacket[]>(`
    SELECT COUNT(*) AS activeCount
    FROM whatsappConnections
    WHERE phoneNumber = '5511999999910' AND status = 'active'
  `);
  if (Number(finalRows[0]?.activeCount) !== 1) {
    throw new Error("Phone transfer did not leave exactly one active link.");
  }

  console.log(
    JSON.stringify({
      activeWinnerUserId: Number(activeRows[0]?.userId),
      disabledHistoryPreserved: disabledRows.length,
      duplicateRejected,
      transferActiveCount: Number(finalRows[0]?.activeCount),
    })
  );
} finally {
  await connection.end();
}
