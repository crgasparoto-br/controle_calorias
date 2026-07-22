import "dotenv/config";
import mysql from "mysql2/promise";

const checks = [
  {
    name: "userProfiles sem usuário",
    sql: "SELECT COUNT(*) AS count FROM userProfiles p LEFT JOIN users u ON u.id = p.userId WHERE u.id IS NULL",
  },
  {
    name: "nutritionGoals sem usuário",
    sql: "SELECT COUNT(*) AS count FROM nutritionGoals g LEFT JOIN users u ON u.id = g.userId WHERE u.id IS NULL",
  },
  {
    name: "metas profissionais sem vínculo ou acompanhamento",
    sql: "SELECT COUNT(*) AS count FROM professionalOfficialGoals g LEFT JOIN professionalPatientAuthorizations a ON a.id = g.authorizationId LEFT JOIN professionalPatientTrackings t ON t.id = g.trackingId WHERE a.id IS NULL OR t.id IS NULL",
  },
  {
    name: "solicitações de revisão sem meta profissional",
    sql: "SELECT COUNT(*) AS count FROM professionalGoalReviewRequests r LEFT JOIN professionalOfficialGoals g ON g.id = r.goalId WHERE g.id IS NULL",
  },
  {
    name: "notificações sem meta profissional",
    sql: "SELECT COUNT(*) AS count FROM professionalGoalNotifications n LEFT JOIN professionalOfficialGoals g ON g.id = n.goalId WHERE g.id IS NULL",
  },
  {
    name: "foodCatalog com brandId inválido",
    sql: "SELECT COUNT(*) AS count FROM foodCatalog f LEFT JOIN foodBrands b ON b.id = f.brandId WHERE f.brandId IS NOT NULL AND b.id IS NULL",
  },
  {
    name: "portions sem alimento",
    sql: "SELECT COUNT(*) AS count FROM portions p LEFT JOIN foodCatalog f ON f.id = p.foodCatalogId WHERE f.id IS NULL",
  },
  {
    name: "recipes sem usuário",
    sql: "SELECT COUNT(*) AS count FROM recipes r LEFT JOIN users u ON u.id = r.userId WHERE u.id IS NULL",
  },
  {
    name: "recipeItems sem receita",
    sql: "SELECT COUNT(*) AS count FROM recipeItems i LEFT JOIN recipes r ON r.id = i.recipeId WHERE r.id IS NULL",
  },
  {
    name: "recipeItems com foodCatalogId inválido",
    sql: "SELECT COUNT(*) AS count FROM recipeItems i LEFT JOIN foodCatalog f ON f.id = i.foodCatalogId WHERE i.foodCatalogId IS NOT NULL AND f.id IS NULL",
  },
  {
    name: "recipeItems com portionId inválido",
    sql: "SELECT COUNT(*) AS count FROM recipeItems i LEFT JOIN portions p ON p.id = i.portionId WHERE i.portionId IS NOT NULL AND p.id IS NULL",
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
    name: "weightEntries sem usuário",
    sql: "SELECT COUNT(*) AS count FROM weightEntries w LEFT JOIN users u ON u.id = w.userId WHERE u.id IS NULL",
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
    name: "userPreferences sem usuário",
    sql: "SELECT COUNT(*) AS count FROM userPreferences p LEFT JOIN users u ON u.id = p.userId WHERE u.id IS NULL",
  },
  {
    name: "userRestrictions sem usuário",
    sql: "SELECT COUNT(*) AS count FROM userRestrictions r LEFT JOIN users u ON u.id = r.userId WHERE u.id IS NULL",
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
  {
    name: "billingSubscriptions sem pagador ou plano",
    sql: "SELECT COUNT(*) AS count FROM billingSubscriptions s LEFT JOIN users u ON u.id = s.payerUserId LEFT JOIN billingPlans p ON p.id = s.planId WHERE u.id IS NULL OR p.id IS NULL",
  },
  {
    name: "billingProviderEvents com assinatura inválida",
    sql: "SELECT COUNT(*) AS count FROM billingProviderEvents e LEFT JOIN billingSubscriptions s ON s.id = e.subscriptionId WHERE e.subscriptionId IS NOT NULL AND s.id IS NULL",
  },
  {
    name: "billingEntitlements com referências inválidas",
    sql: "SELECT COUNT(*) AS count FROM billingEntitlements e LEFT JOIN users b ON b.id = e.beneficiaryUserId LEFT JOIN users sponsor ON sponsor.id = e.sponsorUserId LEFT JOIN billingPlans p ON p.id = e.planId LEFT JOIN professionalPatientAuthorizations a ON a.id = e.professionalAuthorizationId WHERE b.id IS NULL OR (e.sponsorUserId IS NOT NULL AND sponsor.id IS NULL) OR (e.planId IS NOT NULL AND p.id IS NULL) OR (e.professionalAuthorizationId IS NOT NULL AND a.id IS NULL)",
  },
  {
    name: "billingCapacityAllocations com referências inválidas",
    sql: "SELECT COUNT(*) AS count FROM billingCapacityAllocations c LEFT JOIN billingSubscriptions s ON s.id = c.subscriptionId LEFT JOIN users professional ON professional.id = c.professionalUserId LEFT JOIN users patient ON patient.id = c.patientUserId LEFT JOIN professionalPatientAuthorizations a ON a.id = c.authorizationId WHERE s.id IS NULL OR professional.id IS NULL OR patient.id IS NULL OR (c.authorizationId IS NOT NULL AND a.id IS NULL)",
  },
  {
    name: "billingAdminOverrides com referências inválidas",
    sql: "SELECT COUNT(*) AS count FROM billingAdminOverrides o LEFT JOIN users beneficiary ON beneficiary.id = o.userId LEFT JOIN users grantor ON grantor.id = o.grantedByUserId LEFT JOIN users revoker ON revoker.id = o.revokedByUserId WHERE beneficiary.id IS NULL OR (o.grantedByUserId IS NOT NULL AND grantor.id IS NULL) OR (o.revokedByUserId IS NOT NULL AND revoker.id IS NULL)",
  },
  {
    name: "billingAccessAuditEvents com referências inválidas",
    sql: "SELECT COUNT(*) AS count FROM billingAccessAuditEvents e LEFT JOIN users subject ON subject.id = e.subjectUserId LEFT JOIN users actor ON actor.id = e.actorUserId WHERE subject.id IS NULL OR (e.actorUserId IS NOT NULL AND actor.id IS NULL)",
  },
];

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.MYSQL_URL ||
  process.env.TIDB_DATABASE_URL ||
  process.env.DB_URL;

if (!databaseUrl) {
  console.error(
    [
      "DATABASE_URL é obrigatório para verificar integridade referencial.",
      "Defina DATABASE_URL no .env da raiz do projeto ou exporte a variável ao rodar o comando.",
      "Também são aceitos aliases: MYSQL_URL, TIDB_DATABASE_URL ou DB_URL.",
    ].join("\n")
  );
  process.exit(1);
}

function buildConnectionConfig(databaseUrl) {
  const useSsl =
    process.env.TIDB_ENABLE_SSL === "true" ||
    databaseUrl.includes("tidbcloud.com");

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
    ssl: {
      minVersion: "TLSv1.2",
    },
  };
}

const connection = await mysql.createConnection(
  buildConnectionConfig(databaseUrl)
);
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
