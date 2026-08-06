import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BASELINE,
  CAPABILITIES,
  scanReportSafety,
  validateManifest,
  type Capability,
  type Manifest,
  type ScenarioObservation,
} from "./contracts";
import { executeScenario } from "./execution";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const DEFAULT_REPORT = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.json");
const PRICE_CATALOG = path.join(ROOT, "docs/benchmarks/multi-provider/pricing-snapshot.json");
const TRANSCRIPTION_EVIDENCE = path.join(ROOT, "docs/benchmarks/transcription/results/2026-08-04-af087f9b0c64.json");
const RESULT_PREFIX = "docs/benchmarks/multi-provider/results/";

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
const rate = (yes: number, total: number) => total ? round(yes / total) : 0;

function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

export function summarize(capability: Capability, observations: ScenarioObservation[]) {
  const items = observations.filter(item => item.capability === capability);
  const criticalItems = items.filter(item => item.criticalTotal > 0);
  const criticalPassed = criticalItems.reduce((sum, item) => sum + item.criticalPassed, 0);
  const criticalTotal = criticalItems.reduce((sum, item) => sum + item.criticalTotal, 0);
  const sourceItems = items.filter(item => item.source !== "not-required");
  const deterministic = items.filter(item => item.deterministic);
  const valid = items.filter(item => item.valid);
  const unknownCost = items.some(item => item.calls > 0 && item.estimatedCostUsd === null);
  const totalCost = unknownCost ? null : round(items.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0), 8);
  return {
    capability,
    observations: items.length,
    validOperationRate: rate(valid.length, items.length),
    criticalAccuracy: criticalTotal > 0 ? rate(criticalPassed, criticalTotal) : null,
    falsePositiveRate: rate(items.filter(item => item.falsePositive).length, items.length),
    verifiedSourceRate: sourceItems.length
      ? rate(sourceItems.filter(item => item.source === "verified").length, sourceItems.length)
      : null,
    p50LatencyMs: percentile(items.map(item => item.latencyMs), 0.5),
    p95LatencyMs: percentile(items.map(item => item.latencyMs), 0.95),
    timeoutRate: rate(items.filter(item => item.timedOut).length, items.length),
    retryRate: rate(items.filter(item => item.tags.includes("retry") && item.attempts > 1).length, items.length),
    fallbackRate: rate(items.filter(item => item.fallback !== "none").length, items.length),
    unavailabilityRate: rate(items.filter(item => item.unavailable).length, items.length),
    deterministicNoCallPassRate: deterministic.length
      ? rate(deterministic.filter(item => item.calls === 0).length, deterministic.length)
      : null,
    estimatedTotalCostUsd: totalCost,
    estimatedCostPerValidOperationUsd: totalCost === null || !valid.length ? null : round(totalCost / valid.length, 8),
    safetyRegressions: items.filter(item => item.safetyRegression).length,
    privacyRegressions: items.filter(item => item.privacyRegression).length,
  };
}

export async function readTranscriptionEvidence(evidencePath = TRANSCRIPTION_EVIDENCE) {
  try {
    const data = JSON.parse(await readFile(evidencePath, "utf8")) as {
      testedSha?: string;
      summary?: Array<Record<string, number | string | null>>;
    };
    const baseline = data.summary?.find(item => item.model === "whisper-1");
    const candidate = data.summary?.find(item => item.model === "gpt-4o-mini-transcribe");
    if (!baseline || !candidate || !data.testedSha) throw new Error("incomplete evidence");
    const wins = candidate.successRate === 1
      && candidate.usefulTextRate === 1
      && Number(candidate.averageCriticalTermRecall) >= Number(baseline.averageCriticalTermRecall)
      && Number(candidate.averageWordErrorRate) <= Number(baseline.averageWordErrorRate)
      && Number(candidate.averageLatencyMs) <= Number(baseline.averageLatencyMs)
      && Number(candidate.estimatedTotalCostUsd) <= Number(baseline.estimatedTotalCostUsd);
    return {
      status: "available" as const,
      testedSha: data.testedSha,
      baselineModel: "whisper-1",
      candidateModel: "gpt-4o-mini-transcribe",
      decision: wins ? "controlled-rollout-candidate" as const : "keep-baseline" as const,
      baseline,
      candidate,
    };
  } catch {
    return {
      status: "unavailable" as const,
      testedSha: null,
      baselineModel: "whisper-1",
      candidateModel: "gpt-4o-mini-transcribe",
      decision: "keep-baseline" as const,
      baseline: null,
      candidate: null,
    };
  }
}

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

async function priceCatalogMetadata() {
  return JSON.parse(await readFile(PRICE_CATALOG, "utf8")) as { version: string; effectiveDate: string };
}

export async function buildReport(input: {
  manifest: Manifest;
  generatedAt?: string;
  testedSha?: string;
  sourceTreeSha256?: string;
  transcriptionEvidencePath?: string;
}) {
  validateManifest(input.manifest);
  const observations: ScenarioObservation[] = [];
  for (const scenario of input.manifest.scenarios) observations.push(await executeScenario(scenario));
  const summaries = CAPABILITIES.map(capability => summarize(capability, observations));
  const transcription = await readTranscriptionEvidence(input.transcriptionEvidencePath);
  const priceCatalog = await priceCatalogMetadata();
  const sourceTreeSha256 = input.sourceTreeSha256 ?? await hashExecutableSourceTree();
  const testedSha = input.testedSha ?? process.env.VERIFICATION_HEAD_SHA ?? git(["rev-parse", "HEAD"]);

  const gates = {
    allFunctionalScenariosPassed: observations.every(item => item.valid),
    deterministicNoExternalCalls: observations.filter(item => item.deterministic).every(item => item.calls === 0),
    sequentialSingleFallback: observations.every(item => item.maxConcurrency <= 1 && item.fallbackCalls <= 1),
    validPrimaryAvoidsFallback: observations.filter(item => item.tags.includes("primary")).every(item => item.fallback === "none"),
    crossProviderRequiresApproval: input.manifest.scenarios
      .filter(item => item.tags.includes("cross-provider-allowed"))
      .every(item => item.crossProviderApproved === true),
    noSafetyRegression: observations.every(item => !item.safetyRegression),
    noPrivacyRegression: observations.every(item => !item.privacyRegression),
    reportContainsNoRawContent: true,
  };

  const promotionDecisions = CAPABILITIES.map(capability => {
    const baseline = BASELINE[capability];
    if (capability === "IMAGE_ANNOTATION") return {
      capability,
      decision: "local-mode",
      primaryProvider: null,
      primaryModel: "local",
      fallbackEnabled: false,
      crossProviderFallbackEnabled: false,
      productionApplied: false,
      rollback: { AI_IMAGE_ANNOTATION_MODE: "local" },
    };
    if (capability === "FOOD_CLASSIFICATION") return {
      capability,
      decision: "embedded-no-separate-call",
      primaryProvider: null,
      primaryModel: baseline.model,
      fallbackEnabled: false,
      crossProviderFallbackEnabled: false,
      productionApplied: false,
      rollback: {},
    };
    const candidate = capability === "TRANSCRIPTION" && transcription.decision === "controlled-rollout-candidate";
    return {
      capability,
      decision: candidate ? "controlled-rollout-candidate" : "keep-baseline",
      primaryProvider: baseline.provider,
      primaryModel: candidate ? transcription.candidateModel : baseline.model,
      fallbackEnabled: false,
      crossProviderFallbackEnabled: false,
      productionApplied: false,
      rollback: capability === "TRANSCRIPTION"
        ? { AI_TRANSCRIPTION_PROVIDER: "openai", AI_TRANSCRIPTION_MODEL: "whisper-1" }
        : {},
    };
  });

  const report = {
    schemaVersion: 2,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    testedSha,
    identityModel: "tested-sha-plus-executable-source-tree",
    sourceTreeSha256,
    sourceTreeExcludes: [RESULT_PREFIX, ".audit/"],
    evidenceMode: "executable-hermetic-real-boundaries-with-versioned-live-transcription-comparison",
    privacy: "synthetic-fixtures-sanitized-metrics-only",
    productionChangesApplied: false,
    rubricVersion: input.manifest.rubricVersion,
    priceCatalog: {
      version: priceCatalog.version,
      effectiveDate: priceCatalog.effectiveDate,
      estimatedNotBilling: true,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      region: process.env.BENCHMARK_REGION || "local-hermetic",
      endpointClass: "deterministic-provider-adapters-no-network",
    },
    coverage: {
      capabilities: input.manifest.requiredCapabilities,
      tags: input.manifest.requiredTags,
      observationCount: observations.length,
    },
    operationDefinitions: input.manifest.rubric,
    rolloutDecision: {
      status: "paused-authorization-required",
      reason: "Production authorization was not granted for issue #927; operational execution remains in issue #962.",
      nextCapability: "TRANSCRIPTION",
      candidateModel: transcription.decision === "controlled-rollout-candidate" ? transcription.candidateModel : null,
      productionChangesApplied: false,
    },
    observations,
    summaries,
    transcriptionEvidence: transcription,
    promotionDecisions,
    globalGates: { ...gates, passed: Object.values(gates).every(Boolean) },
    limitations: [
      "Provider adapters are deterministic and make no network request; they exercise the real resolver, executor and domain boundaries.",
      "Only TRANSCRIPTION reuses a sanitized versioned live model comparison; other model promotions remain blocked without live comparative evidence.",
      "Cost is an estimate from the runtime catalog, not billing.",
      "Rollout and rollback in Render require explicit operational authorization and are tracked in issue #962.",
    ],
    reproduction: {
      command: "pnpm benchmark:ai:multi-provider",
      smokeCommand: "pnpm smoke:issue-927",
    },
  };
  scanReportSafety(report);
  return report;
}

export async function readManifest(manifestPath = DEFAULT_MANIFEST): Promise<Manifest> {
  const index = JSON.parse(await readFile(manifestPath, "utf8")) as Omit<Manifest, "scenarios"> & {
    scenarios?: Manifest["scenarios"];
    scenarioFiles?: string[];
  };
  if (index.scenarios) return index as Manifest;
  const directory = path.dirname(manifestPath);
  const scenarios = (await Promise.all((index.scenarioFiles ?? []).map(async file => (
    JSON.parse(await readFile(path.join(directory, file), "utf8")) as Manifest["scenarios"]
  )))).flat();
  const { scenarioFiles: _scenarioFiles, ...metadata } = index;
  return { ...metadata, scenarios } as Manifest;
}

export async function verifyCommittedReport(
  reportPath = DEFAULT_REPORT,
  manifestPath = DEFAULT_MANIFEST,
): Promise<void> {
  const committed = JSON.parse(await readFile(reportPath, "utf8")) as {
    testedSha?: string;
    sourceTreeSha256?: string;
    globalGates?: { passed?: boolean };
    coverage?: { observationCount?: number };
  };
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
  assert.equal(report.observations.some(item => item.fallback === "same-provider"), true);
  assert.equal(report.observations.some(item => item.fallback === "cross-provider"), true);
  assert.equal(report.observations.filter(item => item.deterministic).every(item => item.calls === 0), true);
}
