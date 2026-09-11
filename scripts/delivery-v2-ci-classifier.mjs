import { appendFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DELIVERY_V2_RISK_PROFILES = Object.freeze(["fast", "standard", "critical"]);
export const DELIVERY_V2_REQUESTED_RISKS = Object.freeze(["auto", ...DELIVERY_V2_RISK_PROFILES]);

const RANK = Object.freeze({ fast: 1, standard: 2, critical: 3 });

const CRITICAL_PATTERNS = [
  /^\.github\/(workflows|actions)\//,
  /^(agents\.md|contributing\.md|\.github\/pull_request_template\.md|\.github\/branch-protection-main\.md)$/,
  /^scripts\/delivery-v2-ci-classifier(?:\.test)?\.mjs$/,
  /(^|\/)(drizzle|migrations?|database|db)(\/|\.|$)/,
  /(^|\/)(auth|authentication|authorization|permissions?|security|privacy)(\/|\.|-|_|$)/,
  /whatsapp|webhook|nutrition|nutritional|meal|refeicao|food|billing|subscription|asaas|strava|health/,
  /^server\/_core\/ai\//,
  /openai|gemini|ai-provider|aiprovider/,
  /^shared\//,
  /(^|\/)(package\.json|pnpm-lock\.yaml|vite\.config\.[cm]?[jt]s|vitest\.config\.[cm]?[jt]s|tsconfig(?:\.[^/]+)?\.json)$/,
  /(^|\/)\.env(?:\.|$)/,
  /^patches\//
];

const FAST_PATTERNS = [
  /^client\/src\/(components|pages|styles|assets)\//,
  /^client\/public\//,
  /^docs\//,
  /\.(css|scss|sass|less|svg|png|jpe?g|webp)$/,
  /\.md$/
];

const STANDARD_PATTERNS = [
  /^client\/src\//,
  /^server\//,
  /(^|\/)(test|tests|__tests__)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/
];

function normalizePath(value) {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

function classifyPath(path) {
  if (CRITICAL_PATTERNS.some((pattern) => pattern.test(path))) {
    return { profile: "critical", reason: `critical-path:${path}` };
  }
  if (FAST_PATTERNS.some((pattern) => pattern.test(path))) {
    return { profile: "fast", reason: `fast-path:${path}` };
  }
  if (STANDARD_PATTERNS.some((pattern) => pattern.test(path))) {
    return { profile: "standard", reason: `standard-path:${path}` };
  }
  return { profile: "critical", reason: `unknown-path:${path}` };
}

function resolveRequestedRisk(value) {
  const requested = String(value || "auto").trim().toLowerCase();
  if (!DELIVERY_V2_REQUESTED_RISKS.includes(requested)) {
    throw new Error(`requested risk must be one of: ${DELIVERY_V2_REQUESTED_RISKS.join(", ")}`);
  }
  return requested;
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
  const requestedRisk = resolveRequestedRisk(requested);
  const paths = [...new Set(changedPaths.map(normalizePath).filter(Boolean))];

  if (paths.length === 0) {
    return {
      requestedRisk,
      riskProfile: requestedRisk === "critical" ? "critical" : "standard",
      promoted: requestedRisk === "fast",
      reasons: ["no-changed-paths-fail-closed"],
      changedPaths: [],
      docsRequired: false,
      codeChanged: false,
      databaseRequired: false
    };
  }

  const classified = paths.map(classifyPath);
  const observedRisk = classified.reduce(
    (best, item) => (RANK[item.profile] > RANK[best] ? item.profile : best),
    "fast"
  );
  const effectiveRisk = requestedRisk === "auto" || RANK[observedRisk] > RANK[requestedRisk]
    ? observedRisk
    : requestedRisk;
  const promoted = requestedRisk !== "auto" && RANK[effectiveRisk] > RANK[requestedRisk];

  return {
    requestedRisk,
    riskProfile: effectiveRisk,
    promoted,
    reasons: [
      ...(promoted ? [`promoted:${requestedRisk}->${effectiveRisk}`] : [`requested:${requestedRisk}`]),
      ...classified.filter((item) => item.profile === observedRisk).map((item) => item.reason)
    ],
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
