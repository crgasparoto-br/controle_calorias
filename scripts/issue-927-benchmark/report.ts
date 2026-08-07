import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ROLLBACK_READINESS,
  scanReportSafety,
  type Manifest,
} from "./contracts";
import * as core from "./report-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const DEFAULT_REPORT = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.json.gz");
const DEFAULT_METADATA = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.metadata.json");
const RESULT_PREFIX = "docs/benchmarks/multi-provider/results/";

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

async function hashExecutableSourceTree(): Promise<string> {
  const tracked = git(["ls-files", "-z"]).split("\0").filter(Boolean).filter(file => (
    !file.startsWith(RESULT_PREFIX)
    && !file.startsWith(".audit/")
    && file !== "docs/benchmarks/multi-provider/fixtures/manifest.json"
  ));
  tracked.push("docs/benchmarks/multi-provider/fixtures/manifest.json");
  const hash = createHash("sha256");
  for (const relative of [...new Set(tracked)].sort()) {
    const absolute = path.join(ROOT, relative);
    try {
      if (!(await stat(absolute)).isFile()) continue;
      hash.update(relative);
      hash.update("\0");
      hash.update(await readFile(absolute));
      hash.update("\0");
    } catch {
      hash.update(`${relative}\0<deleted>\0`);
    }
  }
  return hash.digest("hex");
}

export const readManifest = core.readManifest;
export const readTranscriptionEvidence = core.readTranscriptionEvidence;
export const summarize = core.summarize;

export async function buildReport(input: Parameters<typeof core.buildReport>[0]) {
  const report = await core.buildReport(input);
  const promotionDecisions = report.promotionDecisions.map(decision => ({
    ...decision,
    rollback: ROLLBACK_READINESS[decision.capability],
  }));
  const finalized = { ...report, promotionDecisions };
  scanReportSafety(finalized);
  return finalized;
}

export function buildReportMetadata(input: {
  reportPath: string;
  reportBytes: Buffer;
  report: Awaited<ReturnType<typeof buildReport>>;
}) {
  return core.buildReportMetadata({
    reportPath: input.reportPath,
    reportBytes: input.reportBytes,
    report: input.report as Awaited<ReturnType<typeof core.buildReport>>,
  });
}

export async function verifyCommittedReport(
  reportPath = DEFAULT_REPORT,
  manifestPath = DEFAULT_MANIFEST,
  metadataPath = DEFAULT_METADATA,
): Promise<void> {
  const encoded = await readFile(reportPath);
  const reportText = reportPath.endsWith(".gz") ? gunzipSync(encoded).toString("utf8") : encoded.toString("utf8");
  const committed = JSON.parse(reportText) as Awaited<ReturnType<typeof buildReport>>;
  scanReportSafety(committed);
  const actualHash = await hashExecutableSourceTree();
  const manifest = await readManifest(manifestPath);
  const verifiedHead = process.env.VERIFICATION_HEAD_SHA ?? git(["rev-parse", "HEAD"]);
  assert.match(committed.testedSha ?? "", /^[0-9a-f]{40}$/u, "committed report lacks a tested commit SHA");
  execFileSync("git", ["merge-base", "--is-ancestor", committed.testedSha!, verifiedHead], { cwd: ROOT });
  const delta = git(["diff", "--name-only", `${committed.testedSha}..${verifiedHead}`]).split("\n").filter(Boolean);
  assert.equal(
    delta.every(file => file.startsWith(RESULT_PREFIX)),
    true,
    `committed report tested a different executable tree: ${delta.join(", ")}`,
  );
  assert.equal(committed.sourceTreeSha256, actualHash, "committed report is stale for the executable source tree");
  assert.equal(committed.globalGates?.passed, true);
  assert.equal(committed.coverage?.observationCount, manifest.scenarios.length);
  assert.equal(committed.rubricVersion, manifest.rubricVersion);
  const regenerated = await buildReport({
    manifest,
    generatedAt: committed.generatedAt,
    testedSha: committed.testedSha,
    sourceTreeSha256: actualHash,
  });
  assert.deepEqual(committed, regenerated, "committed report differs from deterministic regeneration");

  const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as ReturnType<typeof buildReportMetadata>;
  assert.deepEqual(
    metadata,
    buildReportMetadata({ reportPath, reportBytes: encoded, report: committed }),
    "committed report metadata does not bind the exact report bytes and identity",
  );
}

export async function runSelfTest(): Promise<void> {
  const manifest = await readManifest();
  const report = await buildReport({
    manifest,
    testedSha: "self-test",
    sourceTreeSha256: "self-test-tree",
    generatedAt: "2026-08-06T00:00:00.000Z",
  });
  assert.equal(report.globalGates.passed, true);
  assert.equal(report.productionChangesApplied, false);
  assert.equal(report.coverage.observationCount, manifest.scenarios.length);
  assert.equal(report.promotionDecisions.every(item => !item.fallbackEnabled), true);
  assert.equal(report.promotionDecisions.every(item => !item.crossProviderFallbackEnabled), true);
  assert.equal(report.promotionDecisions.every(item => Object.keys(item.rollback).length > 0), true);
  assert.equal(report.observations.some(item => item.fallback === "same-provider"), true);
  assert.equal(report.observations.some(item => item.fallback === "cross-provider"), true);
  assert.equal(report.observations.filter(item => item.deterministic).every(item => item.calls === 0), true);
}
