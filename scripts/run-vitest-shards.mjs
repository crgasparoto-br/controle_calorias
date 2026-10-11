#!/usr/bin/env node
import { spawn, execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const now = () => Date.now();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

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
    interrupted = true;
    for (const child of running) child.kill?.("SIGTERM");
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
        const result = await child.done;
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
    if (interrupted) for (const child of running) child.kill?.("SIGKILL");
  }
  return { results: results.filter(Boolean), interrupted, maximumConcurrency,
    success: !interrupted && results.every(result => result?.exitCode === 0) };
}

export function spawnVitestShard(number, output) {
  const child = spawn("pnpm", [
    "exec", "vitest", "run", `--shard=${number}/24`, "--maxWorkers=1", "--minWorkers=1",
  ], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
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
  return { pid: child.pid, done, kill: sig => child.kill(sig) };
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
      const duration = (item.durationMs / 1000).toFixed(1);
      const msg = `${item.exitCode === 0 ? "PASS" : "FAIL"}: Vitest shard ${shard}/24 (${duration}s; peak RSS sample: ${item.peakRssKb ?? "unknown"} KiB)\n`;
      appendFileSync(logPath, `--- Vitest shard ${shard}/24 ---\n${buffers.get(shard) || ""}\n${msg}`);
      console.log(msg.trim());
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
  if (!result.success) {
    console.error(readFileSync(logPath, "utf8").split("\n").slice(-250).join("\n"));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
