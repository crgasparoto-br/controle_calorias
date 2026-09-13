import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolveRiskProfile } from "../.delivery-v2/risk-profile.mjs";

export const DELIVERY_V2_RISK_PROFILES = Object.freeze(["fast", "standard", "critical"]);
export const DELIVERY_V2_REQUESTED_RISKS = Object.freeze(["auto", ...DELIVERY_V2_RISK_PROFILES]);

const POLICY = JSON.parse(
  readFileSync(new URL("../.delivery-v2/policy.json", import.meta.url), "utf8")
).riskPolicy;

function normalizePath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function isDocsPath(path) {
  return path.startsWith("docs/") || path.endsWith(".md") || [
    "agents.md",
    "contributing.md",
    ".github/pull_request_template.md",
    ".github/branch-protection-main.md"
  ].includes(path);
}

function isCodePath(path) {
  return /\.(?:[cm]?[jt]sx?|css|scss|sass|less)$/.test(path) ||
    /^(?:client|server|shared|scripts|drizzle|patches)\//.test(path) ||
    path.startsWith(".github/workflows/") ||
    ["package.json", "pnpm-lock.yaml"].includes(path);
}

function isDatabasePath(path) {
  return /(^|\/)(drizzle|migrations?|database|db)(\/|\.|$)/.test(path) || path === "drizzle.config.ts";
}

export function classifyDeliveryV2Ci({ requested = "auto", changedPaths = [] } = {}) {
  const risk = resolveRiskProfile({ requested, changedPaths, repositoryPolicy: POLICY });
  const paths = risk.paths.map(normalizePath);
  return {
    requestedRisk: risk.requested,
    riskProfile: risk.profile,
    promoted: risk.promoted,
    reasons: risk.reasons,
    changedPaths: paths,
    docsRequired: paths.some(isDocsPath),
    codeChanged: paths.some(isCodePath),
    databaseRequired: paths.some(isDatabasePath)
  };
}

function parseCliArgs(argv) {
  const result = { requested: process.env.DELIVERY_V2_REQUESTED_RISK || "auto", pathsFile: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--paths-file") result.pathsFile = argv[++index];
    else if (arg === "--requested") result.requested = argv[++index];
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (!result.pathsFile) throw new Error("--paths-file is required");
  return result;
}

function writeGithubOutput(plan) {
  if (!process.env.GITHUB_OUTPUT) return;
  const outputs = {
    risk_profile: plan.riskProfile,
    requested_risk: plan.requestedRisk,
    promoted: plan.promoted,
    docs_required: plan.docsRequired,
    code_changed: plan.codeChanged,
    database_required: plan.databaseRequired,
    changed_paths_json: JSON.stringify(plan.changedPaths),
    reasons_json: JSON.stringify(plan.reasons)
  };
  for (const [key, value] of Object.entries(outputs)) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${String(value)}\n`);
  }
}

function main() {
  const args = parseCliArgs(process.argv.slice(2));
  const changedPaths = JSON.parse(readFileSync(args.pathsFile, "utf8"));
  if (!Array.isArray(changedPaths)) throw new Error("paths file must contain a JSON array");
  const plan = classifyDeliveryV2Ci({ requested: args.requested, changedPaths });
  writeGithubOutput(plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(`Delivery V2 CI classifier failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
