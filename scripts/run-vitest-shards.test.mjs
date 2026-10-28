import assert from "node:assert/strict";
import { test } from "node:test";
import { spawn } from "node:child_process";
import { runShards, formatShardLog, TERMINATION_GRACE_MS } from "./run-vitest-shards.mjs";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function fixture({ failures = [], durations = {}, interrupt } = {}) {
  const started = [];
  const ended = [];
  let running = 0;
  let peak = 0;
  const controller = new AbortController();
  const launch = shard => {
    started.push(shard);
    running++;
    peak = Math.max(peak, running);
    let finish;
    const done = new Promise(resolve => { finish = resolve; });
    const timer = setTimeout(() => {
      running--;
      ended.push(shard);
      finish({ exitCode: failures.includes(shard) ? 1 : 0, peakRssKb: null });
    }, durations[shard] ?? 3);
    return {
      done,
      kill: () => {
        clearTimeout(timer);
        running--;
        ended.push(shard);
        finish({ exitCode: 1, peakRssKb: null });
      },
    };
  };
  return { launch, started, ended, controller, getPeak: () => peak };
}

test("all 24 shards run exactly once with at most two active", async () => {
  const f = fixture();
  const result = await runShards({ launch: f.launch, signal: f.controller.signal });
  assert.equal(result.success, true);
  assert.equal(result.results.length, 24);
  assert.deepEqual([...f.started].sort((a, b) => a - b), Array.from({ length: 24 }, (_, i) => i + 1));
  assert.equal(new Set(f.ended).size, 24);
  assert.equal(f.getPeak(), 2);
  assert.equal(result.maximumConcurrency, 2);
});

test("replenishes first available slot before a slow sibling finishes", async () => {
  const f = fixture({ durations: { 1: 50, 2: 2, 3: 2, 4: 2 } });
  const result = await runShards({ total: 4, launch: f.launch });
  assert.equal(result.success, true);
  assert.ok(f.started.indexOf(3) < 0 || f.ended.indexOf(1) > f.ended.indexOf(3));
  assert.equal(f.getPeak(), 2);
});

for (const failures of [[1], [24], [1, 2], [5, 17]]) {
  test(`nonzero shard exits fail closed: ${failures.join(",")}`, async () => {
    const f = fixture({ failures });
    const result = await runShards({ launch: f.launch });
    assert.equal(result.success, false);
    assert.equal(result.results.length, 24);
    assert.equal(result.results.filter(x => x.exitCode !== 0).length, failures.length);
    assert.equal(f.started.length, 24);
  });
}

test("interruption kills children and does not launch the remaining queue", async () => {
  const f = fixture({ durations: { 1: 100, 2: 100 } });
  setTimeout(() => f.controller.abort(), 4);
  const result = await runShards({ launch: f.launch, signal: f.controller.signal });
  assert.equal(result.success, false);
  assert.equal(result.interrupted, true);
  assert.equal(f.started.length, 2);
  assert.equal(f.ended.length, 2);
});

test("launch exception is reported and later shards still run", async () => {
  const f = fixture();
  const result = await runShards({ total: 4, launch: shard => {
    if (shard === 3) throw new Error("spawn failed");
    return f.launch(shard);
  } });
  assert.equal(result.success, false);
  assert.equal(result.results.length, 4);
  assert.match(result.results[2].error, /spawn failed/);
});

test("consolidated diagnostics retain failure output and unknown RSS", () => {
  const entry = formatShardLog({ shard: 9, exitCode: 1, durationMs: 1500, peakRssKb: null }, "AssertionError: expected 3");
  assert.match(entry, /Vitest shard 9\/24/);
  assert.match(entry, /AssertionError: expected 3/);
  assert.match(entry, /FAIL:/);
  assert.match(entry, /unknown KiB/);
});

test("abort escalates TERM to KILL when child does not terminate", async () => {
  const controller = new AbortController();
  const signals = [];
  let childResolve;
  const child = { done: new Promise(resolve => {
    childResolve = resolve;
  }), kill: sig => {
    signals.push(sig);
    if (sig === "SIGKILL") childResolve({ exitCode: 1 });
  } };
  setTimeout(() => controller.abort(), 5);
  const result = await runShards({ total: 1, launch: () => child, signal: controller.signal });
  assert.equal(result.success, false);
  assert.deepEqual(signals.slice(-2), ["SIGTERM", "SIGKILL"]);
});

test("real child process ignores TERM, escalates to KILL and is reaped", { timeout: 8000 }, async () => {
  const controller = new AbortController();
  let pid;
  const delivered = [];
  const resultPromise = runShards({
    total: 1,
    signal: controller.signal,
    launch: () => {
      const proc = spawn(process.execPath, ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], {
        stdio: "ignore", detached: true,
      });
      pid = proc.pid;
      return {
        done: new Promise(resolve => proc.once("close", (code, signal) => resolve({ exitCode: signal ? 1 : code }))),
        kill: signal => { delivered.push(signal); try { process.kill(-pid, signal); } catch (e) { if (e.code !== "ESRCH") throw e; } },
      };
    },
  });
  // Give the child enough time to register its SIGTERM handler.
  await delay(250);
  controller.abort();
  const result = await resultPromise;
  assert.equal(result.interrupted, true);
  assert.equal(result.success, false);
  assert.equal(result.results.length, 1);
  assert.deepEqual(delivered, ["SIGTERM", "SIGKILL"]);
});
// #1306 / A-004: successful shards must leave reviewable C3 evidence, not
// only the PASS counters previously visible in successful GitHub jobs.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { C3_EVIDENCE_MARKERS, extractC3Evidence, publishC3Evidence } from "./run-vitest-shards.mjs";

const c3Fields = ["calories", "protein", "carbs", "fat"];
function c3Fixtures() {
  const metric = candidate => ({ candidate, cases: 2, passed: 2, failed: 0, maxDelta: 0, failuresByClass: {} });
  const grid = [0, 0.01, 0.1];
  const per = callback => Object.fromEntries(c3Fields.map(field => [field, callback(field)]));
  const rounding = {
    splitPolicy: "candidate-selected-from-calibration-before-holdout",
    baselinePolicy: "open-fail-closed-zero-divergence",
    calibrationProfiles: ["mortadela", "amendoim"], holdoutProfiles: ["iogurte", "pera"],
    candidates: { caloriesKcal: grid, macroGrams: grid },
    calibrationMaxDelta: per(() => 0), holdoutMaxDelta: per(() => 0), selectedTolerance: per(() => 0),
    calibrationCandidateMetrics: per(() => grid.map(metric)),
    comparisonToBaseline: per(() => ({ baselinePolicy: "open-fail-closed-zero-divergence",
      baseline: metric(0), selected: metric(0), passedDelta: 0, failedDelta: 0 })),
    holdoutSelectedMetrics: per(() => metric(0)), failuresByClass: {},
  };
  const ready = { blockers: Object.fromEntries(["2", "7", "8", "17", "19", "22"].map(item => [item, ["ground_truth_absent"]])) };
  const baseline = { resolver: { id: "food-intelligence-v2-domain-resolver" }, gate: "failed",
    failureClasses: { mismatch: 1 }, bySplit: [{ split: "acquisition" }, { split: "calibration" }, { split: "holdout" }] };
  return { [C3_EVIDENCE_MARKERS[0]]: rounding, [C3_EVIDENCE_MARKERS[1]]: ready,
    [C3_EVIDENCE_MARKERS[2]]: baseline };
}
function c3Log(reports = c3Fixtures()) {
  return Object.entries(reports).map(([marker, value], i) =>
    "--- Vitest shard " + (i + 1) + "/24 ---\nstdout | test\n" +
    marker + " " + JSON.stringify(value) + "\nPASS: Vitest shard " + (i + 1) + "/24")
    .join("\n");
}
const c3Identity = { repository: "crgasparoto-br/controle_calorias", headSha: "a".repeat(40),
  checkoutSha: "a".repeat(40), runId: "40674390083", pullRequestNumber: 1332 };

test("A-004 positive: all three measured C3 reports survive a passing CI in an exact-SHA artifact", () => {
  const dir = mkdtempSync(join(tmpdir(), "c3-artifact-"));
  try {
    const sha = publishC3Evidence(c3Log(), dir, c3Identity);
    const artifact = JSON.parse(readFileSync(join(dir, "calibration-evidence.json")));
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json")));
    assert.equal(manifest.reportSha256, sha);
    assert.equal(artifact.materialHeadSha, c3Identity.headSha);
    assert.equal(artifact.runId, c3Identity.runId);
    assert.equal(artifact.decision, "measured-only-never-promoted");
    assert.deepEqual(Object.keys(artifact.reports), C3_EVIDENCE_MARKERS);
    assert.equal(artifact.reports.C3_ITEM30_ROUNDING_CAMPAIGN.calibrationCandidateMetrics.calories.length, 3);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("A-004 negative: missing, duplicate or malformed marker blocks success", () => {
  const reports = c3Fixtures();
  assert.throws(() => extractC3Evidence(c3Log({ [C3_EVIDENCE_MARKERS[0]]: reports[C3_EVIDENCE_MARKERS[0]] })), /missing/);
  assert.throws(() => extractC3Evidence(c3Log() + "\n" + c3Log()), /duplicate/);
  assert.throws(() => extractC3Evidence(c3Log().replace(/C3_OPEN_EVIDENCE_READINESS \{[^\n]+/, "C3_OPEN_EVIDENCE_READINESS {broken}")), /invalid/);
});

test("A-004 negative: forged counts, holdout leakage and artificial approval fail closed", () => {
  const count = c3Fixtures();
  count.C3_ITEM30_ROUNDING_CAMPAIGN.calibrationCandidateMetrics.calories[1].passed = 99;
  assert.throws(() => extractC3Evidence(c3Log(count)), /inconsistent/);
  const overlap = c3Fixtures();
  overlap.C3_ITEM30_ROUNDING_CAMPAIGN.holdoutProfiles[0] = "mortadela";
  assert.throws(() => extractC3Evidence(c3Log(overlap)), /holdout/);
  const fake = c3Fixtures();
  fake.C3_REAL_RESOLVER_FIXTURE_BASELINE.gate = "passed";
  assert.throws(() => extractC3Evidence(c3Log(fake)), /falsely approved/);
  const wrongSchema = c3Fixtures();
  wrongSchema.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit = [
    { segment: "calibration" }, { segment: "holdout" }
  ];
  assert.throws(() => extractC3Evidence(c3Log(wrongSchema)), /incomplete readiness/);
});

test("A-004 regression: refuses stale SHA and preserves Vitest ANSI stdout", () => {
  assert.throws(() => publishC3Evidence(c3Log(), tmpdir(),
    { ...c3Identity, checkoutSha: "b".repeat(40) }), /exact-HEAD/);
  assert.deepEqual(extractC3Evidence(c3Log().replace("C3_ITEM30_ROUNDING_CAMPAIGN",
    "\u001b[32mC3_ITEM30_ROUNDING_CAMPAIGN\u001b[0m")), c3Fixtures());
});

test("A-004 regression: workflow uploads C3 artifact on success, never just failure diagnostics", () => {
  const workflow = readFileSync(new URL("../.github/workflows/agent-check.yml", import.meta.url), "utf8");
  const full = workflow.indexOf("      - name: Full tests\n");
  const upload = workflow.indexOf("      - name: Upload exact-HEAD C3 calibration evidence\n");
  assert.ok(full >= 0 && upload > full);
  const portion = workflow.slice(upload, workflow.indexOf("      - name: Upload Vitest diagnostics\n", upload));
  assert.match(portion, /uses: actions\/upload-artifact@v4/);
  assert.match(portion, /if-no-files-found: error/);
  assert.doesNotMatch(portion, /if: failure\(\)/);
  assert.match(workflow.slice(full, upload), /C3_EVIDENCE_OUTPUT_DIR: \/tmp\/food-v2-c3-calibration/);
});
