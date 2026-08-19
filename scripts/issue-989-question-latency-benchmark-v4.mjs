import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const R = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = fileURLToPath(import.meta.url);
const L = path.join(R, "scripts/issue-989-question-latency-loader-v4.mjs");
const W = path.join(R, "scripts/issue-989-question-latency-worker-v4.mjs");
const A = name => {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1];
};
const X = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    cwd: options.cwd || R,
    encoding: "utf8",
    env: options.env || process.env,
  });
  if (result.status) throw new Error(result.stderr || result.stdout || `${command} failed`);
  return result.stdout.trim();
};
const S = ref => X("git", ["rev-parse", "--verify", `${ref}^{commit}`]);
const P = (values, percentile) => [...values]
  .sort((left, right) => left - right)[Math.max(0, Math.ceil(values.length * percentile) - 1)];
const I = (baseline, candidate) => Number((((baseline - candidate) / baseline) * 100).toFixed(2));
const G = (baseline, candidate) => candidate <= baseline
  ? 0
  : Number((((candidate - baseline) / baseline) * 100).toFixed(2));
const H = filename => crypto.createHash("sha256").update(fs.readFileSync(filename)).digest("hex");
const E = scope => scope === "none" ? [0, 0, 0]
  : scope === "today" ? [1, 0, 0]
    : scope === "week" ? [0, 1, 0]
      : ["last7Days", "month", "period"].includes(scope) ? [0, 0, 1]
        : [1, 1, 1];
const K = ["today", "currentWeek", "last30Days"];
const REQUIRED_POLICY_KEYS = ["timeoutMs", "maxAttempts", "fallback", "webSearch"];
const TTFT_DISPOSITION = "not-measurable-non-streaming-provider-contract";

function validateExecution(label, execution) {
  if (!execution || typeof execution !== "object") throw new Error(`${label}: execution metadata missing`);
  for (const key of ["timezone", "provider", "providerId", "model"]) {
    if (typeof execution[key] !== "string" || !execution[key].trim()) {
      throw new Error(`${label}: execution.${key} missing`);
    }
  }
  if (!execution.policy || typeof execution.policy !== "object") {
    throw new Error(`${label}: execution.policy missing`);
  }
  for (const key of REQUIRED_POLICY_KEYS) {
    if (!(key in execution.policy)) throw new Error(`${label}: execution.policy.${key} missing`);
  }
  if (!Number.isFinite(execution.policy.timeoutMs) || execution.policy.timeoutMs <= 0) {
    throw new Error(`${label}: invalid timeoutMs`);
  }
  if (!Number.isInteger(execution.policy.maxAttempts) || execution.policy.maxAttempts <= 0) {
    throw new Error(`${label}: invalid maxAttempts`);
  }
  if (typeof execution.policy.fallback !== "boolean") throw new Error(`${label}: invalid fallback`);
  if (typeof execution.policy.webSearch !== "string" || !execution.policy.webSearch) {
    throw new Error(`${label}: invalid webSearch policy`);
  }
}

function validateReportContract(report) {
  if (report.schemaVersion !== 4) throw new Error("BENCH-RESULT-CONTRACT-001: schemaVersion must remain 4");
  validateExecution("baseline", report.baseline?.execution);
  validateExecution("candidate", report.candidate?.execution);
  if (report.gate?.timeToFirstToken !== TTFT_DISPOSITION) {
    throw new Error("BENCH-RESULT-CONTRACT-001: TTFT disposition missing");
  }
  if (report.ttft?.measurable !== false || report.ttft?.targetMs !== 2000 || report.ttft?.disposition !== TTFT_DISPOSITION) {
    throw new Error("BENCH-RESULT-CONTRACT-001: TTFT contract incomplete");
  }
  for (const key of ["manifestSha256", "benchmarkSha256", "loaderSha256", "workerSha256"]) {
    if (!/^[a-f0-9]{64}$/.test(report.provenance?.[key] || "")) {
      throw new Error(`BENCH-RESULT-CONTRACT-001: provenance.${key} missing`);
    }
  }
  if (report.provenance?.sourceIdentityVerifiedByGitWorktree !== true) {
    throw new Error("BENCH-RESULT-CONTRACT-001: exact Git source identity not proven");
  }
  if (!report.fixtureManifest || !report.cohort || !report.executionMode) {
    throw new Error("BENCH-RESULT-CONTRACT-001: cohort/manifest/execution mode missing");
  }
}

function selfTest() {
  const execution = {
    timezone: "America/Sao_Paulo",
    provider: "hermetic-provider-double",
    providerId: "openai",
    model: "gpt-test",
    policy: { timeoutMs: 2000, maxAttempts: 1, fallback: false, webSearch: "auto-available-not-forced" },
  };
  const report = {
    schemaVersion: 4,
    cohort: "QUESTION/text-only",
    fixtureManifest: "docs/benchmarks/question-latency/fixtures/manifest.json",
    executionMode: "exact-sha-production-pipeline-with-hermetic-persistence-delivery-and-provider-doubles",
    baseline: { execution },
    candidate: { execution },
    ttft: { measurable: false, targetMs: 2000, disposition: TTFT_DISPOSITION },
    gate: { timeToFirstToken: TTFT_DISPOSITION },
    provenance: {
      manifestSha256: "a".repeat(64),
      benchmarkSha256: "b".repeat(64),
      loaderSha256: "c".repeat(64),
      workerSha256: "d".repeat(64),
      sourceIdentityVerifiedByGitWorktree: true,
    },
  };
  validateReportContract(report);

  const missingPolicy = structuredClone(report);
  delete missingPolicy.candidate.execution.policy.maxAttempts;
  let policyRejected = false;
  try { validateReportContract(missingPolicy); } catch { policyRejected = true; }
  if (!policyRejected) throw new Error("BENCH-RESULT-CONTRACT-001: missing policy metadata must fail");

  const missingTtft = structuredClone(report);
  delete missingTtft.ttft;
  let ttftRejected = false;
  try { validateReportContract(missingTtft); } catch { ttftRejected = true; }
  if (!ttftRejected) throw new Error("BENCH-RESULT-CONTRACT-001: missing TTFT disposition must fail");

  const missingProvenance = structuredClone(report);
  delete missingProvenance.provenance.workerSha256;
  let provenanceRejected = false;
  try { validateReportContract(missingProvenance); } catch { provenanceRejected = true; }
  if (!provenanceRejected) throw new Error("BENCH-RESULT-CONTRACT-001: missing provenance must fail");

  console.log("question latency benchmark v4 self-test passed (BENCH-RESULT-CONTRACT-001)");
}

function V(side, manifest, run) {
  const fixtures = new Map(manifest.fixtures.map(fixture => [fixture.id, fixture]));
  validateExecution(side, run.execution);
  for (const observation of run.observations) {
    const fixture = fixtures.get(observation.fixtureId);
    if (!fixture || observation.outcome !== "success") continue;
    if (observation.providerCalls !== 1
      || observation.deliveryCalls !== 1
      || !observation.offeredWebSearch
      || observation.dbOperations.userLookup !== 1
      || observation.dbOperations.timeZone !== 1) {
      throw new Error(`${side}/${observation.fixtureId}: productive boundary`);
    }
    if (!["conversation", "inbound", "outbound", "responseLink", "processed"]
      .every(key => observation.persistenceOperations[key] === 1)) {
      throw new Error(`${side}/${observation.fixtureId}: persistence`);
    }
    const expected = side === "baseline" ? E("full") : E(fixture.expectedScope);
    if (!K.every((key, index) => observation.contextLoads[key] === expected[index])) {
      throw new Error(`${side}/${observation.fixtureId}: context`);
    }
    const historyLoads = side === "candidate" && fixture.expectedScope === "none" ? 0 : 1;
    if (observation.contextLoads.history !== historyLoads
      || (side === "candidate" && fixture.expectedScope === "none" && observation.historySent)) {
      throw new Error(`${side}/${observation.fixtureId}: history`);
    }
    if (side === "candidate") {
      if (observation.contextScope !== fixture.expectedScope) {
        throw new Error(`${side}/${observation.fixtureId}: scope`);
      }
      const latency = observation.finalLatency;
      const selectedDbDelay = historyLoads * run.delays.history
        + expected[0] * run.delays.today
        + expected[1] * run.delays.currentWeek
        + expected[2] * run.delays.last30Days;
      const minDbMs = run.delays.userLookup + run.delays.timeZone + selectedDbDelay - 10;
      if (!latency
        || latency.boundary !== "inbound_persistence_to_processed_reply"
        || latency.deliveryOk !== true
        || latency.outcome !== "success"
        || typeof latency.dbMs !== "number"
        || latency.dbMs < minDbMs) {
        throw new Error(`${side}/${observation.fixtureId}: telemetry`);
      }
    }
  }
}

function Q(side, sourceRoot, sha, manifestPath, typescriptPath) {
  return new Promise((resolve, reject) => {
    const env = {
      ...process.env,
      QUESTION_BENCH_SOURCE_ROOT: sourceRoot,
      QUESTION_BENCH_SOURCE_SHA: sha,
      QUESTION_BENCH_MANIFEST: manifestPath,
      QUESTION_BENCH_MODE: side,
      QUESTION_BENCH_TYPESCRIPT_PATH: typescriptPath,
    };
    const child = spawn(process.execPath, ["--loader", L, W], {
      cwd: R,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("close", code => code ? reject(new Error(stderr || stdout)) : resolve(JSON.parse(stdout)));
  });
}

function addWorktree(tempRoot, sha, label) {
  const target = path.join(tempRoot, label);
  if (process.env.QUESTION_BENCH_SPARSE_WORKTREES === "1") {
    X("git", ["worktree", "add", "--detach", "--no-checkout", target, sha]);
    X("git", ["sparse-checkout", "init", "--cone"], { cwd: target });
    X("git", ["sparse-checkout", "set", "server", "shared"], { cwd: target });
    X("git", ["checkout", "--detach", sha], { cwd: target });
  } else {
    X("git", ["worktree", "add", "--detach", target, sha]);
  }
  const observed = X("git", ["rev-parse", "HEAD"], { cwd: target });
  if (observed !== sha) throw new Error(`${label}: worktree identity mismatch`);
  return target;
}

if (process.argv.includes("--self-test")) {
  selfTest();
  process.exit(0);
}

const baseRef = A("--base-sha");
const candidateRef = A("--candidate-sha");
if (!baseRef || !candidateRef) throw new Error("--base-sha and --candidate-sha are required");
const b = S(baseRef);
const c = S(candidateRef);
if (b === c) throw new Error("same SHA");

const mp = path.resolve(A("--manifest") || path.join(R, "docs/benchmarks/question-latency/fixtures/manifest.json"));
const out = path.resolve(A("--out") || path.join(R, "docs/benchmarks/question-latency/results/local-productive-v4.json"));
const ts = A("--typescript-path") || process.env.QUESTION_BENCH_TYPESCRIPT_PATH;
const manifest = JSON.parse(await fsp.readFile(mp, "utf8"));
manifest.repetitionsPerFixture = 2;
if (manifest.fixtures.length < 30) throw new Error("fixtures<30");

const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "q-v4-"));
const baselineRoot = addWorktree(tempRoot, b, "b");
const candidateRoot = addWorktree(tempRoot, c, "c");
const tempManifest = path.join(tempRoot, "manifest-v4.json");
await fsp.writeFile(tempManifest, JSON.stringify(manifest));

try {
  const baselineRun = await Q("baseline", baselineRoot, b, tempManifest, ts);
  const candidateRun = await Q("candidate", candidateRoot, c, tempManifest, ts);
  V("baseline", manifest, baselineRun);
  V("candidate", manifest, candidateRun);

  const summarize = run => {
    const observations = run.observations;
    const successful = observations.filter(item => item.outcome === "success").map(item => item.totalMs);
    return {
      totalRuns: observations.length,
      successfulRuns: successful.length,
      errors: observations.filter(item => item.outcome === "error").length,
      timeouts: observations.filter(item => item.outcome === "timeout").length,
      p50TotalMs: P(successful, 0.5),
      p90TotalMs: P(successful, 0.9),
      p95TotalMs: P(successful, 0.95),
      execution: run.execution,
    };
  };

  const baseline = summarize(baselineRun);
  const candidate = summarize(candidateRun);
  const improvements = {
    p50: I(baseline.p50TotalMs, candidate.p50TotalMs),
    p90: I(baseline.p90TotalMs, candidate.p90TotalMs),
    p95: I(baseline.p95TotalMs, candidate.p95TotalMs),
  };
  const executionPolicyEquivalent = JSON.stringify(baseline.execution) === JSON.stringify(candidate.execution);
  const gate = {
    atLeast30SuccessfulRunsEachSide: baseline.successfulRuns >= 30 && candidate.successfulRuns >= 30,
    atLeast60SuccessfulRunsEachSide: baseline.successfulRuns >= 60 && candidate.successfulRuns >= 60,
    p90OrP95ImprovementAtLeast20Percent: improvements.p90 >= 20 || improvements.p95 >= 20,
    noPercentileRegressionOver5Percent: [
      G(baseline.p50TotalMs, candidate.p50TotalMs),
      G(baseline.p90TotalMs, candidate.p90TotalMs),
      G(baseline.p95TotalMs, candidate.p95TotalMs),
    ].every(value => value <= 5),
    noErrorIncrease: candidate.errors <= baseline.errors,
    noTimeoutIncrease: candidate.timeouts <= baseline.timeouts,
    productiveUserLookupAndTimeZoneExecuted: true,
    genericQuestionsSkipRecentHistory: true,
    candidateDbStageCoversPreparatoryAndContextReads: true,
    exactlyOneProviderCallPerSuccessfulQuestion: true,
    webSearchAvailableOnEverySuccessfulQuestion: true,
    productionEndToEndPipelineExecutedOnBothExactShas: true,
    executionMetadataComplete: true,
    executionPolicyEquivalent,
    provenanceComplete: true,
    timeToFirstToken: TTFT_DISPOSITION,
  };

  const report = {
    schemaVersion: 4,
    benchmark: "question-latency/end-to-end-productive-pipeline-hermetic-v4",
    cohort: manifest.cohort,
    fixtureCount: manifest.fixtures.length,
    repetitionsPerFixture: manifest.repetitionsPerFixture,
    fixtureManifest: path.relative(R, mp).split(path.sep).join("/"),
    executionMode: "exact-sha-production-pipeline-with-hermetic-persistence-delivery-and-provider-doubles",
    worktreeMode: process.env.QUESTION_BENCH_SPARSE_WORKTREES === "1" ? "sparse-server-shared" : "full",
    syntheticOnly: true,
    baseSha: b,
    candidateSha: c,
    baseline,
    candidate,
    improvements,
    ttft: {
      metric: "time_to_first_token_ms",
      targetMs: 2000,
      measurable: false,
      disposition: TTFT_DISPOSITION,
    },
    provenance: {
      manifestSha256: H(mp),
      benchmarkSha256: H(SCRIPT),
      loaderSha256: H(L),
      workerSha256: H(W),
      sourceIdentityVerifiedByGitWorktree: true,
    },
    privacy: {
      containsRawQuestionOrAnswer: false,
      containsPiiOrCredentials: false,
      syntheticOnly: true,
    },
    gate,
    passed: Object.values(gate).every(value => value === true || value === TTFT_DISPOSITION),
    sourceEntrypoints: [
      "server/db.ts#getUserIdByWhatsappPhone",
      "server/modules/whatsapp/timeZoneContext.ts#resolveWhatsAppOperationTimeZone",
      "server/modules/whatsapp/aiQuestionAssistant.ts#executeWhatsappAiQuestionIntent",
      "server/modules/whatsapp/messageLifecycle.ts",
      "server/modules/whatsapp/logicalReplyDelivery.ts",
    ],
  };

  validateReportContract(report);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (!report.passed) process.exitCode = 1;
} finally {
  for (const target of [baselineRoot, candidateRoot]) {
    try { X("git", ["worktree", "remove", "--force", target]); } catch {}
  }
  await fsp.rm(tempRoot, { recursive: true, force: true });
}
