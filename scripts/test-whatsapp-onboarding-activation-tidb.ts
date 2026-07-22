import { readFile } from "node:fs/promises";
import path from "node:path";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the onboarding activation TiDB test.");
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

async function main() {
  const setup = await mysql.createConnection(connectionOptions());
  try {
    await setup.query("DROP TABLE IF EXISTS whatsapp_onboarding_leads");
    await setup.query(await loadMigration("0016_whatsapp_onboarding_leads.sql"));
    await setup.query(
      await loadMigration("0036_whatsapp_onboarding_activation.sql")
    );

    const expiresAt = new Date(Date.now() + 60_000);
    await setup.execute(
      `INSERT INTO whatsapp_onboarding_leads
        (phone_number, display_name, status, token_hash, token_expires_at)
       VALUES (?, ?, 'pending_onboarding', ?, ?)`,
      ["5511999999999", "Teste concorrente", "token-hash-1", expiresAt]
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
      throw new Error(`Expected one activation transition, received ${activated}.`);
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
      throw new Error("The completion claim or converted account was not preserved.");
    }
    if (!row.activation_source || !row.activated_at) {
      throw new Error("Activation source and timestamp were not persisted.");
    }
    if (row.completion_error_code !== null) {
      throw new Error("A successful activation retained a completion error.");
    }

    console.log(
      JSON.stringify({
        completionClaims: claimed,
        activationTransitions: activated,
        finalStatus: row.status,
        activationSource: row.activation_source,
      })
    );
  } finally {
    await first.end();
    await second.end();
  }
}

await main();
