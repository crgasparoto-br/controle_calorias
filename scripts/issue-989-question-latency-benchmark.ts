import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { loadQuestionContextByScope } from "../server/modules/whatsapp/questionContextLoader";
import { resolveQuestionContextScope, type QuestionContextScope } from "../server/modules/whatsapp/questionContextPlan";

type Fixture = { id: string; question: string; expectedScope: QuestionContextScope };
type Manifest = {
  schemaVersion: number;
  syntheticOnly: boolean;
  cohort: string;
  timezone: string;
  repetitionsPerFixture: number;
  fixtures: Fixture[];
};

type Observation = {
  fixtureId: string;
  repetition: number;
  contextScope: QuestionContextScope;
  totalMs: number;
  dbMs: number;
  contextMs: number;
  llmMs: number;
  persistMs: null;
  timeToFirstTokenMs: null;
  outcome: "success";
};

const SYNTHETIC_STAGE_MS = {
  history: 10,
  today: 30,
  currentWeek: 45,
  last30Days: 120,
  llm: 80,
} as const;

function parseArg(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function sleep(ms: number) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms));
}

function percentile(values: number[], ratio: number) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  const rank = Math.max(1, Math.ceil(sorted.length * ratio));
  return sorted[rank - 1];
}

function summarize(observations: Observation[]) {
  const values = observations.map(observation => observation.totalMs);
  return {
    successfulRuns: observations.length,
    errors: 0,
    timeouts: 0,
    p50TotalMs: percentile(values, 0.5),
    p90TotalMs: percentile(values, 0.9),
    p95TotalMs: percentile(values, 0.95),
  };
}

async function measureStage<T>(operation: () => Promise<T>) {
  const startedAt = performance.now();
  const value = await operation();
  return { value, elapsedMs: performance.now() - startedAt };
}

async function runObservation(
  fixture: Fixture,
  repetition: number,
  mode: "baseline" | "candidate",
): Promise<Observation> {
  const scope = mode === "baseline" ? "full" : resolveQuestionContextScope(fixture.question);
  if (mode === "candidate" && scope !== fixture.expectedScope) {
    throw new Error(`Fixture ${fixture.id} expected scope ${fixture.expectedScope}, got ${scope}`);
  }
  const totalStartedAt = performance.now();
  const contextStartedAt = performance.now();
  const knowledgeStartedAt = performance.now();
  const knowledgePromise = loadQuestionContextByScope(scope, {
    loadToday: () => sleep(SYNTHETIC_STAGE_MS.today),
    loadCurrentWeek: () => sleep(SYNTHETIC_STAGE_MS.currentWeek),
    loadLast30Days: () => sleep(SYNTHETIC_STAGE_MS.last30Days),
  }).then(() => performance.now() - knowledgeStartedAt);
  const [, dbMs] = await Promise.all([
    sleep(SYNTHETIC_STAGE_MS.history),
    knowledgePromise,
  ]);
  const contextMs = performance.now() - contextStartedAt;
  const llm = await measureStage(() => sleep(SYNTHETIC_STAGE_MS.llm));
  const totalMs = performance.now() - totalStartedAt;

  return {
    fixtureId: fixture.id,
    repetition,
    contextScope: scope,
    totalMs: Math.round(totalMs),
    dbMs: Math.round(dbMs),
    contextMs: Math.round(contextMs),
    llmMs: Math.round(llm.elapsedMs),
    persistMs: null,
    timeToFirstTokenMs: null,
    outcome: "success",
  };
}

function improvementPercent(baseline: number | null, candidate: number | null) {
  if (baseline === null || candidate === null || baseline <= 0) return null;
  return Number((((baseline - candidate) / baseline) * 100).toFixed(2));
}

function regressionPercent(baseline: number | null, candidate: number | null) {
  if (baseline === null || candidate === null || baseline <= 0 || candidate <= baseline) return 0;
  return Number((((candidate - baseline) / baseline) * 100).toFixed(2));
}

async function main() {
  const manifestPath = resolve(parseArg("--manifest") ?? "docs/benchmarks/question-latency/fixtures/manifest.json");
  const outputPath = resolve(parseArg("--out") ?? "docs/benchmarks/question-latency/results/local-hermetic.json");
  const baseSha = parseArg("--base-sha") ?? "unknown";
  const candidateSha = parseArg("--candidate-sha") ?? "working-tree";
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;

  if (manifest.schemaVersion !== 1 || manifest.syntheticOnly !== true || !manifest.fixtures.length) {
    throw new Error("Question latency benchmark requires a non-empty synthetic-only schema v1 manifest.");
  }
  const totalRuns = manifest.fixtures.length * manifest.repetitionsPerFixture;
  if (totalRuns < 30) throw new Error(`Expected at least 30 runs per side, got ${totalRuns}.`);
  if (new Set(manifest.fixtures.map(fixture => fixture.id)).size !== manifest.fixtures.length) {
    throw new Error("Question latency fixture ids must be unique.");
  }

  const baseline: Observation[] = [];
  const candidate: Observation[] = [];
  for (const fixture of manifest.fixtures) {
    for (let repetition = 1; repetition <= manifest.repetitionsPerFixture; repetition += 1) {
      baseline.push(await runObservation(fixture, repetition, "baseline"));
      candidate.push(await runObservation(fixture, repetition, "candidate"));
    }
  }

  const baselineSummary = summarize(baseline);
  const candidateSummary = summarize(candidate);
  const p50Improvement = improvementPercent(baselineSummary.p50TotalMs, candidateSummary.p50TotalMs);
  const p90Improvement = improvementPercent(baselineSummary.p90TotalMs, candidateSummary.p90TotalMs);
  const p95Improvement = improvementPercent(baselineSummary.p95TotalMs, candidateSummary.p95TotalMs);
  const gate = {
    atLeast30SuccessfulRunsEachSide: baselineSummary.successfulRuns >= 30 && candidateSummary.successfulRuns >= 30,
    p90OrP95ImprovementAtLeast20Percent:
      (p90Improvement ?? Number.NEGATIVE_INFINITY) >= 20
      || (p95Improvement ?? Number.NEGATIVE_INFINITY) >= 20,
    noPercentileRegressionOver5Percent: [
      regressionPercent(baselineSummary.p50TotalMs, candidateSummary.p50TotalMs),
      regressionPercent(baselineSummary.p90TotalMs, candidateSummary.p90TotalMs),
      regressionPercent(baselineSummary.p95TotalMs, candidateSummary.p95TotalMs),
    ].every(value => value <= 5),
    noErrorOrTimeoutIncrease: true,
    timeToFirstToken: "not-measurable-non-streaming-provider-contract" as const,
  };
  const passed = Object.entries(gate)
    .filter(([key]) => key !== "timeToFirstToken")
    .every(([, value]) => value === true);

  const report = {
    schemaVersion: 1,
    benchmark: "question-latency/hermetic-v1",
    cohort: manifest.cohort,
    fixtureManifest: "docs/benchmarks/question-latency/fixtures/manifest.json",
    executionMode: "hermetic-production-context-policy-with-fixed-provider-double",
    baseSha,
    candidateSha,
    environment: {
      timezone: manifest.timezone,
      provider: "synthetic-hermetic",
      model: "fixed-delay-question-double-v1",
      policy: {
        attempts: 1,
        fallback: false,
        webSearch: "available-but-not-executed-by-double",
      },
      stageDelaysMs: SYNTHETIC_STAGE_MS,
    },
    baseline: baselineSummary,
    candidate: candidateSummary,
    improvementsPercent: {
      p50: p50Improvement,
      p90: p90Improvement,
      p95: p95Improvement,
    },
    gate,
    passed,
    observations: {
      baseline,
      candidate,
    },
    privacy: {
      containsRawQuestionOrAnswer: false,
      syntheticOnly: true,
    },
  };

  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, passed, baseline: baselineSummary, candidate: candidateSummary, improvementsPercent: report.improvementsPercent }));
  if (!passed) process.exitCode = 1;
}

await main();
