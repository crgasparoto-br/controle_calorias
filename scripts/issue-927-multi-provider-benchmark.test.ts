import { execFileSync } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { gunzipSync, gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  CAPABILITIES,
  buildReport,
  buildReportMetadata,
  derivePrivacyRegression,
  deriveSafetyRegression,
  executeScenario,
  readManifest,
  readTranscriptionEvidence,
  runSelfTest,
  summarize,
  validateManifest,
  verifyCommittedReport,
  type Manifest,
  type ScenarioObservation,
} from "./issue-927-multi-provider-benchmark";

const manifestPath = path.resolve(import.meta.dirname, "../docs/benchmarks/multi-provider/fixtures/manifest.json");
const reportPath = path.resolve(import.meta.dirname, "../docs/benchmarks/multi-provider/results/2026-08-06-executable-harness.json.gz");
const rolloutDecisionPath = path.resolve(import.meta.dirname, "../docs/benchmarks/multi-provider/results/2026-08-05-rollout-decision.json");
const clone = <T>(value: T): T => structuredClone(value);

function verificationHeadSha() {
  return process.env.VERIFICATION_HEAD_SHA
    ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

function blankObservation(overrides: Partial<ScenarioObservation> = {}): ScenarioObservation {
  return {
    id: "synthetic-empty-critical",
    capability: "EMBEDDING",
    tags: ["primary"],
    valid: true,
    checks: [],
    criticalPassed: 0,
    criticalTotal: 0,
    falsePositive: false,
    source: "not-required",
    latencyMs: 1,
    timedOut: false,
    unavailable: false,
    attempts: 1,
    fallback: "none",
    localDegradation: false,
    calls: 1,
    providerCalls: { openai: 1, "openai-compatible": 0, gemini: 0 },
    attemptDetails: [{ role: "primary", provider: "openai", model: "text-embedding-3-small", outcome: "success" }],
    fallbackCalls: 0,
    maxConcurrency: 1,
    deterministic: false,
    toolExecuted: false,
    toolUnits: 0,
    estimatedCostUsd: 0,
    safetyRegression: false,
    privacyRegression: false,
    ...overrides,
  };
}

describe("issue 927 executable multi-provider benchmark", () => {
  it("uses synthetic executable fixtures for every capability and required policy family", async () => {
    const manifest = await readManifest(manifestPath);
    expect(() => validateManifest(manifest)).not.toThrow();
    expect(new Set(manifest.requiredCapabilities)).toEqual(new Set(CAPABILITIES));
    expect(manifest.scenarios.length).toBeGreaterThanOrEqual(20);
    expect(manifest.privacy).toBe("synthetic-only");
    expect(manifest.scenarios.every(scenario => scenario.runner && scenario.expected)).toBe(true);
    expect(manifest.scenarios.every(scenario => !("latencyMs" in scenario))).toBe(true);
    expect(manifest.scenarios.every(scenario => !("valid" in scenario))).toBe(true);
    expect(CAPABILITIES.every(capability => Object.values(manifest.policyMatrix[capability]).every(
      definition => definition.applicable ? definition.scenarioIds.length > 0 : Boolean(definition.reason),
    ))).toBe(true);
  });

  it("rejects global-only policy coverage and cross-capability scenario references", async () => {
    const manifest = clone(await readManifest(manifestPath));
    manifest.policyMatrix.MEAL_VISION.primary.scenarioIds = ["meal-text-simple"];
    expect(() => validateManifest(manifest)).toThrow(/references scenario from MEAL_TEXT/);

    const missing = clone(await readManifest(manifestPath));
    missing.policyMatrix.MEAL_TEXT.retry = {
      applicable: false,
      scenarioIds: [],
      reason: "Incorrectly marked not applicable.",
    };
    expect(() => validateManifest(missing)).toThrow(/meal-policy-retry is not governed/);
  });

  it("rejects content-sensitive fixtures even when the key name is not on a raw-field denylist", async () => {
    const manifest = clone(await readManifest(manifestPath)) as Manifest & { notes?: string };
    manifest.notes = "Contato sintético indevido: person@example.com";
    expect(() => validateManifest(manifest)).toThrow(/email-like/);

    const nested = clone(await readManifest(manifestPath));
    nested.scenarios[0]!.input.unexpected = "sk-proj-abcdefghijklmnop";
    expect(() => validateManifest(nested)).toThrow(/secret-like/);
  });

  it("executes real boundaries and observes retry, fallback, blocked cross-provider and deterministic no-call", async () => {
    const manifest = await readManifest(manifestPath);
    const ids = [
      "meal-policy-retry",
      "meal-policy-same-provider-fallback",
      "meal-policy-cross-provider-blocked",
      "meal-policy-cross-provider-allowed",
      "intent-deterministic-command",
      "nutrition-search-verified",
      "embedding-degraded",
      "annotation-external-local",
    ];
    const results = [];
    for (const id of ids) {
      const scenario = manifest.scenarios.find(item => item.id === id);
      expect(scenario).toBeDefined();
      results.push(await executeScenario(scenario!));
    }

    expect(results.every(result => result.valid)).toBe(true);
    expect(results.find(result => result.id === "meal-policy-retry")?.attempts).toBe(2);
    expect(results.find(result => result.id === "meal-policy-same-provider-fallback")?.fallback).toBe("same-provider");
    expect(results.find(result => result.id === "meal-policy-cross-provider-blocked")?.providerCalls.gemini).toBe(0);
    expect(results.find(result => result.id === "meal-policy-cross-provider-allowed")?.fallback).toBe("cross-provider");
    expect(results.find(result => result.id === "intent-deterministic-command")?.calls).toBe(0);
    expect(results.every(result => result.maxConcurrency <= 1)).toBe(true);
  });

  it("executes pending, correction, replacement and deletion through persisted WhatsApp state", async () => {
    const manifest = await readManifest(manifestPath);
    const ids = ["intent-pending-operation", "intent-correction", "intent-replacement", "intent-deletion"];
    for (const id of ids) {
      const scenario = manifest.scenarios.find(item => item.id === id)!;
      const result = await executeScenario(scenario, manifest.rubric.WHATSAPP_INTENT.criticalChecks);
      const failedChecks = result.checks.filter(check => !check.passed);
      expect(result.valid, `${id}: ${JSON.stringify(failedChecks)}`).toBe(true);
      expect(result.calls).toBe(0);
      expect(result.checks).toContainEqual({ name: "tenant isolation", passed: true, category: "functional" });
    }
  });

  it("does not invent perfect critical accuracy when no critical evidence exists", () => {
    const summary = summarize("EMBEDDING", [blankObservation()]);
    expect(summary.criticalAccuracy).toBeNull();
  });

  it("derives safety and privacy regressions from executable evidence", () => {
    expect(deriveSafetyRegression([{ name: "security guard", passed: false, category: "safety" }])).toBe(true);
    expect(deriveSafetyRegression([{ name: "security guard", passed: true, category: "safety" }])).toBe(false);
    expect(derivePrivacyRegression({ prompt: "raw content must not enter evidence" })).toBe(true);
    expect(derivePrivacyRegression({ scenarioId: "sanitized-id" })).toBe(false);
  });

  it("fails a critical brand check when the provider returns a different brand", async () => {
    const manifest = await readManifest(manifestPath);
    const scenario = clone(manifest.scenarios.find(item => item.id === "meal-text-simple")!);
    const providerResult = scenario.providerPlan?.openai?.[0]?.result?.json as {
      items: Array<{ brand: string | null }>;
    };
    providerResult.items[0]!.brand = "Camil";
    const observation = await executeScenario(scenario, manifest.rubric.MEAL_TEXT.criticalChecks);
    expect(observation.valid).toBe(false);
    expect(observation.checks).toContainEqual({ name: "brand", passed: false, category: "functional" });
    expect(observation.criticalPassed).toBeLessThan(observation.criticalTotal);
  });

  it("builds a sanitized report from measured observations and keeps production changes disabled", async () => {
    const manifest = await readManifest(manifestPath);
    const report = await buildReport({
      manifest,
      testedSha: "test-sha",
      sourceTreeSha256: "test-tree",
      generatedAt: "2026-08-06T00:00:00.000Z",
    });

    expect(report.globalGates.passed).toBe(true);
    expect(report.productionChangesApplied).toBe(false);
    expect(report.coverage.observationCount).toBe(manifest.scenarios.length);
    expect(report.observations.every(item => item.checks.length > 0)).toBe(true);
    expect(report.observations.every(item => item.maxConcurrency <= 1)).toBe(true);
    expect(report.promotionDecisions.every(item => !item.fallbackEnabled)).toBe(true);
    expect(report.promotionDecisions.every(item => !item.crossProviderFallbackEnabled)).toBe(true);
    expect(report.capabilityGates.every(item => item.passed)).toBe(true);
    const transcription = report.promotionDecisions.find(item => item.capability === "TRANSCRIPTION");
    expect(transcription?.decision).toBe("keep-baseline");
    expect(transcription?.primaryModel).toBe("whisper-1");
    expect(report.rolloutDecision.status).toBe("paused-insufficient-evidence");
    expect(report.rolloutDecision.nextCapability).toBeNull();
    expect(report.transcriptionEvidence.promotionEligibility.reproducible).toBe(false);
    expect(report.transcriptionEvidence.promotionEligibility.failures).toEqual(expect.arrayContaining([
      "mutable-candidate-alias",
      "candidate-price-not-in-runtime-catalog",
      "comparison-price-catalog-version-mismatch",
    ]));
    const versionedRolloutDecision = JSON.parse(await readFile(rolloutDecisionPath, "utf8"));
    expect(versionedRolloutDecision.status).toBe(report.rolloutDecision.status);
    expect(versionedRolloutDecision.nextCapability).toBeNull();
    expect(versionedRolloutDecision.candidate).toBeNull();
    expect(JSON.stringify(report)).not.toMatch(/sk-proj-|inputText|outputText|base64|signedUrl|apiKey/i);
  });

  it("keeps the transcription baseline when live evidence only identifies a mutable alias", async () => {
    const evidence = await readTranscriptionEvidence();
    expect(evidence.status).toBe("available");
    expect(evidence.candidateModel).toBe("gpt-4o-mini-transcribe");
    expect(evidence.decision).toBe("keep-baseline");
    expect(evidence.promotionEligibility.reproducible).toBe(false);
    expect(evidence.promotionEligibility.failures).toEqual(expect.arrayContaining([
      "mutable-candidate-alias",
      "candidate-price-not-in-runtime-catalog",
      "comparison-price-catalog-version-mismatch",
    ]));
  });

  it("rejects an immutable transcription snapshot when the runtime catalog has no exact price", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "issue-927-transcription-evidence-"));
    try {
      const canonical = JSON.parse(await readFile(
        path.resolve(import.meta.dirname, "../docs/benchmarks/transcription/results/2026-08-04-af087f9b0c64.json"),
        "utf8",
      ));
      canonical.summary = canonical.summary.map((item: { model: string }) => item.model === "gpt-4o-mini-transcribe"
        ? { ...item, model: "gpt-4o-mini-transcribe-2025-12-15" }
        : item);
      canonical.priceCatalog.version = "2026-08-05.3";
      const evidencePath = path.join(directory, "snapshot.json");
      await writeFile(evidencePath, `${JSON.stringify(canonical, null, 2)}\n`, "utf8");
      const evidence = await readTranscriptionEvidence(evidencePath);
      expect(evidence.status).toBe("available");
      expect(evidence.candidateModel).toBe("gpt-4o-mini-transcribe-2025-12-15");
      expect(evidence.decision).toBe("keep-baseline");
      expect(evidence.promotionEligibility.reproducible).toBe(false);
      expect(evidence.promotionEligibility.failures).toEqual(["candidate-price-not-in-runtime-catalog"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("blocks promotion when a capability gate fails", async () => {
    const manifest = clone(await readManifest(manifestPath));
    const scenario = manifest.scenarios.find(item => item.id === "meal-text-simple")!;
    scenario.expected.brand = "Marca impossível";
    const report = await buildReport({
      manifest,
      testedSha: "test-sha",
      sourceTreeSha256: "test-tree",
      generatedAt: "2026-08-06T00:00:00.000Z",
    });
    expect(report.capabilityGates.find(item => item.capability === "MEAL_TEXT")?.passed).toBe(false);
    expect(report.promotionDecisions.find(item => item.capability === "MEAL_TEXT")?.decision)
      .toBe("blocked-by-capability-gates");
  });

  it("rejects a report whose decisions or metrics differ from deterministic regeneration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "issue-927-report-"));
    try {
      const manifest = await readManifest(manifestPath);
      const testedSha = verificationHeadSha();
      const report = await buildReport({ manifest, testedSha, generatedAt: "2026-08-06T00:00:00.000Z" });
      const tampered = clone(report);
      tampered.summaries[0]!.validOperationRate = 0;
      tampered.promotionDecisions[0]!.decision = "controlled-rollout-candidate";
      const temporaryReport = path.join(directory, "tampered.json.gz");
      const temporaryMetadata = path.join(directory, "tampered.metadata.json");
      const reportBytes = gzipSync(Buffer.from(`${JSON.stringify(tampered, null, 2)}\n`, "utf8"));
      await writeFile(temporaryReport, reportBytes);
      await writeFile(
        temporaryMetadata,
        `${JSON.stringify(buildReportMetadata({ reportPath: temporaryReport, reportBytes, report: tampered }), null, 2)}\n`,
        "utf8",
      );
      await expect(verifyCommittedReport(temporaryReport, manifestPath, temporaryMetadata))
        .rejects.toThrow(/differs from deterministic regeneration/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 20_000);

  it("rejects metadata that is not bound to the exact report bytes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "issue-927-metadata-"));
    try {
      const manifest = await readManifest(manifestPath);
      const testedSha = verificationHeadSha();
      const report = await buildReport({ manifest, testedSha, generatedAt: "2026-08-06T00:00:00.000Z" });
      const temporaryReport = path.join(directory, "report.json.gz");
      const temporaryMetadata = path.join(directory, "report.metadata.json");
      const reportBytes = gzipSync(Buffer.from(`${JSON.stringify(report, null, 2)}\n`, "utf8"));
      const metadata = buildReportMetadata({ reportPath: temporaryReport, reportBytes, report });
      metadata.reportSha256 = "0".repeat(64);
      await writeFile(temporaryReport, reportBytes);
      await writeFile(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
      await expect(verifyCommittedReport(temporaryReport, manifestPath, temporaryMetadata))
        .rejects.toThrow(/metadata does not bind/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("runs the full smoke and emits an exact-head report for publication", async () => {
    await expect(runSelfTest()).resolves.toBeUndefined();
    const manifest = await readManifest(manifestPath);
    const report = await buildReport({ manifest });
    const encoded = gzipSync(Buffer.from(`${JSON.stringify(report)}\n`, "utf8")).toString("base64");
    console.log(`ISSUE927_REPORT_GZIP_B64=${encoded}`);

    try {
      await access(reportPath);
      await expect(verifyCommittedReport(reportPath, manifestPath)).resolves.toBeUndefined();
      const committed = JSON.parse(gunzipSync(await readFile(reportPath)).toString("utf8"));
      expect(committed.globalGates.passed).toBe(true);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  });
});
