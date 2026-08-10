import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SNAPSHOT = path.join(ROOT, "docs/benchmarks/multi-provider/pricing-snapshot.json");
const EXPECTED_RUNTIME_CATALOG_PATH = "server/_core/ai/pricingCatalog.ts";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractExportedString(source, name) {
  const match = source.match(new RegExp(`export const ${name} = "([^"]+)";`, "u"));
  assert(match?.[1], `runtime pricing catalog does not export ${name}`);
  return match[1];
}

export async function verifyIssue927PricingProvenance(
  snapshotPath = DEFAULT_SNAPSHOT,
  options = {},
) {
  const snapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  const runtimeCatalogPath = options.runtimeCatalogPath
    ?? path.join(ROOT, EXPECTED_RUNTIME_CATALOG_PATH);
  const runtimeCatalogBytes = options.runtimeCatalogBytes
    ?? await readFile(runtimeCatalogPath);
  const runtimeCatalogSource = runtimeCatalogBytes.toString("utf8");
  const runtimeVersion = extractExportedString(runtimeCatalogSource, "AI_PRICING_CATALOG_VERSION");
  const runtimeEffectiveDate = extractExportedString(
    runtimeCatalogSource,
    "AI_PRICING_CATALOG_EFFECTIVE_DATE",
  );

  assert.equal(snapshot.schemaVersion, 2, "unsupported issue-927 pricing provenance schema");
  assert.equal(snapshot.estimatedNotBilling, true, "pricing evidence must be marked as estimate-only");
  assert.equal(
    snapshot.runtimeCatalogPath,
    EXPECTED_RUNTIME_CATALOG_PATH,
    "pricing snapshot points to a non-canonical runtime catalog",
  );
  assert.equal(snapshot.version, runtimeVersion, "pricing snapshot version differs from runtime catalog");
  assert.equal(
    snapshot.effectiveDate,
    runtimeEffectiveDate,
    "pricing snapshot effective date differs from runtime catalog",
  );
  assert.match(snapshot.runtimeCatalogSha256 ?? "", /^[0-9a-f]{64}$/u);
  assert.equal(
    snapshot.runtimeCatalogSha256,
    sha256(runtimeCatalogBytes),
    "pricing snapshot is stale for the runtime catalog bytes",
  );

  return {
    schemaVersion: snapshot.schemaVersion,
    version: runtimeVersion,
    effectiveDate: runtimeEffectiveDate,
    runtimeCatalogPath: EXPECTED_RUNTIME_CATALOG_PATH,
    runtimeCatalogSha256: snapshot.runtimeCatalogSha256,
    estimatedNotBilling: true,
  };
}

async function runNegativeControls() {
  const baseline = JSON.parse(await readFile(DEFAULT_SNAPSHOT, "utf8"));
  const directory = await mkdtemp(path.join(os.tmpdir(), "issue-927-pricing-"));
  try {
    const staleHashPath = path.join(directory, "stale-hash.json");
    await writeFile(
      staleHashPath,
      `${JSON.stringify({ ...baseline, runtimeCatalogSha256: "0".repeat(64) }, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      verifyIssue927PricingProvenance(staleHashPath),
      /stale for the runtime catalog bytes/u,
    );

    const staleVersionPath = path.join(directory, "stale-version.json");
    await writeFile(
      staleVersionPath,
      `${JSON.stringify({ ...baseline, version: `${baseline.version}-drift` }, null, 2)}\n`,
      "utf8",
    );
    await assert.rejects(
      verifyIssue927PricingProvenance(staleVersionPath),
      /version differs from runtime catalog/u,
    );

    const runtimeBytes = await readFile(path.join(ROOT, EXPECTED_RUNTIME_CATALOG_PATH));
    await assert.rejects(
      verifyIssue927PricingProvenance(DEFAULT_SNAPSHOT, {
        runtimeCatalogBytes: Buffer.concat([runtimeBytes, Buffer.from("\n// synthetic tariff drift\n")]),
      }),
      /stale for the runtime catalog bytes/u,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function main() {
  const evidence = await verifyIssue927PricingProvenance();
  if (process.argv.includes("--self-test")) await runNegativeControls();
  process.stdout.write(`issue-927 pricing provenance verified ${JSON.stringify(evidence)}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
