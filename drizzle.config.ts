import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";
import { defineConfig } from "drizzle-kit";

const lifecycleSnapshotPath = new URL(
  "./drizzle/meta/0042_snapshot.json",
  import.meta.url
);
const lifecycleSnapshotParts = [
  new URL("./drizzle/snapshot-parts/0042_snapshot.json.br.part0", import.meta.url),
  new URL("./drizzle/snapshot-parts/0042_snapshot.json.br.part1", import.meta.url),
];
const lifecycleSnapshotSha256 =
  "c2a3207fad81650839999961fcd285840e0a610b4e91893b8c214e8805f5ec2b";
let materializedLifecycleSnapshot = false;

const usageGovernanceSnapshotPath = new URL(
  "./drizzle/meta/0048_snapshot.json",
  import.meta.url
);
const usageGovernanceSnapshotParts = [
  new URL("./drizzle/snapshot-parts/0048_snapshot.json.br.part0", import.meta.url),
  new URL("./drizzle/snapshot-parts/0048_snapshot.json.br.part1", import.meta.url),
  new URL("./drizzle/snapshot-parts/0048_snapshot.json.br.part2", import.meta.url),
  new URL("./drizzle/snapshot-parts/0048_snapshot.json.br.part3", import.meta.url),
];
const usageGovernanceSnapshotSha256 =
  "14e69eeffaa4d1ee162db9a06a32a0a1cda526c8e5c54bd583f60275b434dd78";
let materializedUsageGovernanceSnapshot = false;

function materializeLifecycleSnapshot() {
  if (existsSync(lifecycleSnapshotPath)) return;

  const compressed = Buffer.concat(
    lifecycleSnapshotParts.map(part => readFileSync(part))
  );
  const snapshot = brotliDecompressSync(compressed);
  const digest = createHash("sha256").update(snapshot).digest("hex");

  if (digest !== lifecycleSnapshotSha256) {
    throw new Error("Drizzle lifecycle snapshot checksum mismatch");
  }

  writeFileSync(lifecycleSnapshotPath, snapshot);
  materializedLifecycleSnapshot = true;
}

function materializeUsageGovernanceSnapshot() {
  if (existsSync(usageGovernanceSnapshotPath)) return;

  const compressed = Buffer.concat(
    usageGovernanceSnapshotParts.map(part => readFileSync(part))
  );
  const snapshot = brotliDecompressSync(compressed);
  const digest = createHash("sha256").update(snapshot).digest("hex");

  if (digest !== usageGovernanceSnapshotSha256) {
    throw new Error("Drizzle usage governance snapshot checksum mismatch");
  }

  writeFileSync(usageGovernanceSnapshotPath, snapshot);
  materializedUsageGovernanceSnapshot = true;
}

function cleanupLifecycleSnapshot() {
  if (!materializedLifecycleSnapshot) return;

  try {
    unlinkSync(lifecycleSnapshotPath);
  } catch {
    // Best-effort cleanup only. A later invocation will verify the checksum again.
  }
}

function cleanupUsageGovernanceSnapshot() {
  if (!materializedUsageGovernanceSnapshot) return;

  try {
    unlinkSync(usageGovernanceSnapshotPath);
  } catch {
    // Best-effort cleanup only. A later invocation will verify the checksum again.
  }
}

function validateDrizzleMetadata() {
  const metadataDirectory = new URL("./drizzle/meta/", import.meta.url);
  for (const name of readdirSync(metadataDirectory)) {
    if (!name.endsWith(".json")) {
      throw new Error(`Unexpected non-JSON file in drizzle/meta: ${name}`);
    }
    JSON.parse(readFileSync(new URL(name, metadataDirectory), "utf8"));
  }
}

materializeLifecycleSnapshot();
materializeUsageGovernanceSnapshot();
validateDrizzleMetadata();
process.once("exit", () => {
  cleanupUsageGovernanceSnapshot();
  cleanupLifecycleSnapshot();
});

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL is required to run drizzle commands");
}

const useSsl = process.env.TIDB_ENABLE_SSL === "true";

function buildDbCredentials() {
  if (!useSsl) {
    return {
      url: connectionString,
    };
  }

  const url = new URL(connectionString);

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

export default defineConfig({
  schema: [
    "./drizzle/schema.ts",
    "./drizzle/food-signals-schema.ts",
    "./drizzle/professional-schema.ts",
    "./drizzle/billing-schema.ts",
    "./drizzle/billing-subscription-lifecycle-schema.ts",
    "./drizzle/usage-governance-schema.ts",
  ],
  out: "./drizzle",
  dialect: "mysql",
  dbCredentials: buildDbCredentials(),
});
