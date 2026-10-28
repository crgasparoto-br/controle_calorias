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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { C3_EVIDENCE_MARKERS, C3_ROUNDING_PREREGISTERED_PROFILES, extractC3Evidence, publishC3Evidence } from "./run-vitest-shards.mjs";

const c3Fields = ["calories", "protein", "carbs", "fat"];
function c3Fixtures() {
  const caseIds = foods => foods.flatMap(food => [30, 125, 750].map(grams => food + "@" + grams + "g"));
  const calibrationFoodProfiles = [...C3_ROUNDING_PREREGISTERED_PROFILES.calibration];
  const holdoutFoodProfiles = [...C3_ROUNDING_PREREGISTERED_PROFILES.holdout];
  const metric = candidate => ({ candidate, cases: 36, passed: 36, failed: 0, maxDelta: 0, failuresByClass: {} });
  const grid = [0, 0.01, 0.1];
  const per = callback => Object.fromEntries(c3Fields.map(field => [field, callback(field)]));
  const rounding = {
    splitPolicy: "candidate-selected-from-calibration-before-holdout",
    baselinePolicy: "open-fail-closed-zero-divergence",
    cohortRevision: "c3-rounding-expanded-v2",
    quantityGrams: [30, 125, 750], calibrationFoodProfiles, holdoutFoodProfiles,
    calibrationProfiles: caseIds(calibrationFoodProfiles),
    holdoutProfiles: caseIds(holdoutFoodProfiles),
    candidates: { caloriesKcal: grid, macroGrams: grid },
    calibrationMaxDelta: per(() => 0), holdoutMaxDelta: per(() => 0), selectedTolerance: per(() => 0),
    calibrationCandidateMetrics: per(() => grid.map(metric)),
    comparisonToBaseline: per(() => ({ baselinePolicy: "open-fail-closed-zero-divergence",
      baseline: metric(0), selected: metric(0), passedDelta: 0, failedDelta: 0 })),
    holdoutSelectedMetrics: per(() => metric(0)), failuresByClass: {},
    exploratoryModalityDiagnostics: ["audio_transcript", "image"].map(modality => ({
      modality, inputKind: modality === "image" ? "synthetic_caption" : "synthetic_transcript",
      candidateSelection: "excluded", bySplit: {
        calibration: { cases: 36, maxDelta: per(() => 0) },
        holdout: { cases: 36, maxDelta: per(() => 0) },
      },
    })),
  };
  const splits = { acquisition: 3, calibration: 65, holdout: 7 };
  const ready = { corpusCases: 75, splits,
    representativity: {
      source: "golden-food-corpus-synthetic", corpusVersion: "golden-2026-10-06.2",
      byModality: { text: 65, audio_transcript: 3, image: 5, multimodal: 2 },
      labeledBrandedCases: 1, roundingBrandedProfiles: 0,
      roundingNutritionSource: "TACO_4E",
      productionDecision: "blocked-no-independent-representative-evidence",
      untestedDimensions: ["real_asr", "real_vision_ocr", "branded_nutrition",
        "population_sampling", "independent_nominal_approval"],
    },
    blockers: Object.fromEntries(["2", "7", "8", "17", "19", "22"].map(item => [item, ["ground_truth_absent"]])) };
  const baseline = { resolver: { id: "food-intelligence-v2-domain-resolver" },
    corpusVersion: "golden-2026-10-06.2", gate: "failed", calls: 75,
    failureClasses: { mismatch: 75 }, bySplit: Object.entries(splits).map(([split, cases]) => ({
      split, cases, resolvableLabeled: cases, matchedCases: 0,
      failedCases: cases, abstentions: 0, matchRate: 0,
    })) };
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
  overlap.C3_ITEM30_ROUNDING_CAMPAIGN.holdoutProfiles[0] = overlap.C3_ITEM30_ROUNDING_CAMPAIGN.calibrationProfiles[0];
  assert.throws(() => extractC3Evidence(c3Log(overlap)), /holdout/);
  const fake = c3Fixtures();
  fake.C3_REAL_RESOLVER_FIXTURE_BASELINE.gate = "passed";
  assert.throws(() => extractC3Evidence(c3Log(fake)), /contradictory/);
  const wrongSchema = c3Fixtures();
  wrongSchema.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit = [
    { segment: "calibration" }, { segment: "holdout" }
  ];
  assert.throws(() => extractC3Evidence(c3Log(wrongSchema)), /contradictory/);
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

// A-005 (audit-rejection:027b0bf6-a235-40cb-8f20-bd29d50d9d32):
// validate measurements before generating a cryptographically valid artifact.
function assertC3MutationBlocked(mutate) {
  const reports = c3Fixtures();
  mutate(reports);
  const log = c3Log(reports);
  assert.throws(() => extractC3Evidence(log), /C3: (incomplete|contradictory|invalid independent)/);
  const dir = mkdtempSync(join(tmpdir(), "c3-fail-closed-"));
  try {
    assert.throws(() => publishC3Evidence(log, dir, c3Identity), /C3: (incomplete|contradictory|invalid independent)/);
    assert.equal(existsSync(join(dir, "calibration-evidence.json")), false);
    assert.equal(existsSync(join(dir, "manifest.json")), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

const a005Mutations = [
  ["zero-tolerance reports success above observed delta", reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    rounding.calibrationMaxDelta.calories = 0.005;
    for (const row of rounding.calibrationCandidateMetrics.calories) row.maxDelta = 0.005;
    rounding.selectedTolerance.calories = 0.01;
    rounding.comparisonToBaseline.calories.baseline = structuredClone(rounding.calibrationCandidateMetrics.calories[0]);
    rounding.comparisonToBaseline.calories.selected = structuredClone(rounding.calibrationCandidateMetrics.calories[1]);
    rounding.holdoutSelectedMetrics.calories.candidate = 0.01;
  }],
  ["positive failure count with delta within candidate", reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    Object.assign(rounding.calibrationCandidateMetrics.protein[1], {
      passed: 1, failed: 1, failuresByClass: { rounding_delta: 1 },
    });
  }],
  ["invalid candidate failure class counts", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.calibrationCandidateMetrics.fat[2].failuresByClass = { rounding_delta: -1 };
  }],
  ["holdout claims failure class after reporting zero failures", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.holdoutSelectedMetrics.carbs.failuresByClass = { rounding_delta: 1 };
  }],
  ["zero resolver calls with failed corpus cases", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.calls = 0;
  }],
  ["failed corpus cases with empty failure classes", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.failureClasses = {};
  }],
  ["readiness corpus total contradicts measured splits", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.corpusCases = 1;
  }],
  ["readiness split counts contradict measured cases", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.splits.calibration = 3;
  }],
  ["duplicate split hides holdout cases", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[2].split = "calibration";
  }],
  ["baseline cases do not reconcile with passed and failed", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[0].failedCases = 0;
  }],
  ["baseline negative failure class count", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.failureClasses.mismatch = -1;
  }],
  ["baseline invalid match-rate denominator", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[1].matchRate = 1.5;
  }],
  ["claimed resolvable match exceeds total matched cases", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[1].matchRate = 0.5;
  }],
  ["failure classes undercount failed cases", reports => {
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.failureClasses.mismatch = 1;
  }],
  ["food profile leaks across calibration and holdout via another quantity", reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    const leakedFood = rounding.calibrationFoodProfiles[0];
    const oldFood = rounding.holdoutFoodProfiles[0];
    rounding.holdoutFoodProfiles[0] = leakedFood;
    rounding.holdoutProfiles = rounding.holdoutProfiles.map(caseId =>
      caseId.startsWith(oldFood + "@") ? caseId.replace(oldFood + "@", leakedFood + "@") : caseId);
  }],
  ["one measured quantity pair silently disappears", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.calibrationProfiles.pop();
  }],
  ["a food profile is duplicated under another candidate label", reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    rounding.calibrationFoodProfiles[1] = rounding.calibrationFoodProfiles[0];
  }],
];

for (const [label, mutate] of a005Mutations) {
  test("A-005: inconsistent calibration and baseline evidence fails closed: " + label, () => {
    assertC3MutationBlocked(mutate);
  });
}

test("A-007: replacing a calibration profile with another valid TACO food fails closed", () => {
  assertC3MutationBlocked(reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    const original = rounding.calibrationFoodProfiles[0];
    const replacement = "taco-abacaxi-cru";
    rounding.calibrationFoodProfiles[0] = replacement;
    rounding.calibrationProfiles = rounding.calibrationProfiles.map(id =>
      id.startsWith(original + "@") ? id.replace(original + "@", replacement + "@") : id);
  });
});

test("A-007: replacing a holdout profile with another valid TACO food fails closed", () => {
  assertC3MutationBlocked(reports => {
    const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
    const original = rounding.holdoutFoodProfiles[0];
    const replacement = "taco-cenoura-crua";
    rounding.holdoutFoodProfiles[0] = replacement;
    rounding.holdoutProfiles = rounding.holdoutProfiles.map(id =>
      id.startsWith(original + "@") ? id.replace(original + "@", replacement + "@") : id);
  });
});

for (const [label, mutate] of [
  ["false claim of production eligibility", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.productionDecision = "approved";
  }],
  ["unreported image cases from synthetic corpus", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.byModality.image = 0;
  }],
  ["wrong reported modality total", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.byModality.text += 1;
  }],
  ["same total but forged modality distribution", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.byModality.text += 1;
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.byModality.image -= 1;
  }],
  ["invented corpus version", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.corpusVersion = "golden-new";
  }],
  ["same total but forged corpus split", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.splits.calibration += 1;
    reports.C3_OPEN_EVIDENCE_READINESS.splits.holdout -= 1;
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[1].cases += 1;
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[1].failedCases += 1;
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[2].cases -= 1;
    reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.bySplit[2].failedCases -= 1;
  }],
  ["fabricated branded coverage", reports => {
    reports.C3_OPEN_EVIDENCE_READINESS.representativity.roundingBrandedProfiles = 1;
  }],
  ["one diagnostic modality missing", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.exploratoryModalityDiagnostics.pop();
  }],
  ["diagnostic counts were inflated", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.exploratoryModalityDiagnostics[0].bySplit.holdout.cases += 1;
  }],
  ["supplementary modality silently used for candidate selection", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.exploratoryModalityDiagnostics[1].candidateSelection = "included";
  }],
  ["audio diagnostic hides macro divergence", reports => {
    reports.C3_ITEM30_ROUNDING_CAMPAIGN.exploratoryModalityDiagnostics[0].bySplit.calibration.maxDelta.protein = 0.2;
  }],
]) {
  test("RISK-001: misrepresented coverage fails closed: " + label, () => {
    assertC3MutationBlocked(mutate);
  });
}

test("A-005: legitimate nonzero delta and multi-label baseline classes still publish", () => {
  const reports = c3Fixtures();
  const rounding = reports.C3_ITEM30_ROUNDING_CAMPAIGN;
  rounding.calibrationMaxDelta.calories = 0.005;
  for (const row of rounding.calibrationCandidateMetrics.calories) {
    row.maxDelta = 0.005;
    if (row.candidate < 0.005) Object.assign(row, {
      passed: 35, failed: 1, failuresByClass: { rounding_delta: 1 },
    });
  }
  rounding.selectedTolerance.calories = 0.01;
  rounding.comparisonToBaseline.calories.baseline = structuredClone(rounding.calibrationCandidateMetrics.calories[0]);
  rounding.comparisonToBaseline.calories.selected = structuredClone(rounding.calibrationCandidateMetrics.calories[1]);
  rounding.comparisonToBaseline.calories.passedDelta = 1;
  rounding.comparisonToBaseline.calories.failedDelta = -1;
  rounding.holdoutSelectedMetrics.calories.candidate = 0.01;
  // Multiple failures can belong to one case; do not sum baseline classes as if disjoint.
  reports.C3_REAL_RESOLVER_FIXTURE_BASELINE.failureClasses.other = 8;
  const dir = mkdtempSync(join(tmpdir(), "c3-valid-nonzero-"));
  try {
    const sha = publishC3Evidence(c3Log(reports), dir, c3Identity);
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    assert.equal(sha, manifest.reportSha256);
    assert.equal(extractC3Evidence(c3Log(reports)).C3_ITEM30_ROUNDING_CAMPAIGN.selectedTolerance.calories, 0.01);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
