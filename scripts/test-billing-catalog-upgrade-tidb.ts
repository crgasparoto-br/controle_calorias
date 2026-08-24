import "dotenv/config";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import mysql, { type Connection, type Pool } from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { BILLING_PERSONAL_ENTITLEMENTS } from "../server/modules/billing/catalogPolicy";
import { createBillingCapacityRepository } from "../server/repositories/billingCapacityRepository";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for the billing catalog upgrade test.");
}

const upgradeDatabase = "controle_calorias_billing_upgrade_test";

function statements(sqlText: string) {
  return sqlText
    .split("--> statement-breakpoint")
    .map(statement => statement.trim())
    .filter(Boolean);
}

function jsonValue(value: unknown) {
  return typeof value === "string" ? JSON.parse(value) : value;
}

async function applySqlFile(connection: Connection, path: string) {
  const sqlText = await readFile(path, "utf8");
  for (const statement of statements(sqlText)) {
    await connection.query(statement);
  }
}

async function main() {
  const adminUrl = new URL(databaseUrl);
  adminUrl.pathname = "/";
  const upgradeUrl = new URL(adminUrl);
  upgradeUrl.pathname = `/${upgradeDatabase}`;

  const admin = await mysql.createConnection({ uri: adminUrl.toString() });
  let connection: Connection | null = null;
  let upgradePool: Pool | null = null;
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${upgradeDatabase}\``);
    await admin.query(`CREATE DATABASE \`${upgradeDatabase}\``);
    connection = await mysql.createConnection({ uri: upgradeUrl.toString() });

    await connection.query(`
      CREATE TABLE users (
        id int NOT NULL,
        CONSTRAINT users_id PRIMARY KEY (id)
      )
    `);
    await connection.query(`
      CREATE TABLE professionalPatientAuthorizations (
        id varchar(64) NOT NULL,
        CONSTRAINT professionalPatientAuthorizations_id PRIMARY KEY (id)
      )
    `);
    await applySqlFile(connection, "drizzle/0038_billing_foundation.sql");

    await connection.query(
      "INSERT INTO users (id) VALUES (9901), (9902), (9903)"
    );
    const legacyEntitlements = JSON.stringify([
      "system_access",
      "professional_portfolio",
    ]);
    await connection.query(
      `INSERT INTO billingPlans (
        id, code, audience, name, description, currency, unitAmount,
        billingCycle, capacityLimit, entitlementsJson, active, createdAt, updatedAt
      ) VALUES (?, ?, 'professional', ?, ?, 'BRL', 12300, 'monthly', 7, ?, true,
        '2026-07-24 12:00:00', '2026-07-25 12:00:00')`,
      [
        "legacy-plan-preserve",
        "legacy-professional",
        "Legacy Professional",
        "Plano existente antes da #891",
        legacyEntitlements,
      ]
    );
    await connection.query(
      `INSERT INTO billingSubscriptions (
        id, provider, payerUserId, planId, status, activeHolderPlanKey,
        currentPeriodStart, currentPeriodEnd, createdAt, updatedAt
      ) VALUES (?, 'integration-test', 9901, ?, 'active', ?,
        DATE_SUB(NOW(), INTERVAL 1 DAY), DATE_ADD(NOW(), INTERVAL 1 DAY),
        '2026-07-24 12:00:00', '2026-07-24 12:00:00')`,
      [
        "legacy-subscription-preserve",
        "legacy-plan-preserve",
        "9901:legacy-plan-preserve",
      ]
    );
    await connection.query(
      `INSERT INTO billingEntitlements (
        id, beneficiaryUserId, sourceType, sourceId, planId, state,
        activeGrantKey, entitlementsJson, validFrom, createdAt, updatedAt
      ) VALUES (?, 9902, 'subscription', ?, ?, 'active', ?, ?,
        '2026-07-24 12:00:00', '2026-07-24 12:00:00', '2026-07-24 12:00:00')`,
      [
        "legacy-entitlement-preserve",
        "legacy-subscription-preserve",
        "legacy-plan-preserve",
        "legacy-entitlement-active",
        legacyEntitlements,
      ]
    );

    await applySqlFile(connection, "drizzle/0041_billing_catalog_versioning.sql");

    const [planRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT p.id, p.code, p.productId, p.versionCode, p.version, p.status, p.active,
        p.coveredBeneficiaryEntitlementsJson, p.commercialPaymentMethodsJson,
        p.effectiveFrom, product.code AS productCode, product.state AS productState
      FROM billingPlans p
      INNER JOIN billingProducts product ON product.id = p.productId
      WHERE p.id = ?`,
      ["legacy-plan-preserve"]
    );
    const legacyPlan = planRows[0];
    assert.ok(legacyPlan, "legacy billing plan must survive the catalog migration");
    assert.equal(legacyPlan.id, "legacy-plan-preserve");
    assert.equal(legacyPlan.code, "legacy-professional");
    assert.equal(legacyPlan.productCode, "legacy-professional");
    assert.equal(legacyPlan.productState, "active");
    assert.match(String(legacyPlan.productId), /^legacy-[A-Fa-f0-9]{57}$/);
    assert.match(String(legacyPlan.versionCode), /^legacy-[A-Fa-f0-9]{57}$/);
    assert.equal(Number(legacyPlan.version), 0);
    assert.equal(legacyPlan.status, "inactive");
    assert.equal(Boolean(legacyPlan.active), false);
    assert.deepEqual(
      jsonValue(legacyPlan.coveredBeneficiaryEntitlementsJson),
      [...BILLING_PERSONAL_ENTITLEMENTS],
      "legacy professional coverage must be backfilled with the canonical personal matrix"
    );
    assert.equal(
      jsonValue(legacyPlan.coveredBeneficiaryEntitlementsJson).includes(
        "professional_portfolio"
      ),
      false,
      "legacy covered-patient entitlements must never include professional resources"
    );
    assert.deepEqual(
      jsonValue(legacyPlan.commercialPaymentMethodsJson),
      [],
      "legacy versions must not become newly purchasable through inferred payment methods"
    );
    assert.ok(legacyPlan.effectiveFrom, "legacy version must receive an effective start");

    const [subscriptionRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT planId FROM billingSubscriptions WHERE id = ?",
      ["legacy-subscription-preserve"]
    );
    assert.equal(
      subscriptionRows[0]?.planId,
      "legacy-plan-preserve",
      "subscription must keep the original planId after #891 upgrade"
    );
    const [entitlementRows] = await connection.query<mysql.RowDataPacket[]>(
      "SELECT planId FROM billingEntitlements WHERE id = ?",
      ["legacy-entitlement-preserve"]
    );
    assert.equal(
      entitlementRows[0]?.planId,
      "legacy-plan-preserve",
      "existing entitlement must keep the original planId after #891 upgrade"
    );

    const legacyAuthorizationId = "legacy-covered-patient-authorization";
    const legacyCoverageKey = `professional-authorization:${legacyAuthorizationId}`;
    await connection.query(
      "INSERT INTO professionalPatientAuthorizations (id) VALUES (?)",
      [legacyAuthorizationId]
    );
    upgradePool = mysql.createPool({
      uri: upgradeUrl.toString(),
      connectionLimit: 2,
    });
    const upgradeDb = drizzle(upgradePool);
    const capacityRepository = createBillingCapacityRepository({
      getDb: async () => upgradeDb,
      onWarning: (scope, error) => {
        throw new Error(
          `unexpected ${scope} warning during legacy coverage test: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      },
    });
    const reservation = await capacityRepository.reserveProfessionalCapacity({
      professionalUserId: 9901,
      patientUserId: 9903,
      coverageKey: legacyCoverageKey,
    });
    assert.equal(
      reservation.reserved,
      true,
      "an active legacy professional subscription must still reserve patient capacity after upgrade"
    );

    const [coveredRows] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT planId, entitlementsJson
       FROM billingEntitlements
       WHERE beneficiaryUserId = 9903
         AND sourceType = 'professional_coverage'
         AND sourceId = ?
         AND state = 'active'`,
      [legacyCoverageKey]
    );
    assert.equal(coveredRows.length, 1);
    assert.equal(
      coveredRows[0]?.planId,
      "legacy-plan-preserve",
      "new covered-patient entitlements must remain linked to the contracted legacy version"
    );
    assert.deepEqual(
      jsonValue(coveredRows[0]?.entitlementsJson),
      [...BILLING_PERSONAL_ENTITLEMENTS],
      "a patient added after migration must receive only the canonical personal matrix"
    );
    assert.equal(
      jsonValue(coveredRows[0]?.entitlementsJson).includes(
        "professional_portfolio"
      ),
      false,
      "a migrated legacy subscription must not leak professional entitlements to a covered patient"
    );

    const [columns] = await connection.query<mysql.RowDataPacket[]>(
      `SELECT COLUMN_NAME, IS_NULLABLE
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'billingPlans'
         AND COLUMN_NAME IN (
           'productId', 'versionCode', 'version',
           'coveredBeneficiaryEntitlementsJson',
           'commercialPaymentMethodsJson', 'effectiveFrom'
         )`,
      [upgradeDatabase]
    );
    assert.equal(columns.length, 6);
    assert.equal(
      columns.every(column => column.IS_NULLABLE === "NO"),
      true,
      "backfilled catalog columns must be NOT NULL after the migration completes"
    );

    console.log(
      JSON.stringify({
        event: "billing.catalog.legacy-upgrade.passed",
        legacyPlanId: legacyPlan.id,
        productId: legacyPlan.productId,
        versionCode: legacyPlan.versionCode,
        version: Number(legacyPlan.version),
        subscriptionPlanId: subscriptionRows[0]?.planId,
      })
    );
  } finally {
    await upgradePool?.end();
    await connection?.end();
    await admin.query(`DROP DATABASE IF EXISTS \`${upgradeDatabase}\``);
    await admin.end();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
