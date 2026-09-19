import fs from "node:fs";
import path from "node:path";
import mysql from "mysql2/promise";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizePhone(value) {
  return value.replace(/\D/g, "");
}

function safeInteger(value) {
  return Number(value ?? 0);
}

const databaseUrl = required("DATABASE_URL");
const suppliedPhone = normalizePhone(required("ISSUE_1097_TEST_PHONE"));
if (!suppliedPhone) throw new Error("ISSUE_1097_TEST_PHONE has no digits");

const variants = new Set([suppliedPhone]);
if (suppliedPhone.startsWith("55") && suppliedPhone.length > 11) {
  variants.add(suppliedPhone.slice(2));
}
if (!suppliedPhone.startsWith("55") && suppliedPhone.length >= 10) {
  variants.add(`55${suppliedPhone}`);
}

const connection = await mysql.createConnection(databaseUrl);
try {
  const [rows] = await connection.execute(
    `SELECT status, COUNT(*) AS count
       FROM whatsappConnections
      WHERE phoneNumber IN (${[...variants].map(() => "?").join(", ")})
      GROUP BY status`,
    [...variants]
  );

  const statusCounts = Object.fromEntries(
    rows.map(row => [String(row.status ?? "null"), safeInteger(row.count)])
  );
  const anyCount = Object.values(statusCounts).reduce(
    (sum, value) => sum + value,
    0
  );
  const activeCount = statusCounts.active ?? 0;
  const report = {
    schemaVersion: 1,
    normalizedInputLength: suppliedPhone.length,
    hasBrazilCountryPrefix: suppliedPhone.startsWith("55"),
    variantCountChecked: variants.size,
    statusCounts,
    exactAnyVariantCount: anyCount,
    exactActiveVariantCount: activeCount,
    diagnosis:
      activeCount > 0
        ? "active_match"
        : anyCount > 0
          ? "match_without_active_status"
          : "no_variant_match",
  };

  const outputPath = process.env.ISSUE_1097_PHONE_DIAGNOSTIC_PATH;
  if (outputPath) {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(JSON.stringify(report));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      [
        "## Issue 1097 phone authorization diagnostic",
        "",
        `- Normalized input length: \`${report.normalizedInputLength}\``,
        `- Brazil country prefix present: \`${report.hasBrazilCountryPrefix}\``,
        `- Variants checked: \`${report.variantCountChecked}\``,
        `- Exact variant rows: \`${report.exactAnyVariantCount}\``,
        `- Exact active rows: \`${report.exactActiveVariantCount}\``,
        `- Diagnosis: \`${report.diagnosis}\``,
        "",
      ].join("\n")
    );
  }
} finally {
  await connection.end();
}
