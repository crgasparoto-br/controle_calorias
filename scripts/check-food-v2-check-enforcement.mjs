import mysql from "mysql2/promise";

export function verifyTiDbCheckEnforcement(rows) {
  const item = rows.find(row => String(row.Variable_name ?? "").toLowerCase() === "tidb_enable_check_constraint");
  if (!item) throw new Error("TiDB CHECK setting unavailable: cannot certify CHECK enforcement.");
  if (String(item.Value).toUpperCase() !== "ON") {
    throw new Error("TiDB CHECK enforcement is OFF: request an explicit administrative change before applying Food V2.");
  }
  return true;
}

async function main() {
  const uri = process.env.DATABASE_URL;
  if (!uri) throw new Error("DATABASE_URL is required; this validation never changes cluster settings.");
  const connection = await mysql.createConnection({ uri, multipleStatements: false });
  try {
    const [rows] = await connection.query("SHOW GLOBAL VARIABLES LIKE 'tidb_enable_check_constraint'");
    verifyTiDbCheckEnforcement(rows);
    console.log("Food V2 destination preflight: TiDB CHECK enforcement ON (read-only).");
  } finally {
    await connection.end();
  }
}

if (process.argv[1]?.endsWith("check-food-v2-check-enforcement.mjs")) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
