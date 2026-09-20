import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const root = process.cwd();
const BASELINE_SHA = "521b645182f3811bf904cb28aafb152b990ed184";
const HISTORICAL_BASELINE_SHA = "4d86cb814ff57164ff16cd7626ea21be46719fce";
const PHASE_COMMITS = {
  issue1094: "8b2540f3",
  issue1095: "66a611a2",
  issue1096: "165695b7",
} as const;

const baselineTotals = {
  processMealInput: 7,
  nutritionSearchAttempts: 12,
  nutritionSearchOutbound: 9,
  roundTrips: 29,
  persistedMeals: 12,
  persistedItems: 16,
  pendingClaimed: 2,
  pendingConsumed: 2,
  domainLinks: 12,
} as const;

type StepResult = {
  name: string;
  command: string;
  exitCode: number;
  durationMs: number;
};

type GoldenEvidence = {
  schemaVersion: number;
  issue: number;
  entrypoint: "POST /api/whatsapp/webhook";
  baselineDevelopSha: string;
  metricsBaselineDevelopSha: string;
  characterizationDevelopSha: string;
  f0_07Revalidation: {
    status: "revalidated";
    baselineSha: string;
    affectedPaths: string[];
  };
  scenarios: Array<{
    scenarioId: string;
    result: "ready" | "clarification" | "registered";
    metrics: {
      processMealInput: number;
      nutritionSearchAttempts: number;
      nutritionSearchOutbound: number;
      roundTrips: number;
      roundTripFailures: number;
      fullSemanticRoundTrips: number;
      fullSemanticRoundTripFailures: number;
      monotonicViolations: number;
      pendingReplyOrderViolations: number;
      persistedMeals: number;
      persistedItems: number;
      pendingClaimed: number;
      pendingConsumed: number;
      domainLinks: number;
      nutritionSearchByItem: Record<
        string,
        { attempts: number; outbound: number }
      >;
    };
  }>;
};

const requiredMetricKeys = [
  "roundTripFailures",
  "fullSemanticRoundTrips",
  "fullSemanticRoundTripFailures",
  "monotonicChecks",
  "monotonicViolations",
  "pendingReplyOrderChecks",
  "pendingReplyOrderViolations",
  "processMealInput",
  "mealProcessingResults",
  "nutritionSearchAttempts",
  "nutritionSearchOutbound",
  "webNutritionCacheLookups",
  "roundTrips",
  "semanticContracts",
  "drafts",
  "persistedMeals",
  "persistedItems",
  "pendingCreated",
  "pendingClaimed",
  "pendingConsumed",
  "domainLinks",
] as const;

const requiredScenarioResults: Record<
  string,
  GoldenEvidence["scenarios"][number]["result"]
> = {
  "01-panco-premium": "registered",
  "02-wickbold-equivalente": "registered",
  "03-commercial-non-bread": "registered",
  "04-generic-canonical-portion": "registered",
  "05-explicit-mass": "registered",
  "06-variant-incompatible": "clarification",
  "07-grounding-insufficient": "clarification",
  "08-search-failure": "clarification",
  "08-search-unavailable": "clarification",
  "09-empty-cache": "registered",
  "10-incompatible-cache": "registered",
  "11-multi-item-atomic": "registered",
  "12-clarification-resume": "registered",
  "13-audio-convergent": "registered",
  "14-image-convergent": "registered",
  "15-durable-restart-resume": "registered",
};

function currentSha() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function containsCommit(commit: string) {
  const result = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", commit, "HEAD"],
    {
      cwd: root,
      stdio: "ignore",
    }
  );
  return result.status === 0;
}

function workingTreeIsClean() {
  const result = spawnSync(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    { cwd: root, encoding: "utf8" }
  );
  return result.status === 0 && result.stdout.trim() === "";
}

function runStep(
  name: string,
  args: string[],
  envOverrides: Record<string, string | undefined> = {}
): StepResult & { output: string } {
  const startedAt = Date.now();
  const result = spawnSync("pnpm", args, {
    cwd: root,
    env: {
      ...process.env,
      ...envOverrides,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    name,
    command: ["pnpm", ...args].join(" "),
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    output: `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length &&
    actual.every((key, index) => key === keys.sort()[index])
  );
}

function isSha(value: unknown) {
  return typeof value === "string" && /^[0-9a-f]{40}$/iu.test(value);
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidGoldenEvidence(value: unknown): value is GoldenEvidence {
  if (!isRecord(value)) return false;
  if (
    !hasExactKeys(value, [
      "schemaVersion",
      "issue",
      "entrypoint",
      "baselineDevelopSha",
      "metricsBaselineDevelopSha",
      "characterizationDevelopSha",
      "f0_07Revalidation",
      "scenarios",
    ]) ||
    value.schemaVersion !== 1 ||
    value.issue !== 1094 ||
    value.entrypoint !== "POST /api/whatsapp/webhook" ||
    !isSha(value.baselineDevelopSha) ||
    !isSha(value.metricsBaselineDevelopSha) ||
    !isSha(value.characterizationDevelopSha)
  ) {
    return false;
  }
  if (!isRecord(value.f0_07Revalidation)) return false;
  if (
    !hasExactKeys(value.f0_07Revalidation, [
      "status",
      "baselineSha",
      "affectedPaths",
    ]) ||
    value.f0_07Revalidation.status !== "revalidated" ||
    !isSha(value.f0_07Revalidation.baselineSha) ||
    !Array.isArray(value.f0_07Revalidation.affectedPaths) ||
    value.f0_07Revalidation.affectedPaths.length === 0 ||
    value.f0_07Revalidation.affectedPaths.some(path => typeof path !== "string")
  ) {
    return false;
  }
  if (!Array.isArray(value.scenarios) || value.scenarios.length === 0) {
    return false;
  }
  return value.scenarios.every(scenario => {
    if (!isRecord(scenario)) return false;
    if (
      !hasExactKeys(scenario, ["scenarioId", "result", "metrics"]) ||
      typeof scenario.scenarioId !== "string" ||
      !["ready", "clarification", "registered"].includes(
        scenario.result as string
      ) ||
      !isRecord(scenario.metrics) ||
      !hasExactKeys(scenario.metrics, [
        ...requiredMetricKeys,
        "nutritionSearchByItem",
      ])
    ) {
      return false;
    }
    if (
      requiredMetricKeys.some(
        key => !isNonNegativeFiniteNumber(scenario.metrics[key])
      ) ||
      !isRecord(scenario.metrics.nutritionSearchByItem)
    ) {
      return false;
    }
    return Object.values(scenario.metrics.nutritionSearchByItem).every(item => {
      return (
        isRecord(item) &&
        hasExactKeys(item, ["attempts", "outbound"]) &&
        isNonNegativeFiniteNumber(item.attempts) &&
        isNonNegativeFiniteNumber(item.outbound)
      );
    });
  });
}

function extractGoldenEvidence(output: string): GoldenEvidence | null {
  const line = output
    .split(/\r?\n/u)
    .find(candidate => candidate.includes("[issue-1094-evidence]"));
  if (!line) return null;
  const json = line.slice(line.indexOf("]") + 1).trim();
  try {
    const parsed: unknown = JSON.parse(json);
    return isValidGoldenEvidence(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sum(
  evidence: GoldenEvidence,
  key: keyof GoldenEvidence["scenarios"][number]["metrics"]
) {
  return evidence.scenarios.reduce(
    (total, scenario) =>
      total +
      (typeof scenario.metrics[key] === "number"
        ? (scenario.metrics[key] as number)
        : 0),
    0
  );
}

function assertCondition(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function summarizeGoldenEvidence(
  evidence: GoldenEvidence,
  candidateSha: string
) {
  assertCondition(
    evidence.baselineDevelopSha === HISTORICAL_BASELINE_SHA,
    `Golden flow historical baseline SHA mismatch: expected ${HISTORICAL_BASELINE_SHA}, got ${evidence.baselineDevelopSha}`
  );
  assertCondition(
    evidence.metricsBaselineDevelopSha === BASELINE_SHA,
    `Golden flow metrics baseline SHA mismatch: expected ${BASELINE_SHA}, got ${evidence.metricsBaselineDevelopSha}`
  );
  assertCondition(
    evidence.f0_07Revalidation.baselineSha === HISTORICAL_BASELINE_SHA,
    `F0-07 baseline SHA mismatch: expected ${HISTORICAL_BASELINE_SHA}, got ${evidence.f0_07Revalidation.baselineSha}`
  );
  assertCondition(
    evidence.characterizationDevelopSha === candidateSha,
    `Golden flow characterization SHA mismatch: expected ${candidateSha}, got ${evidence.characterizationDevelopSha ?? "missing"}`
  );
  const scenarioIds = evidence.scenarios.map(scenario => scenario.scenarioId);
  assertCondition(
    new Set(scenarioIds).size === scenarioIds.length,
    "Golden flow scenario IDs must be unique"
  );
  assertCondition(
    scenarioIds.length === Object.keys(requiredScenarioResults).length,
    `Golden flow scenario count mismatch: expected ${Object.keys(requiredScenarioResults).length}, got ${scenarioIds.length}`
  );
  for (const [scenarioId, expectedResult] of Object.entries(
    requiredScenarioResults
  )) {
    const scenario = evidence.scenarios.find(
      row => row.scenarioId === scenarioId
    );
    assertCondition(
      Boolean(scenario),
      `Required golden flow is missing: ${scenarioId}`
    );
    assertCondition(
      scenario?.result === expectedResult,
      `Golden flow ${scenarioId} expected ${expectedResult}, got ${scenario?.result ?? "missing"}`
    );
  }
  for (const scenarioId of [
    "06-variant-incompatible",
    "07-grounding-insufficient",
    "08-search-failure",
    "08-search-unavailable",
  ]) {
    const scenario = evidence.scenarios.find(
      row => row.scenarioId === scenarioId
    );
    assertCondition(
      scenario?.metrics.persistedMeals === 0 &&
        scenario.metrics.persistedItems === 0 &&
        scenario.metrics.pendingCreated === 1,
      `Fail-closed scenario ${scenarioId} has an unexpected mutation profile`
    );
  }
  const totals = {
    processMealInput: sum(evidence, "processMealInput"),
    nutritionSearchAttempts: sum(evidence, "nutritionSearchAttempts"),
    nutritionSearchOutbound: sum(evidence, "nutritionSearchOutbound"),
    roundTrips: sum(evidence, "roundTrips"),
    roundTripFailures: sum(evidence, "roundTripFailures"),
    fullSemanticRoundTrips: sum(evidence, "fullSemanticRoundTrips"),
    fullSemanticRoundTripFailures: sum(
      evidence,
      "fullSemanticRoundTripFailures"
    ),
    monotonicViolations: sum(evidence, "monotonicViolations"),
    pendingReplyOrderViolations: sum(evidence, "pendingReplyOrderViolations"),
    persistedMeals: sum(evidence, "persistedMeals"),
    persistedItems: sum(evidence, "persistedItems"),
    pendingClaimed: sum(evidence, "pendingClaimed"),
    pendingConsumed: sum(evidence, "pendingConsumed"),
    domainLinks: sum(evidence, "domainLinks"),
  };
  const maxOutboundPerItem = Math.max(
    0,
    ...evidence.scenarios.flatMap(scenario =>
      Object.values(scenario.metrics.nutritionSearchByItem).map(
        item => item.outbound
      )
    )
  );
  const maxAttemptsPerItem = Math.max(
    0,
    ...evidence.scenarios.flatMap(scenario =>
      Object.values(scenario.metrics.nutritionSearchByItem).map(
        item => item.attempts
      )
    )
  );
  const scenarioIdSet = new Set(scenarioIds);
  const productCoverage = {
    panco: scenarioIdSet.has("01-panco-premium"),
    commercialNonPanco:
      scenarioIdSet.has("02-wickbold-equivalente") &&
      scenarioIdSet.has("03-commercial-non-bread"),
  };
  const deltas = Object.fromEntries(
    Object.entries(baselineTotals).map(([key, baseline]) => [
      key,
      (totals[key as keyof typeof baselineTotals] ?? 0) - baseline,
    ])
  );

  for (const [key, expected] of Object.entries(baselineTotals)) {
    const actual = totals[key as keyof typeof baselineTotals];
    assertCondition(
      actual === expected,
      `Golden flow metric ${key} changed from ${expected} to ${actual}`
    );
  }
  assertCondition(
    totals.roundTripFailures === 0,
    "Text round-trip failures detected"
  );
  assertCondition(
    totals.fullSemanticRoundTripFailures === 0,
    "Full semantic round-trip failures detected"
  );
  assertCondition(
    totals.monotonicViolations === 0,
    "Monotonicity violations detected"
  );
  assertCondition(
    totals.pendingReplyOrderViolations === 0,
    "Pending/reply ordering violations detected"
  );
  assertCondition(
    maxOutboundPerItem <= 1,
    "More than one NUTRITION_SEARCH outbound per item"
  );
  assertCondition(
    maxAttemptsPerItem <= 1,
    "More than one NUTRITION_SEARCH attempt per item"
  );
  assertCondition(productCoverage.panco, "Panco golden flow is missing");
  assertCondition(
    productCoverage.commercialNonPanco,
    "Commercial non-Panco golden flows are missing"
  );

  return {
    scenarioCount: evidence.scenarios.length,
    baselineSha: evidence.metricsBaselineDevelopSha,
    characterizationSha: evidence.characterizationDevelopSha ?? null,
    totals,
    baselineTotals,
    deltas,
    maxOutboundPerItem,
    maxAttemptsPerItem,
    productCoverage,
  };
}

const steps: Array<StepResult & { output: string }> = [];
let golden: ReturnType<typeof summarizeGoldenEvidence> | null = null;
let failure: string | null = null;
const candidateSha = currentSha();
const workingTreeClean = workingTreeIsClean();
const phaseCommitsContained = Object.fromEntries(
  Object.entries(PHASE_COMMITS).map(([name, commit]) => [
    name,
    containsCommit(commit),
  ])
);

try {
  assertCondition(
    workingTreeClean,
    "Candidate worktree is dirty; commit all validation inputs before approval"
  );
  assertCondition(
    Object.values(phaseCommitsContained).every(Boolean),
    `Candidate does not contain all required phase commits: ${JSON.stringify(phaseCommitsContained)}`
  );
  assertCondition(
    existsSync("server/whatsappWebhook.issue1094.characterization.test.ts"),
    "Golden flow test is missing"
  );
  assertCondition(
    existsSync("scripts/check-architecture.ts"),
    "Architecture gate is missing"
  );
  const goldenStep = runStep(
    "golden-flows-1094",
    [
      "vitest",
      "run",
      "server/whatsappWebhook.issue1094.characterization.test.ts",
      "--reporter=dot",
    ],
    { DATABASE_URL: "" }
  );
  steps.push(goldenStep);
  assertCondition(goldenStep.exitCode === 0, "Golden flow suite failed");
  const evidence = extractGoldenEvidence(goldenStep.output);
  assertCondition(
    Boolean(evidence),
    "Golden flow evidence line is missing or invalid"
  );
  golden = summarizeGoldenEvidence(evidence as GoldenEvidence, candidateSha);

  const focusedStep = runStep(
    "phase-regressions",
    [
      "vitest",
      "run",
      "server/issue1095.ownershipConsolidation.test.ts",
      "server/modules/whatsapp/confirmedMealRegistration.issue1095.test.ts",
      "server/issue1096.bridgeReachability.test.ts",
      "server/issue1096.bridgeReachability.runtime.test.ts",
      "server/issue1096.bridgeReachability.downstream.runtime.test.ts",
      "server/issue1096.bridgeReachability.fallback.runtime.test.ts",
      "server/commercialServingRelation.issue1072.test.ts",
      "server/countableFoodQuantity.issue1072.searchContext.test.ts",
      "server/modules/whatsapp/countableFoodRegistrationGate.issue1072.test.ts",
      "server/nutritionSearchDecisionTelemetry.issue1072.test.ts",
      "--reporter=dot",
    ],
    { DATABASE_URL: "" }
  );
  steps.push(focusedStep);
  assertCondition(focusedStep.exitCode === 0, "Phase regression suites failed");

  for (const [name, args] of [
    ["check", ["check"]],
    ["test", ["test"]],
    ["architecture", ["architecture:check"]],
    ["docs", ["docs:check"]],
    ["agent", ["agent:check"]],
    ["build", ["build"]],
  ] as const) {
    const step = runStep(name, [...args], { DATABASE_URL: "" });
    steps.push(step);
    assertCondition(step.exitCode === 0, `${name} gate failed`);
  }

  if (process.env.DATABASE_URL?.trim()) {
    const dbStep = runStep("db-integrity", ["db:check-integrity"]);
    steps.push(dbStep);
    assertCondition(dbStep.exitCode === 0, "Database integrity gate failed");
  }
} catch (error) {
  failure = error instanceof Error ? error.message : "Final validation failed";
}

const databaseUrlAvailable = Boolean(process.env.DATABASE_URL?.trim());
const databaseIntegrity = databaseUrlAvailable
  ? "executed"
  : "skipped-no-database-url";
const databaseFailure = databaseUrlAvailable
  ? null
  : "Database integrity gate not approved: DATABASE_URL is unavailable";
const report = {
  schemaVersion: 1,
  issue: 1097,
  candidateSha,
  workingTreeClean,
  baselineMetricsSha: BASELINE_SHA,
  phaseCommitsContained,
  databaseUrlAvailable,
  databaseIntegrity,
  golden,
  checks: steps.map(({ output: _output, ...step }) => step),
  ok:
    !failure &&
    steps.every(step => step.exitCode === 0) &&
    Boolean(golden) &&
    Object.values(phaseCommitsContained).every(Boolean) &&
    databaseUrlAvailable,
  failure: failure ?? databaseFailure,
};

const serializedReport = JSON.stringify(report);
console.log(serializedReport);
if (process.env.ISSUE_1097_REPORT_PATH?.trim()) {
  writeFileSync(
    process.env.ISSUE_1097_REPORT_PATH,
    `${serializedReport}\n`,
    "utf8"
  );
}
if (!report.ok) process.exitCode = 1;

void runStep;
void root;
void execFileSync;
void currentSha;
void summarizeGoldenEvidence;
void assertCondition;
void containsCommit;
void workingTreeIsClean;
void extractGoldenEvidence;
void sum;
void BASELINE_SHA;
void PHASE_COMMITS;
void baselineTotals;
