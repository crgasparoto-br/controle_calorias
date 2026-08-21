import crypto from "node:crypto";
import fs from "node:fs";
import fsPromises from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const loaderPath = path.join(scriptDir, "issue-989-question-latency-loader.mjs");
const workerPath = path.join(scriptDir, "issue-989-question-latency-worker.mjs");
const debug = (...args) => { if (process.env.QUESTION_BENCH_DEBUG === "1") console.error("[question-bench]", ...args); };

function parseArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repoRoot,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe",
  });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`${command} ${args.join(" ")} failed${detail ? `:\n${detail}` : ""}`);
  }
  return (result.stdout ?? "").trim();
}

function sha256File(filename) {
  return crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = values.slice().sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export function summarizeObservations(observations) {
  const successful = observations.filter(item => item.outcome === "success");
  const values = successful.map(item => item.totalMs);
  return {
    totalRuns: observations.length,
    successfulRuns: successful.length,
    errors: observations.filter(item => item.outcome === "error").length,
    timeouts: observations.filter(item => item.outcome === "timeout").length,
    p50TotalMs: percentile(values, 0.5),
    p90TotalMs: percentile(values, 0.9),
    p95TotalMs: percentile(values, 0.95),
  };
}

function improvementPercent(baseline, candidate) {
  if (baseline === null || candidate === null || baseline <= 0) return null;
  return Number((((baseline - candidate) / baseline) * 100).toFixed(2));
}

function regressionPercent(baseline, candidate) {
  if (baseline === null || candidate === null || baseline <= 0 || candidate <= baseline) return 0;
  return Number((((candidate - baseline) / baseline) * 100).toFixed(2));
}

export function assertDistinctCandidateIdentities(baseSha, candidateSha) {
  if (!baseSha || !candidateSha || baseSha === candidateSha) {
    throw new Error("Baseline and candidate must be distinct explicit commit SHAs.");
  }
}

export function evaluateGate(baseline, candidate) {
  const improvements = {
    p50: improvementPercent(baseline.p50TotalMs, candidate.p50TotalMs),
    p90: improvementPercent(baseline.p90TotalMs, candidate.p90TotalMs),
    p95: improvementPercent(baseline.p95TotalMs, candidate.p95TotalMs),
  };
  const percentileRegressions = [
    regressionPercent(baseline.p50TotalMs, candidate.p50TotalMs),
    regressionPercent(baseline.p90TotalMs, candidate.p90TotalMs),
    regressionPercent(baseline.p95TotalMs, candidate.p95TotalMs),
  ];
  const gate = {
    atLeast30SuccessfulRunsEachSide:
      baseline.successfulRuns >= 30 && candidate.successfulRuns >= 30,
    p90OrP95ImprovementAtLeast20Percent:
      (improvements.p90 ?? Number.NEGATIVE_INFINITY) >= 20
      || (improvements.p95 ?? Number.NEGATIVE_INFINITY) >= 20,
    noPercentileRegressionOver5Percent: percentileRegressions.every(value => value <= 5),
    noErrorIncrease: candidate.errors <= baseline.errors,
    noTimeoutIncrease: candidate.timeouts <= baseline.timeouts,
  };
  return {
    improvements,
    gate,
    passed: Object.values(gate).every(Boolean),
  };
}

function selfTest() {
  assertDistinctCandidateIdentities("base", "candidate");
  const healthyBase = {
    successfulRuns: 40, errors: 0, timeouts: 0,
    p50TotalMs: 200, p90TotalMs: 200, p95TotalMs: 200,
  };
  const healthyCandidate = {
    successfulRuns: 40, errors: 0, timeouts: 0,
    p50TotalMs: 120, p90TotalMs: 140, p95TotalMs: 195,
  };
  if (!evaluateGate(healthyBase, healthyCandidate).passed) {
    throw new Error("Expected healthy synthetic gate fixture to pass.");
  }
  const errorRegression = { ...healthyCandidate, successfulRuns: 39, errors: 1 };
  if (evaluateGate(healthyBase, errorRegression).passed) {
    throw new Error("Error-count regression must fail the benchmark gate.");
  }
  const timeoutRegression = { ...healthyCandidate, successfulRuns: 39, timeouts: 1 };
  if (evaluateGate(healthyBase, timeoutRegression).passed) {
    throw new Error("Timeout-count regression must fail the benchmark gate.");
  }
  let identicalRejected = false;
  try {
    assertDistinctCandidateIdentities("same", "same");
  } catch {
    identicalRejected = true;
  }
  if (!identicalRejected) throw new Error("Identical baseline/candidate identities must be rejected.");
  if (expectedHistoryLoads("baseline", "none") !== 1) throw new Error("Baseline must preserve the legacy history load.");
  if (expectedHistoryLoads("candidate", "none") !== 0) throw new Error("Candidate scope=none must skip recent history.");
  if (expectedHistoryLoads("candidate", "full") !== 1) throw new Error("Candidate contextual scopes must preserve recent history.");
  const syntheticDelays = { history: 10, today: 30, currentWeek: 45, last30Days: 120 };
  if (expectedCandidateDbMs("none", syntheticDelays) !== 0) throw new Error("Candidate scope=none must not attribute skipped history to db_ms.");
  if (expectedCandidateDbMs("today", syntheticDelays) !== 40) throw new Error("Candidate contextual db_ms must include history plus selected insight loads.");
  if (!hasExpectedCandidateDbCoverage("none", null, syntheticDelays)) throw new Error("Candidate scope=none may report null db_ms when no context DB work executes.");
  if (hasExpectedCandidateDbCoverage("today", null, syntheticDelays)) throw new Error("Candidate contextual scopes must report numeric db_ms when DB work executes.");
  console.log("question latency benchmark self-test passed");
}

function resolveCommit(ref) {
  return run("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
}

function expectedHistoryLoads(side, scope) {
  if (side === "baseline") return 1;
  return scope === "none" ? 0 : 1;
}

function expectedContextLoads(scope) {
  switch (scope) {
    case "none": return { today: 0, currentWeek: 0, last30Days: 0 };
    case "today": return { today: 1, currentWeek: 0, last30Days: 0 };
    case "week": return { today: 0, currentWeek: 1, last30Days: 0 };
    case "period": return { today: 0, currentWeek: 0, last30Days: 1 };
    case "full": return { today: 1, currentWeek: 1, last30Days: 1 };
    default: throw new Error(`Unknown expected scope: ${scope}`);
  }
}

function expectedCandidateDbMs(scope, delays) {
  const expected = expectedContextLoads(scope);
  return (scope === "none" ? 0 : delays.history)
    + expected.today * delays.today
    + expected.currentWeek * delays.currentWeek
    + expected.last30Days * delays.last30Days;
}

function hasExpectedCandidateDbCoverage(scope, dbMs, delays) {
  const expectedDbMs = expectedCandidateDbMs(scope, delays);
  if (expectedDbMs === 0) return dbMs === null || (typeof dbMs === "number" && dbMs >= 0);
  return typeof dbMs === "number" && dbMs >= Math.max(0, expectedDbMs - 6);
}

function validateWorkerObservations(side, manifest, observations, delays) {
  if (observations.length !== manifest.fixtures.length * manifest.repetitionsPerFixture) {
    throw new Error(`${side} observation count does not match the fixed cohort.`);
  }
  const fixtures = new Map(manifest.fixtures.map(fixture => [fixture.id, fixture]));
  for (const observation of observations) {
    const fixture = fixtures.get(observation.fixtureId);
    if (!fixture) throw new Error(`${side} emitted an unknown fixture id.`);
    if (observation.outcome !== "success") continue;
    if (observation.providerCalls !== 1) {
      throw new Error(`${side}/${observation.fixtureId} performed ${observation.providerCalls} provider calls; expected exactly one.`);
    }
    if (observation.offeredWebSearch !== true) {
      throw new Error(`${side}/${observation.fixtureId} did not preserve QUESTION web_search availability.`);
    }
    if (observation.deliveryCalls !== 1) {
      throw new Error(`${side}/${observation.fixtureId} performed ${observation.deliveryCalls} delivery calls; expected exactly one.`);
    }
    for (const key of ["conversation", "inbound", "outbound", "responseLink", "processed"]) {
      if (observation.persistenceOperations?.[key] !== 1) {
        throw new Error(`${side}/${observation.fixtureId} persistence operation ${key}=${observation.persistenceOperations?.[key]}, expected 1.`);
      }
    }
    const expectedHistory = expectedHistoryLoads(side, fixture.expectedScope);
    if (observation.contextLoads.history !== expectedHistory) {
      throw new Error(`${side}/${observation.fixtureId} context history load=${observation.contextLoads.history}, expected ${expectedHistory}.`);
    }
    const expected = side === "baseline"
      ? { today: 1, currentWeek: 1, last30Days: 1 }
      : expectedContextLoads(fixture.expectedScope);
    for (const key of ["today", "currentWeek", "last30Days"]) {
      if (observation.contextLoads[key] !== expected[key]) {
        throw new Error(`${side}/${observation.fixtureId} context load ${key}=${observation.contextLoads[key]}, expected ${expected[key]}.`);
      }
    }
    if (side === "candidate" && observation.contextScope !== fixture.expectedScope) {
      throw new Error(`${side}/${observation.fixtureId} scope=${observation.contextScope}, expected ${fixture.expectedScope}.`);
    }
    if (side === "candidate") {
      if (observation.contextLoads.unusedDomainSnapshot !== 0) {
        throw new Error(`${side}/${observation.fixtureId} loaded an unused domain snapshot in the QUESTION history path.`);
      }
      const finalLatency = observation.finalLatency;
      if (!finalLatency || finalLatency.boundary !== "inbound_persistence_to_processed_reply") {
        throw new Error(`${side}/${observation.fixtureId} did not emit the canonical end-to-end latency boundary.`);
      }
      const expectedDbMs = expectedCandidateDbMs(fixture.expectedScope, delays);
      if (!hasExpectedCandidateDbCoverage(fixture.expectedScope, finalLatency.dbMs, delays)) {
        throw new Error(`${side}/${observation.fixtureId} db_ms=${finalLatency.dbMs}, expected ${expectedDbMs === 0 ? "null/zero when no context DB work executes" : `coverage of at least ${Math.max(0, expectedDbMs - 6)}ms across history and selected insight loads`}.`);
      }
      if (typeof finalLatency.contextMs !== "number" || finalLatency.contextMs < 0) {
        throw new Error(`${side}/${observation.fixtureId} did not measure context assembly latency.`);
      }
      if (typeof finalLatency.persistMs !== "number" || finalLatency.persistMs < 0) {
        throw new Error(`${side}/${observation.fixtureId} did not measure persistence latency.`);
      }
      if (finalLatency.deliveryOk !== true || finalLatency.outcome !== "success") {
        throw new Error(`${side}/${observation.fixtureId} final latency event did not observe successful delivery.`);
      }
      if (typeof finalLatency.totalMs !== "number" || Math.abs(finalLatency.totalMs - observation.totalMs) > 20) {
        throw new Error(`${side}/${observation.fixtureId} telemetry total_ms diverges from the harness end-to-end timer.`);
      }
    }
  }
}

async function runWorker({ side, sourceRoot, sourceSha, manifestPath, typescriptPath }) {
  const env = {
    ...process.env,
    QUESTION_BENCH_SOURCE_ROOT: sourceRoot,
    QUESTION_BENCH_SOURCE_SHA: sourceSha,
    QUESTION_BENCH_MANIFEST: manifestPath,
    QUESTION_BENCH_MODE: side,
    ...(typescriptPath ? { QUESTION_BENCH_TYPESCRIPT_PATH: typescriptPath } : {}),
  };
  const outputPath = path.join(os.tmpdir(), `question-latency-worker-${process.pid}-${side}-${Date.now()}.json`);
  const outputFd = fs.openSync(outputPath, "w");
  let stderr = "";
  try {
    const child = spawn(process.execPath, ["--loader", loaderPath, workerPath], {
      cwd: repoRoot,
      env,
      stdio: ["ignore", outputFd, "pipe"],
    });
    fs.closeSync(outputFd);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    const status = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
    if (status !== 0) {
      throw new Error(`question latency ${side} worker failed${stderr ? `:\n${stderr.trim()}` : ""}`);
    }
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } finally {
    try { fs.closeSync(outputFd); } catch {}
    fs.rmSync(outputPath, { force: true });
  }
}

function addWorktree(root, sha, label) {
  const target = path.join(root, label);
  run("git", ["worktree", "add", "--detach", target, sha]);
  const observed = run("git", ["rev-parse", "HEAD"], { cwd: target });
  if (observed !== sha) throw new Error(`${label} worktree identity mismatch: ${observed} != ${sha}`);
  return target;
}

function removeWorktree(target) {
  try {
    run("git", ["worktree", "remove", "--force", target]);
  } catch {
    // The outer temporary directory cleanup remains a final fallback.
  }
}

async function main() {
  if (process.argv.includes("--self-test")) {
    selfTest();
    return;
  }

  const baseRef = parseArg("--base-sha");
  const candidateRef = parseArg("--candidate-sha");
  if (!baseRef || !candidateRef) {
    throw new Error("--base-sha and --candidate-sha are required for an auditable comparison.");
  }
  const baseSha = resolveCommit(baseRef);
  const candidateSha = resolveCommit(candidateRef);
  assertDistinctCandidateIdentities(baseSha, candidateSha);

  const manifestPath = path.resolve(
    parseArg("--manifest") ?? path.join(repoRoot, "docs/benchmarks/question-latency/fixtures/manifest.json"),
  );
  const outputPath = path.resolve(
    parseArg("--out") ?? path.join(repoRoot, "docs/benchmarks/question-latency/results/local-productive.json"),
  );
  const typescriptPath = parseArg("--typescript-path") ?? process.env.QUESTION_BENCH_TYPESCRIPT_PATH;
  const manifest = JSON.parse(await fsPromises.readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.syntheticOnly !== true || !manifest.fixtures?.length) {
    throw new Error("Question latency benchmark requires a non-empty synthetic-only schema v1 manifest.");
  }
  const expectedRuns = manifest.fixtures.length * manifest.repetitionsPerFixture;
  if (expectedRuns < 30) throw new Error(`Expected at least 30 runs per side, got ${expectedRuns}.`);
  if (new Set(manifest.fixtures.map(fixture => fixture.id)).size !== manifest.fixtures.length) {
    throw new Error("Question latency fixture ids must be unique.");
  }

  const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), "question-latency-"));
  let baselineRoot;
  let candidateRoot;
  try {
    debug("adding baseline worktree");
    baselineRoot = addWorktree(tempRoot, baseSha, "baseline");
    debug("adding candidate worktree");
    candidateRoot = addWorktree(tempRoot, candidateSha, "candidate");
    debug("running paired baseline/candidate workers");
    const [baselineRun, candidateRun] = await Promise.all([
      runWorker({
        side: "baseline",
        sourceRoot: baselineRoot,
        sourceSha: baseSha,
        manifestPath,
        typescriptPath,
      }),
      runWorker({
        side: "candidate",
        sourceRoot: candidateRoot,
        sourceSha: candidateSha,
        manifestPath,
        typescriptPath,
      }),
    ]);
    debug("paired workers complete");
    validateWorkerObservations("baseline", manifest, baselineRun.observations, baselineRun.delays);
    validateWorkerObservations("candidate", manifest, candidateRun.observations, candidateRun.delays);

    const baseline = summarizeObservations(baselineRun.observations);
    const candidate = summarizeObservations(candidateRun.observations);
    const { improvements, gate, passed } = evaluateGate(baseline, candidate);
    const report = {
      schemaVersion: 3,
      benchmark: "question-latency/end-to-end-productive-pipeline-hermetic-v3",
      cohort: manifest.cohort,
      fixtureManifest: path.relative(repoRoot, manifestPath).split(path.sep).join("/"),
      executionMode: "exact-sha-production-pipeline-with-hermetic-persistence-delivery-and-provider-doubles",
      baseSha,
      candidateSha,
      sourceEntrypoints: [
        "server/modules/whatsapp/messageLifecycle.ts#beginInboundMessage",
        "server/modules/whatsapp/aiQuestionAssistant.ts#executeWhatsappAiQuestionIntent",
        "server/modules/whatsapp/logicalReplyDelivery.ts#sendWhatsAppLogicalDomainReply",
        "server/modules/whatsapp/messageLifecycle.ts#markMessageProcessed",
      ],
      environment: {
        timezone: manifest.timezone,
        provider: "openai-adapter-contract-via-hermetic-provider-double",
        model: "gpt-4.1-mini",
        policy: {
          timeoutMs: 2000,
          maxAttempts: 1,
          fallback: false,
          webSearch: "auto-available-not-forced",
        },
        stageDelaysMs: baselineRun.delays,
        concurrency: "sequential-observations; production context branches retain their own Promise.all concurrency",
      },
      provenance: {
        manifestSha256: sha256File(manifestPath),
        benchmarkSha256: sha256File(fileURLToPath(import.meta.url)),
        loaderSha256: sha256File(loaderPath),
        workerSha256: sha256File(workerPath),
        sourceIdentityVerifiedByGitWorktree: true,
      },
      baseline,
      candidate,
      improvementsPercent: improvements,
      gate: {
        ...gate,
        exactlyOneProviderCallPerSuccessfulQuestion: true,
        webSearchAvailableOnEverySuccessfulQuestion: true,
        productionEndToEndPipelineExecutedOnBothExactShas: true,
        candidateTelemetryMatchesEndToEndBoundary: true,
        candidateDbStageCoversHistoryAndSelectedInsightLoads: true,
        unusedQuestionHistoryDomainSnapshotSkipped: true,
        persistenceMeasuredOnCandidate: true,
        deliveryIncludedInTotalMs: true,
        timeToFirstToken: "not-measurable-non-streaming-provider-contract",
      },
      passed,
      observations: {
        baseline: baselineRun.observations,
        candidate: candidateRun.observations,
      },
      privacy: {
        containsRawQuestionOrAnswer: false,
        containsPiiOrCredentials: false,
        syntheticOnly: true,
      },
    };

    await fsPromises.mkdir(path.dirname(outputPath), { recursive: true });
    await fsPromises.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      outputPath,
      passed,
      baseline,
      candidate,
      improvementsPercent: improvements,
    }));
    if (!passed) process.exitCode = 1;
  } finally {
    debug("cleanup start");
    if (baselineRoot) removeWorktree(baselineRoot);
    if (candidateRoot) removeWorktree(candidateRoot);
    await fsPromises.rm(tempRoot, { recursive: true, force: true });
    debug("cleanup complete");
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
  });
}
