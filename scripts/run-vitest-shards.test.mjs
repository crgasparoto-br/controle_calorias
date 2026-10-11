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
        kill: signal => { try { process.kill(-pid, signal); } catch (e) { if (e.code !== "ESRCH") throw e; } },
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
});
