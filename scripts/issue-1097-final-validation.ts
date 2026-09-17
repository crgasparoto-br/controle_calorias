import { execFileSync, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const root = process.cwd();
const BASELINE_SHA = "394337d1166c4d12df3c78010246f65a63037eee";
const PHASE_COMMITS = {
  issue1094: "8b2540f3",
  issue1095: "66a611a2",
  issue1096: "165695b7",
} as const;

const baselineTotals = {
  processMealInput: 7,
  nutritionSearchAttempts: 12,
  nutritionSearchOutbound: 9,
  roundTrips: 23,
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
  baselineDevelopSha?: string;
  characterizationDevelopSha?: string;
  scenarios: Array<{
    scenarioId: string;
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

function runStep(
  name: string,
  args: string[]
): StepResult & { output: string } {
  const startedAt = Date.now();
  const result = spawnSync("pnpm", args, {
    cwd: root,
    env: {
      ...process.env,
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

function extractGoldenEvidence(output: string): GoldenEvidence | null {
  const line = output
    .split(/\r?\n/u)
    .find(candidate => candidate.includes("[issue-1094-evidence]"));
  if (!line) return null;
  const json = line.slice(line.indexOf("]") + 1).trim();
  try {
    return JSON.parse(json) as GoldenEvidence;
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

function summarizeGoldenEvidence(evidence: GoldenEvidence) {
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
  const scenarioIds = new Set(
    evidence.scenarios.map(scenario => scenario.scenarioId)
  );
  const productCoverage = {
    panco: scenarioIds.has("01-panco-premium"),
    commercialNonPanco:
      scenarioIds.has("02-wickbold-equivalente") &&
      scenarioIds.has("03-commercial-non-bread"),
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
      actual <= expected,
      `Golden flow metric ${key} increased from ${expected} to ${actual}`
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
    baselineSha: evidence.baselineDevelopSha ?? BASELINE_SHA,
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

try {
  assertCondition(
    existsSync("server/whatsappWebhook.issue1094.characterization.test.ts"),
    "Golden flow test is missing"
  );
  assertCondition(
    existsSync("scripts/check-architecture.ts"),
    "Architecture gate is missing"
  );
  const goldenStep = runStep("golden-flows-1094", [
    "vitest",
    "run",
    "server/whatsappWebhook.issue1094.characterization.test.ts",
    "--reporter=dot",
  ]);
  steps.push(goldenStep);
  assertCondition(goldenStep.exitCode === 0, "Golden flow suite failed");
  const evidence = extractGoldenEvidence(goldenStep.output);
  assertCondition(
    Boolean(evidence),
    "Golden flow evidence line is missing or invalid"
  );
  golden = summarizeGoldenEvidence(evidence as GoldenEvidence);

  const focusedStep = runStep("phase-regressions", [
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
  ]);
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
    const step = runStep(name, [...args]);
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

const report = {
  schemaVersion: 1,
  issue: 1097,
  candidateSha: currentSha(),
  baselineMetricsSha: BASELINE_SHA,
  phaseCommitsContained: Object.fromEntries(
    Object.entries(PHASE_COMMITS).map(([name, commit]) => [
      name,
      containsCommit(commit),
    ])
  ),
  databaseUrlAvailable: Boolean(process.env.DATABASE_URL?.trim()),
  golden,
  checks: steps.map(({ output: _output, ...step }) => step),
  ok: !failure && steps.every(step => step.exitCode === 0) && Boolean(golden),
  failure,
};

console.log(JSON.stringify(report));
if (!report.ok) process.exitCode = 1;

void runStep;
void root;
void execFileSync;
void currentSha;
void summarizeGoldenEvidence;
void assertCondition;
void containsCommit;
void extractGoldenEvidence;
void sum;
void BASELINE_SHA;
void PHASE_COMMITS;
void baselineTotals;
