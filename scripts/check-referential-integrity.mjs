import "dotenv/config";
import mysql from "mysql2/promise";

const checks = [
  {
    name: "nutritionGoals sem usuário",
    sql: "SELECT COUNT(*) AS count FROM nutritionGoals g LEFT JOIN users u ON u.id = g.userId WHERE u.id IS NULL",
  },
  {
    name: "meals sem usuário",
    sql: "SELECT COUNT(*) AS count FROM meals m LEFT JOIN users u ON u.id = m.userId WHERE u.id IS NULL",
  },
  {
    name: "mealItems sem refeição",
    sql: "SELECT COUNT(*) AS count FROM mealItems i LEFT JOIN meals m ON m.id = i.mealId WHERE m.id IS NULL",
  },
  {
    name: "mealItems com foodCatalogId inválido",
    sql: "SELECT COUNT(*) AS count FROM mealItems i LEFT JOIN foodCatalog f ON f.id = i.foodCatalogId WHERE i.foodCatalogId IS NOT NULL AND f.id IS NULL",
  },
  {
    name: "mealMedia sem refeição",
    sql: "SELECT COUNT(*) AS count FROM mealMedia mm LEFT JOIN meals m ON m.id = mm.mealId WHERE m.id IS NULL",
  },
  {
    name: "mealInferences sem usuário",
    sql: "SELECT COUNT(*) AS count FROM mealInferences mi LEFT JOIN users u ON u.id = mi.userId WHERE u.id IS NULL",
  },
  {
    name: "mealInferences com mealId inválido",
    sql: "SELECT COUNT(*) AS count FROM mealInferences mi LEFT JOIN meals m ON m.id = mi.mealId WHERE mi.mealId IS NOT NULL AND m.id IS NULL",
  },
  {
    name: "habitMemories sem usuário",
    sql: "SELECT COUNT(*) AS count FROM habitMemories h LEFT JOIN users u ON u.id = h.userId WHERE u.id IS NULL",
  },
  {
    name: "dailySummaries sem usuário",
    sql: "SELECT COUNT(*) AS count FROM dailySummaries d LEFT JOIN users u ON u.id = d.userId WHERE u.id IS NULL",
  },
  {
    name: "exercises sem usuário",
    sql: "SELECT COUNT(*) AS count FROM exercises e LEFT JOIN users u ON u.id = e.userId WHERE u.id IS NULL",
  },
  {
    name: "waterGoals sem usuário",
    sql: "SELECT COUNT(*) AS count FROM waterGoals wg LEFT JOIN users u ON u.id = wg.userId WHERE u.id IS NULL",
  },
  {
    name: "waterLogs sem usuário",
    sql: "SELECT COUNT(*) AS count FROM waterLogs wl LEFT JOIN users u ON u.id = wl.userId WHERE u.id IS NULL",
  },
  {
    name: "whatsappConnections sem usuário",
    sql: "SELECT COUNT(*) AS count FROM whatsappConnections wc LEFT JOIN users u ON u.id = wc.userId WHERE u.id IS NULL",
  },
  {
    name: "appSecrets com updatedByUserId inválido",
    sql: "SELECT COUNT(*) AS count FROM appSecrets s LEFT JOIN users u ON u.id = s.updatedByUserId WHERE s.updatedByUserId IS NOT NULL AND u.id IS NULL",
  },
  {
    name: "inferenceLogs com userId inválido",
    sql: "SELECT COUNT(*) AS count FROM inferenceLogs l LEFT JOIN users u ON u.id = l.userId WHERE l.userId IS NOT NULL AND u.id IS NULL",
  },
];

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.MYSQL_URL ||
  process.env.TIDB_DATABASE_URL ||
  process.env.DB_URL;

if (!databaseUrl) {
  console.error([
    "DATABASE_URL é obrigatório para verificar integridade referencial.",
    "Defina DATABASE_URL no .env da raiz do projeto ou exporte a variável ao rodar o comando.",
    "Também são aceitos aliases: MYSQL_URL, TIDB_DATABASE_URL ou DB_URL.",
  ].join("\n"));
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);
let hasIssues = false;

try {
  for (const check of checks) {
    const [rows] = await connection.query(check.sql);
    const count = Number(rows[0]?.count ?? 0);
    if (count > 0) {
      hasIssues = true;
      console.error(`FAIL ${check.name}: ${count}`);
    } else {
      console.log(`OK   ${check.name}`);
    }
  }
} finally {
  await connection.end();
}

if (hasIssues) {
  process.exitCode = 1;
}
