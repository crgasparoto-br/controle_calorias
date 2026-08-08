import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required for the onboarding activation TiDB test."
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

async function loadMigration(fileName: string) {
  return readFile(path.join(process.cwd(), "drizzle", fileName), "utf8");
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

async function main() {
  const setup = await mysql.createConnection(connectionOptions());
  try {
    await setup.query("DROP TABLE IF EXISTS whatsappConnections");
    await setup.query("DROP TABLE IF EXISTS whatsapp_onboarding_leads");
    await setup.query(await loadMigration("0016_whatsapp_onboarding_leads.sql"));
    await setup.query(
      await loadMigration("0039_whatsapp_onboarding_activation.sql")
    );
    await setup.query(`
      CREATE TABLE whatsappConnections (
        id int AUTO_INCREMENT NOT NULL,
        userId int NOT NULL,
        phoneNumber varchar(32) NOT NULL,
        activePhoneKey varchar(32)
          GENERATED ALWAYS AS (
            CASE WHEN status = 'active' THEN phoneNumber ELSE NULL END
          ) STORED,
        displayName varchar(255),
        status enum('pending','active','disabled') NOT NULL DEFAULT 'pending',
        createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT whatsappConnections_id PRIMARY KEY(id),
        CONSTRAINT whatsappConnections_activePhoneKey_unique_idx UNIQUE(activePhoneKey)
      );
      CREATE INDEX whatsappConnections_userId_idx
        ON whatsappConnections (userId);
      CREATE INDEX whatsappConnections_phoneNumber_idx
        ON whatsappConnections (phoneNumber);
    `);

    const expiresAt = new Date(Date.now() + 60_000);
    await setup.execute(
      `INSERT INTO whatsapp_onboarding_leads
        (phone_number, display_name, status, token_hash, token_expires_at)
       VALUES
        (?, ?, 'pending_onboarding', ?, ?),
        (?, ?, 'pending_onboarding', ?, ?),
        (?, ?, 'pending_onboarding', ?, ?)`,
      [
        "5511999999999",
        "Teste concorrente",
        "token-hash-1",
        expiresAt,
        "5511999999998",
        "Teste recuperável",
        "token-hash-2",
        expiresAt,
        "5511999999997",
        "Conta existente",
        "token-hash-3",
        expiresAt,
      ]
    );
  } finally {
    await setup.end();
  }

  const first = await mysql.createConnection(connectionOptions());
  const second = await mysql.createConnection(connectionOptions());
  try {
    const now = new Date();
    const claimSql = `UPDATE whatsapp_onboarding_leads
      SET status = 'converting', token_used_at = ?, updated_at = ?
      WHERE token_hash = ?
        AND status IN ('lead_whatsapp', 'pending_onboarding')
        AND token_used_at IS NULL
        AND token_expires_at > ?`;

    const [firstClaim, secondClaim] = await Promise.all([
      first.execute<mysql.ResultSetHeader>(claimSql, [
        now,
        now,
        "token-hash-1",
        now,
      ]),
      second.execute<mysql.ResultSetHeader>(claimSql, [
        now,
        now,
        "token-hash-1",
        now,
      ]),
    ]);

    const claimed = firstClaim[0].affectedRows + secondClaim[0].affectedRows;
    if (claimed !== 1) {
      throw new Error(`Expected one completion claim, received ${claimed}.`);
    }

    await first.execute(
      `UPDATE whatsapp_onboarding_leads
       SET converted_user_id = 123, converted_at = ?, status = 'pending_activation'
       WHERE token_hash = ? AND status = 'converting'`,
      [now, "token-hash-1"]
    );

    const activationSql = `UPDATE whatsapp_onboarding_leads
      SET status = 'active', activation_source = ?, activated_at = COALESCE(activated_at, ?), updated_at = ?
      WHERE token_hash = ?
        AND converted_user_id = 123
        AND status = 'pending_activation'`;
    const activatedAt = new Date();
    const [firstActivation, secondActivation] = await Promise.all([
      first.execute<mysql.ResultSetHeader>(activationSql, [
        "admin_override",
        activatedAt,
        activatedAt,
        "token-hash-1",
      ]),
      second.execute<mysql.ResultSetHeader>(activationSql, [
        "active_subscription",
        activatedAt,
        activatedAt,
        "token-hash-1",
      ]),
    ]);

    const activated =
      firstActivation[0].affectedRows + secondActivation[0].affectedRows;
    if (activated !== 1) {
      throw new Error(
        `Expected one activation transition, received ${activated}.`
      );
    }

    const [rows] = await first.query<mysql.RowDataPacket[]>(
      `SELECT status, converted_user_id, activation_source, activated_at,
              completion_error_code, token_used_at
       FROM whatsapp_onboarding_leads
       WHERE token_hash = 'token-hash-1'`
    );
    const row = rows[0];
    if (!row || row.status !== "active") {
      throw new Error("The lead was not persisted as active.");
    }
    if (Number(row.converted_user_id) !== 123 || !row.token_used_at) {
      throw new Error(
        "The completion claim or converted account was not preserved."
      );
    }
    if (!row.activation_source || !row.activated_at) {
      throw new Error("Activation source and timestamp were not persisted.");
    }
    if (row.completion_error_code !== null) {
      throw new Error("A successful activation retained a completion error.");
    }

    const recoveryClaim = await first.execute<mysql.ResultSetHeader>(claimSql, [
      now,
      now,
      "token-hash-2",
      now,
    ]);
    if (recoveryClaim[0].affectedRows !== 1) {
      throw new Error("The recoverable lead was not claimed.");
    }

    const recoveryAt = new Date();
    await first.execute(
      `UPDATE whatsapp_onboarding_leads
       SET status = 'converting',
           converted_user_id = COALESCE(converted_user_id, 456),
           converted_at = COALESCE(converted_at, ?),
           completion_error_code = 'PROFILE_WRITE_FAILED',
           updated_at = ?
       WHERE token_hash = 'token-hash-2'`,
      [recoveryAt, recoveryAt]
    );

    const [recoveryRows] = await second.query<mysql.RowDataPacket[]>(
      `SELECT status, converted_user_id, converted_at, completion_error_code,
              token_used_at
       FROM whatsapp_onboarding_leads
       WHERE token_hash = 'token-hash-2'`
    );
    const recoveryRow = recoveryRows[0];
    if (
      !recoveryRow ||
      recoveryRow.status !== "converting" ||
      Number(recoveryRow.converted_user_id) !== 456 ||
      !recoveryRow.converted_at ||
      !recoveryRow.token_used_at ||
      recoveryRow.completion_error_code !== "PROFILE_WRITE_FAILED"
    ) {
      throw new Error(
        "A post-account failure did not preserve the converted user for recovery."
      );
    }

    const resumed = await second.execute<mysql.ResultSetHeader>(
      `UPDATE whatsapp_onboarding_leads
       SET status = 'pending_activation', completion_error_code = NULL, updated_at = ?
       WHERE token_hash = 'token-hash-2'
         AND status = 'converting'
         AND converted_user_id = 456`,
      [new Date()]
    );
    if (resumed[0].affectedRows !== 1) {
      throw new Error("The interrupted completion could not be resumed.");
    }

    await first.beginTransaction();
    const [linkRows] = await first.query<mysql.RowDataPacket[]>(
      `SELECT id, phone_number, display_name, status, token_used_at,
              token_expires_at, converted_user_id, converted_at
       FROM whatsapp_onboarding_leads
       WHERE token_hash = 'token-hash-3'
       LIMIT 1
       FOR UPDATE`
    );
    const linkLead = linkRows[0];
    if (!linkLead || linkLead.status !== "pending_onboarding") {
      throw new Error("The existing-account lead was not available for linking.");
    }

    const linkedAt = new Date();
    await first.execute(
      `UPDATE whatsapp_onboarding_leads
       SET status = 'converting', token_used_at = ?, converted_user_id = 501,
           converted_at = ?, completion_error_code = NULL, updated_at = ?
       WHERE id = ? AND status = 'pending_onboarding'
         AND token_used_at IS NULL`,
      [linkedAt, linkedAt, linkedAt, linkLead.id]
    );
    await first.execute(
      `INSERT INTO whatsappConnections
        (userId, phoneNumber, displayName, status, createdAt, updatedAt)
       VALUES (501, ?, ?, 'active', ?, ?)`,
      [linkLead.phone_number, linkLead.display_name, linkedAt, linkedAt]
    );

    await second.beginTransaction();
    const competingRead = second.query<mysql.RowDataPacket[]>(
      `SELECT status, converted_user_id, token_used_at
       FROM whatsapp_onboarding_leads
       WHERE token_hash = 'token-hash-3'
       LIMIT 1
       FOR UPDATE`
    );

    await first.commit();
    const [competingRows] = await competingRead;
    const competingLead = competingRows[0];
    if (
      !competingLead ||
      Number(competingLead.converted_user_id) !== 501 ||
      !competingLead.token_used_at
    ) {
      throw new Error(
        "The competing account did not observe the authoritative linked user."
      );
    }
    const competingUserRejected = Number(competingLead.converted_user_id) !== 502;
    if (!competingUserRejected) {
      throw new Error("A second account could consume the same WhatsApp token.");
    }
    await second.rollback();

    let duplicateActivePhoneRejected = false;
    try {
      await second.execute(
        `INSERT INTO whatsappConnections
          (userId, phoneNumber, displayName, status, createdAt, updatedAt)
         VALUES (502, ?, 'Conta concorrente', 'active', ?, ?)`,
        [linkLead.phone_number, linkedAt, linkedAt]
      );
    } catch (error) {
      duplicateActivePhoneRejected = isDuplicateEntryError(error);
    }
    if (!duplicateActivePhoneRejected) {
      throw new Error(
        "The database allowed the same active phone to belong to two accounts."
      );
    }

    await second.execute(
      `INSERT INTO whatsappConnections
        (userId, phoneNumber, displayName, status, createdAt, updatedAt)
       VALUES (502, ?, 'Histórico desativado', 'disabled', ?, ?)`,
      [linkLead.phone_number, linkedAt, linkedAt]
    );

    const [linkedRows] = await first.query<mysql.RowDataPacket[]>(
      `SELECT l.status, l.converted_user_id, l.token_used_at,
              c.userId, c.phoneNumber, c.status AS connection_status,
              c.activePhoneKey
       FROM whatsapp_onboarding_leads l
       INNER JOIN whatsappConnections c
         ON c.phoneNumber = l.phone_number AND c.status = 'active'
       WHERE l.token_hash = 'token-hash-3'`
    );
    const linked = linkedRows[0];
    if (
      !linked ||
      linked.status !== "converting" ||
      Number(linked.converted_user_id) !== 501 ||
      Number(linked.userId) !== 501 ||
      linked.connection_status !== "active" ||
      linked.activePhoneKey !== linked.phoneNumber
    ) {
      throw new Error(
        "The authenticated account link was not persisted atomically."
      );
    }

    console.log(
      JSON.stringify({
        completionClaims: claimed,
        activationTransitions: activated,
        finalStatus: row.status,
        activationSource: row.activation_source,
        recoveredUserId: Number(recoveryRow.converted_user_id),
        resumedTransitions: resumed[0].affectedRows,
        linkedExistingUserId: Number(linked.converted_user_id),
        competingUserRejected,
        duplicateActivePhoneRejected,
      })
    );
  } finally {
    await first.end();
    await second.end();
  }
}

await main();
