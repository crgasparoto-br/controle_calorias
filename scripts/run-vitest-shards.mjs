#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const now = () => Date.now();
export const TERMINATION_GRACE_MS = 2000;
export const TERMINATION_LIMIT_MS = 5000;

function processTreeRssKb(rootPid) {
  try {
    const rows = execFileSync("ps", ["-e", "-o", "pid=,ppid=,rss="], { encoding: "utf8" })
      .trim().split("\n").map(line => line.trim().split(/\s+/).map(Number))
      .filter(parts => parts.length === 3 && parts.every(Number.isFinite));
    const children = new Map();
    for (const [pid, parent, rss] of rows) {
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push([pid, rss]);
    }
    let sum = 0;
    const pending = [rootPid];
    const seen = new Set();
    while (pending.length) {
      const pid = pending.pop();
      if (seen.has(pid)) continue;
      seen.add(pid);
      const entry = rows.find(item => item[0] === pid);
      if (entry) sum += entry[2];
      for (const child of children.get(pid) || []) pending.push(child[0]);
    }
    return seen.size > 0 && rows.some(item => item[0] === rootPid) ? sum : null;
  } catch {
    return null;
  }
}

/**
 * Starts each shard once with a strict concurrency limit. A failed shard does
 * not prevent queued shards from running; all active children are settled.
 * launch(number, onOutput) returns { pid, done, kill }.
 */
export async function runShards({
  total = 24,
  concurrency = 2,
  launch,
  onComplete = () => {},
  onProgress = () => {},
  signal,
}) {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error("Invalid shard scheduler configuration");
  }
  const results = new Array(total);
  const running = new Set();
  let next = 1;
  let interrupted = false;
  let runningCount = 0;
  let maximumConcurrency = 0;
  const abort = () => {
    if (interrupted) return;
    interrupted = true;
    // Per-child abort handlers deliver TERM and handle bounded escalation.
  };
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();

  async function worker() {
    while (!interrupted && next <= total) {
      const shard = next++;
      let child;
      const started = now();
      try {
        child = launch(shard, text => onProgress(shard, text));
        running.add(child);
        runningCount++;
        maximumConcurrency = Math.max(maximumConcurrency, runningCount);
        // A child that ignores TERM must never block the required gate forever.
        const result = await new Promise((resolve, reject) => {
          let settled = false;
          let escalate;
          let deadline;
          const clear = () => { clearTimeout(escalate); clearTimeout(deadline); };
          const finish = (fn, value) => {
            if (settled) return;
            settled = true;
            clear();
            fn(value);
          };
          const onAbort = () => {
            child.kill?.("SIGTERM");
            escalate = setTimeout(() => child.kill?.("SIGKILL"), TERMINATION_GRACE_MS);
            deadline = setTimeout(() => finish(reject, new Error("Shard did not exit after SIGKILL")), TERMINATION_LIMIT_MS);
          };
          // Remove listener when the process exits; abort may happen later.
          if (signal?.aborted) onAbort();
          else signal?.addEventListener("abort", onAbort, { once: true });
          Promise.resolve(child.done).then(
            value => finish(resolve, value),
            error => finish(reject, error),
          ).finally(() => signal?.removeEventListener("abort", onAbort));
        });
        results[shard - 1] = {
          shard, exitCode: Number.isInteger(result.exitCode) ? result.exitCode : 1,
          durationMs: now() - started, peakRssKb: result.peakRssKb ?? null,
        };
      } catch (error) {
        results[shard - 1] = {
          shard, exitCode: 1, durationMs: now() - started, peakRssKb: null,
          error: String(error),
        };
      } finally {
        if (child) {
          running.delete(child);
          runningCount--;
        }
        onComplete(results[shard - 1]);
      }
    }
  }
  try {
    await Promise.all(Array.from({ length: Math.min(total, concurrency) }, () => worker()));
  } finally {
    signal?.removeEventListener("abort", abort);
  }
  return { results: results.filter(Boolean), interrupted, maximumConcurrency,
    success: !interrupted && results.every(result => result?.exitCode === 0) };
}

export function spawnVitestShard(number, output) {
  const child = spawn("pnpm", [
    "exec", "vitest", "run", `--shard=${number}/24`, "--maxWorkers=1", "--minWorkers=1",
  ], { env: process.env, stdio: ["ignore", "pipe", "pipe"], detached: true });
  const feed = chunk => output(chunk.toString());
  child.stdout.on("data", feed);
  child.stderr.on("data", feed);
  let peakRssKb = null;
  const sample = () => {
    const rss = processTreeRssKb(child.pid);
    if (rss !== null) peakRssKb = Math.max(peakRssKb ?? 0, rss);
  };
  const timer = setInterval(sample, 250);
  const done = new Promise(resolve => {
    child.on("error", error => { output(String(error) + "\n"); });
    child.on("close", (code, terminatedBy) => {
      clearInterval(timer);
      resolve({ exitCode: terminatedBy ? 1 : code ?? 1, peakRssKb });
    });
  });
  return { pid: child.pid, done, kill: sig => {
    if (!child.pid) return;
    try { process.kill(-child.pid, sig); } catch (error) {
      if (error.code !== "ESRCH") child.kill(sig);
    }
  } };
}

export function formatShardLog(item, output = "") {
  const duration = (item.durationMs / 1000).toFixed(1);
  const msg = `${item.exitCode === 0 ? "PASS" : "FAIL"}: Vitest shard ${item.shard}/24 (${duration}s; peak RSS sample: ${item.peakRssKb ?? "unknown"} KiB)\n`;
  return `--- Vitest shard ${item.shard}/24 ---\n${output}\n${msg}`;
}

/** Durable, exact-HEAD evidence from tests already executed in the shard suite.
 * These reports are measurements, never approved production thresholds. */
export const C3_EVIDENCE_MARKERS = [
  "C3_ITEM30_ROUNDING_CAMPAIGN", "C3_OPEN_EVIDENCE_READINESS",
  "C3_REAL_RESOLVER_FIXTURE_BASELINE",
];
const C3_SPLITS = ["acquisition", "calibration", "holdout"];
const c3Count = value => Number.isSafeInteger(value) && value >= 0;

// Exact cohort contract is preregistered in #1306 before any v2 CI run.
const C3_ROUNDING_QUANTITIES_G = [30, 125, 750];
// Fixed by the #1306 preregistration (issue comment 6478971288).
// The validation contract is independent of producer-reported cohort IDs.
export const C3_ROUNDING_PREREGISTERED_PROFILES = Object.freeze({
  calibration: Object.freeze([
    "taco-mortadela",
    "taco-amendoim-grao-cru",
    "taco-arroz-integral-cozido",
    "taco-queijo-minas-frescal",
    "taco-banana-nanica-crua",
    "taco-batata-doce-cozida",
    "taco-pao-trigo-forma-integral",
    "taco-tomate-com-semente-cru",
    "taco-laranja-baia-suco",
    "taco-chocolate-ao-leite",
    "taco-macarrao-instantaneo",
    "taco-ovo-de-galinha-inteiro-cozido10minutos",
  ]),
  holdout: Object.freeze([
    "taco-iogurte-natural",
    "taco-pera-williams-crua",
    "taco-feijao-carioca-cozido",
    "taco-abacate-cru",
    "taco-aveia-flocos-crua",
    "taco-biscoito-doce-maisena",
    "taco-leite-de-cabra",
    "taco-mamao-papaia-cru",
    "taco-alface-americana-crua",
    "taco-frango-asa-com-pele-crua",
    "taco-carne-bovina-acem-moido-cozido",
    "taco-margarina-com-oleo-hidrogenado-sem-sal-80-de-lipideos",
  ]),
});
const C3_ROUNDING_PROFILES_PER_SPLIT = 12;
function c3RoundingCohortValid(rounding) {
  if (rounding?.cohortRevision !== "c3-rounding-expanded-v2" ||
      JSON.stringify(rounding.quantityGrams) !== JSON.stringify(C3_ROUNDING_QUANTITIES_G)) return false;
  const names = [];
  for (const [split, foodsKey, casesKey] of [
    ["calibration", "calibrationFoodProfiles", "calibrationProfiles"],
    ["holdout", "holdoutFoodProfiles", "holdoutProfiles"],
  ]) {
    const foods = rounding[foodsKey], cases = rounding[casesKey];
    const preregistered = C3_ROUNDING_PREREGISTERED_PROFILES[split];
    if (!Array.isArray(foods) || foods.length !== C3_ROUNDING_PROFILES_PER_SPLIT ||
        !foods.every(food => typeof food === "string" && /^taco-[a-z0-9-]+$/.test(food)) ||
        new Set(foods).size !== foods.length ||
        !preregistered.every(food => foods.includes(food)) || !Array.isArray(cases)) return false;
    names.push(...foods);
    const expected = new Set(foods.flatMap(food =>
      C3_ROUNDING_QUANTITIES_G.map(grams => food + "@" + grams + "g")));
    if (cases.length !== expected.size || new Set(cases).size !== expected.size ||
        !cases.every(value => expected.has(value))) return false;
  }
  // Comparing case IDs alone would miss the same TACO food on different
  // quantities in calibration and holdout.
  return new Set(names).size === names.length;
}
// The synthetic adapters exercise text supplied as transcript/caption; they
// are NOT evidence of ASR/OCR quality or independent production labels.
function c3RepresentativityValid(ready, rounding) {
  const scope = ready?.representativity;
  const modalityKeys = ["text", "audio_transcript", "image", "multimodal"];
  if (!scope || scope.source !== "golden-food-corpus-synthetic" ||
      !scope.byModality || typeof scope.byModality !== "object" ||
      Object.keys(scope.byModality).sort().join(",") !== [...modalityKeys].sort().join(",") ||
      !modalityKeys.every(key => c3Count(scope.byModality[key]) && scope.byModality[key] > 0) ||
      Object.values(scope.byModality).reduce((sum, count) => sum + count, 0) !== ready.corpusCases ||
      !c3Count(scope.labeledBrandedCases) || scope.labeledBrandedCases === 0 ||
      scope.labeledBrandedCases > ready.corpusCases || scope.roundingBrandedProfiles !== 0 ||
      scope.roundingNutritionSource !== "TACO_4E" ||
      scope.productionDecision !== "blocked-no-independent-representative-evidence" ||
      JSON.stringify(scope.untestedDimensions) !== JSON.stringify([
        "real_asr", "real_vision_ocr", "branded_nutrition",
        "population_sampling", "independent_nominal_approval",
      ])) return false;
  const diagnostics = rounding.exploratoryModalityDiagnostics;
  if (!Array.isArray(diagnostics) || diagnostics.length !== 2 ||
      diagnostics[0]?.modality !== "audio_transcript" ||
      diagnostics[1]?.modality !== "image") return false;
  for (const row of diagnostics) {
    if (row.candidateSelection !== "excluded" || row.inputKind !==
        (row.modality === "image" ? "synthetic_caption" : "synthetic_transcript") ||
        !row.bySplit || Object.keys(row.bySplit).sort().join(",") !== "calibration,holdout") return false;
    for (const split of ["calibration", "holdout"]) {
      const part = row.bySplit[split];
      if (!part || part.cases !== rounding[split + "Profiles"].length ||
          !part.maxDelta || Object.keys(part.maxDelta).sort().join(",") !== "calories,carbs,fat,protein" ||
          !["calories", "protein", "carbs", "fat"].every(field =>
            Number.isFinite(part.maxDelta[field]) && part.maxDelta[field] >= 0 &&
            part.maxDelta[field] <= rounding.selectedTolerance[field])) return false;
    }
  }
  return true;
}

function c3FailureClassesValid(classes, expectedTotal) {
  if (!classes || typeof classes !== "object" || Array.isArray(classes)) return false;
  const counts = Object.values(classes);
  return counts.every(c3Count) &&
    (expectedTotal === undefined || counts.reduce((sum, count) => sum + count, 0) === expectedTotal);
}

function c3BaselineConsistent(ready, baseline) {
  if (!c3Count(ready?.corpusCases) || ready.corpusCases === 0 ||
      !ready.splits || typeof ready.splits !== "object" || Array.isArray(ready.splits) ||
      Object.keys(ready.splits).sort().join(",") !== [...C3_SPLITS].sort().join(",") ||
      !C3_SPLITS.every(split => c3Count(ready.splits[split])) ||
      C3_SPLITS.reduce((sum, split) => sum + ready.splits[split], 0) !== ready.corpusCases ||
      baseline?.calls !== ready.corpusCases || !Array.isArray(baseline.bySplit) ||
      baseline.bySplit.length !== C3_SPLITS.length ||
      !c3FailureClassesValid(baseline.failureClasses)) return false;

  let failedCases = 0;
  const seen = new Set();
  for (const row of baseline.bySplit) {
    if (!row || !C3_SPLITS.includes(row.split) || seen.has(row.split)) return false;
    seen.add(row.split);
    if (!c3Count(row.cases) || row.cases !== ready.splits[row.split] ||
        !c3Count(row.resolvableLabeled) || row.resolvableLabeled > row.cases ||
        !c3Count(row.matchedCases) || !c3Count(row.failedCases) ||
        row.matchedCases + row.failedCases !== row.cases ||
        !c3Count(row.abstentions) || row.abstentions > row.cases ||
        (row.resolvableLabeled === 0 ? row.matchRate !== null :
          !Number.isFinite(row.matchRate) || row.matchRate < 0 || row.matchRate > 1)) return false;
    if (row.resolvableLabeled > 0) {
      // Resolvable hits are a subset of all matched cases, not their synonym.
      const hits = row.matchRate * row.resolvableLabeled;
      const lower = Math.max(0, row.matchedCases - (row.cases - row.resolvableLabeled));
      const upper = Math.min(row.matchedCases, row.resolvableLabeled);
      if (Math.abs(hits - Math.round(hits)) > 1e-9 || hits < lower - 1e-9 || hits > upper + 1e-9) return false;
    }
    failedCases += row.failedCases;
  }
  // A single case can fail multiple checks: failure-class counts can exceed
  // failed cases, but must cover each failed case at least once.
  const classifiedFailures = Object.values(baseline.failureClasses).reduce((sum, count) => sum + count, 0);
  return seen.size === C3_SPLITS.length &&
    (failedCases === 0 ? classifiedFailures === 0 : classifiedFailures >= failedCases);
}

export function extractC3Evidence(log) {
  const reports = {};
  for (const rawLine of log.split(/\r?\n/)) {
    const line = rawLine.replace(/\x1b\[[0-9;]*m/g, "");
    for (const marker of C3_EVIDENCE_MARKERS) {
      const match = line.match(new RegExp("(?:^|\\s)" + marker + "\\s+(\\{.*\\})\\s*$"));
      if (!match) continue;
      if (marker in reports) throw new Error("C3: duplicate " + marker);
      try { reports[marker] = JSON.parse(match[1]); }
      catch { throw new Error("C3: invalid " + marker + " JSON"); }
    }
  }
  for (const marker of C3_EVIDENCE_MARKERS) {
    if (!reports[marker]) throw new Error("C3: missing " + marker);
  }
  const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
  const ready = reports.C3_OPEN_EVIDENCE_READINESS;
  const baseline = reports.C3_REAL_RESOLVER_FIXTURE_BASELINE;
  if (rounding.splitPolicy !== "candidate-selected-from-calibration-before-holdout" ||
      rounding.baselinePolicy !== "open-fail-closed-zero-divergence" ||
      !Array.isArray(rounding.calibrationProfiles) || !rounding.calibrationProfiles.length ||
      !Array.isArray(rounding.holdoutProfiles) || !rounding.holdoutProfiles.length ||
      new Set([...rounding.calibrationProfiles, ...rounding.holdoutProfiles]).size !==
        rounding.calibrationProfiles.length + rounding.holdoutProfiles.length ||
       !c3RoundingCohortValid(rounding)) {
    throw new Error("C3: invalid independent calibration/holdout or baseline");
  }
  for (const field of ["calories", "protein", "carbs", "fat"]) {
    const grid = field === "calories" ? rounding.candidates?.caloriesKcal : rounding.candidates?.macroGrams;
    const rows = rounding.calibrationCandidateMetrics?.[field];
    const selected = rounding.selectedTolerance?.[field];
    const comparison = rounding.comparisonToBaseline?.[field];
    const holdout = rounding.holdoutSelectedMetrics?.[field];
    if (!Array.isArray(grid) || !grid.length || grid[0] !== 0 ||
        !Array.isArray(rows) || rows.length !== grid.length ||
        !grid.every((value, i) => Number.isFinite(value) && value >= 0 && (!i || value > grid[i - 1])) ||
        !rows.every((row, i) => row.candidate === grid[i] &&
          row.cases === rounding.calibrationProfiles.length && row.cases > 0 &&
          c3Count(row.passed) && c3Count(row.failed) &&
          row.passed + row.failed === row.cases &&
          Number.isFinite(row.maxDelta) && row.maxDelta >= 0 &&
          row.maxDelta === rounding.calibrationMaxDelta?.[field] &&
          // A measured delta above the candidate cannot yield zero failures;
          // conversely all pairs must pass if the maximum is within tolerance.
          (row.failed === 0) === (row.maxDelta <= row.candidate) &&
          c3FailureClassesValid(row.failuresByClass, row.failed)) ||
        selected !== grid.find(value => value >= rounding.calibrationMaxDelta?.[field]) ||
        comparison?.baselinePolicy !== rounding.baselinePolicy ||
        JSON.stringify(comparison.baseline) !== JSON.stringify(rows[0]) ||
        JSON.stringify(comparison.selected) !== JSON.stringify(rows.find(row => row.candidate === selected)) ||
        comparison.passedDelta !== comparison.selected.passed - comparison.baseline.passed ||
        comparison.failedDelta !== comparison.selected.failed - comparison.baseline.failed ||
        !holdout || holdout.candidate !== selected || holdout.cases !== rounding.holdoutProfiles.length ||
        holdout.failed !== 0 || holdout.passed !== holdout.cases ||
        !c3FailureClassesValid(holdout.failuresByClass, 0) ||
        holdout.maxDelta !== rounding.holdoutMaxDelta?.[field] || holdout.maxDelta > selected) {
      throw new Error("C3: incomplete or inconsistent candidate/holdout metrics: " + field);
    }
  }
  if (Object.keys(rounding.failuresByClass || {}).length ||
      !["2", "7", "8", "17", "19", "22"].every(item =>
        Array.isArray(ready.blockers?.[item]) && ready.blockers[item].length) ||
      baseline.resolver?.id !== "food-intelligence-v2-domain-resolver" ||
      !["blocked", "failed", "sample_missing"].includes(baseline.gate) ||
      !c3BaselineConsistent(ready, baseline) ||
      !c3RepresentativityValid(ready, rounding)) {
    throw new Error("C3: incomplete or contradictory resolver baseline/readiness metrics");
  }
  return reports;
}

export function publishC3Evidence(log, directory, identity) {
  if (!/^[0-9a-f]{40}$/.test(identity.headSha) || identity.headSha !== identity.checkoutSha ||
      !/^[1-9]\d*$/.test(String(identity.runId)) || !identity.repository) {
    throw new Error("C3: invalid exact-HEAD run identity");
  }
  const report = {
    schemaVersion: 1, repository: identity.repository, materialHeadSha: identity.headSha,
    checkoutSha: identity.checkoutSha, runId: String(identity.runId),
    pullRequestNumber: identity.pullRequestNumber || null,
    producer: "Agent-first gate / Vitest 24-shard complete run",
    decision: "measured-only-never-promoted", reports: extractC3Evidence(log),
  };
  const bytes = JSON.stringify(report, null, 2) + "\n";
  const sha = createHash("sha256").update(bytes).digest("hex");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, "calibration-evidence.json"), bytes);
  writeFileSync(resolve(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, materialHeadSha: identity.headSha,
    runId: String(identity.runId), reportFile: "calibration-evidence.json",
    reportSha256: sha, markers: C3_EVIDENCE_MARKERS,
  }, null, 2) + "\n");
  if (createHash("sha256").update(readFileSync(resolve(directory, "calibration-evidence.json"))).digest("hex") !== sha) {
    throw new Error("C3: output integrity mismatch");
  }
  return sha;
}

async function main() {
  const logPath = process.env.VITEST_LOG_PATH || "/tmp/vitest.log";
  const start = now();
  mkdirSync(dirname(logPath), { recursive: true });
  writeFileSync(logPath, "");
  const abortController = new AbortController();
  const stop = () => abortController.abort();
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  const buffers = new Map();
  const result = await runShards({
    signal: abortController.signal,
    launch: (shard, output) => {
      buffers.set(shard, "");
      return spawnVitestShard(shard, output);
    },
    onProgress: (shard, chunk) => {
      buffers.set(shard, (buffers.get(shard) || "") + chunk);
    },
    onComplete: item => {
      const shard = item.shard;
      const entry = formatShardLog(item, buffers.get(shard) || "");
      appendFileSync(logPath, entry);
      console.log(entry.split("\n").find(line => line.startsWith("PASS:") || line.startsWith("FAIL:")));
      buffers.delete(shard);
    },
  });
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  const durationSec = ((now() - start) / 1000).toFixed(1);
  const summary = [
    "## Vitest shard telemetry",
    "",
    `- Exact HEAD: \`${process.env.VERIFICATION_HEAD_SHA || "unknown"}\``,
    `- Risk profile: \`${process.env.CI_RISK_PROFILE || "unknown"}\``,
    `- Total duration: ${durationSec}s`,
    `- Shards completed: ${result.results.length}/24`,
    `- Maximum simultaneous shards: ${result.maximumConcurrency}`,
    `- Result: ${result.success ? "PASS" : "FAIL"}`,
    `- Memory values: sampled peak descendant RSS (250ms sampling, not cgroup peak; unknown if unavailable)`,
    "",
    "| Shard | Status | Duration (s) | Peak sampled RSS (KiB) |",
    "| --- | --- | ---: | ---: |",
    ...[...result.results].sort((a, b) => a.shard - b.shard).map(item =>
      `| ${item.shard}/24 | ${item.exitCode === 0 ? "PASS" : "FAIL"} | ${(item.durationMs / 1000).toFixed(1)} | ${item.peakRssKb ?? "unknown"} |`),
    "",
  ].join("\n");
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  if (result.success && process.env.C3_EVIDENCE_OUTPUT_DIR) {
    const checkoutSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const digest = publishC3Evidence(readFileSync(logPath, "utf8"),
      process.env.C3_EVIDENCE_OUTPUT_DIR, {
        repository: process.env.GITHUB_REPOSITORY, headSha: process.env.VERIFICATION_HEAD_SHA,
        checkoutSha, runId: process.env.GITHUB_RUN_ID,
        pullRequestNumber: Number(process.env.C3_PR_NUMBER || 0),
      });
    console.log("C3_CALIBRATION_ARTIFACT sha256=" + digest + " head=" + checkoutSha);
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      "\n## C3 calibration evidence (#1306)\n\n- HEAD: " + checkoutSha +
      "\n- SHA-256: " + digest + "\n- Decision: measurements only; no threshold approved\n");
  }
  if (!result.success) {
    console.error(readFileSync(logPath, "utf8").split("\n").slice(-250).join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
