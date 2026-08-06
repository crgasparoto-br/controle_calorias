import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const TRANSCRIPTION_EVIDENCE = path.join(
  ROOT,
  "docs/benchmarks/transcription/results/2026-08-04-af087f9b0c64.json",
);

export const CAPABILITIES = [
  "MEAL_TEXT", "MEAL_VISION", "WHATSAPP_INTENT", "QUESTION", "NUTRITION_SEARCH",
  "EMBEDDING", "TRANSCRIPTION", "IMAGE_ANNOTATION", "FOOD_CLASSIFICATION",
] as const;
export type Capability = (typeof CAPABILITIES)[number];
type Fallback = "none" | "same-provider" | "cross-provider";

export type Scenario = {
  id: string;
  capability: Capability;
  tags: string[];
  valid?: boolean;
  primaryValid?: boolean;
  critical?: [number, number];
  falsePositive?: boolean;
  source?: "not-required" | "verified" | "unverified";
  latencyMs?: number;
  timedOut?: boolean;
  unavailable?: boolean;
  attempts?: number;
  fallback?: Fallback;
  crossApproved?: boolean;
  localDegradation?: boolean;
  calls?: number;
  concurrency?: number;
  deterministic?: boolean;
  tool?: "none" | "executed";
  toolUnits?: number;
  costUsd?: number | null;
  safetyRegression?: boolean;
  privacyRegression?: boolean;
};

export type Manifest = {
  schemaVersion: 1;
  generatedAt: string;
  privacy: "synthetic-only";
  license: string;
  rubricVersion: string;
  requiredCapabilities: Capability[];
  requiredTags: string[];
  rubric: Record<Capability, { validOperation: string; criticalChecks: string[] }>;
  scenarios: Scenario[];
};

const FORBIDDEN_KEYS = new Set([
  "prompt", "inputText", "outputText", "transcript", "transcription", "audio", "image",
  "media", "base64", "raw", "response", "reasoning", "authorization", "apiKey", "secret",
  "signedUrl",
]);
const BASELINE: Record<Capability, { provider: string | null; model: string | null }> = {
  MEAL_TEXT: { provider: "openai", model: "gpt-4.1-mini" },
  MEAL_VISION: { provider: "openai", model: "gpt-4.1-mini" },
  WHATSAPP_INTENT: { provider: "openai", model: "gpt-4.1-mini" },
  QUESTION: { provider: "openai", model: "gpt-4.1-mini" },
  NUTRITION_SEARCH: { provider: "openai", model: "gpt-4.1-mini" },
  EMBEDDING: { provider: "openai", model: "text-embedding-3-small" },
  TRANSCRIPTION: { provider: "openai", model: "whisper-1" },
  IMAGE_ANNOTATION: { provider: null, model: "local" },
  FOOD_CLASSIFICATION: { provider: null, model: "embedded-in-meal-structured-output" },
};

function scanKeys(value: unknown, at = "manifest"): void {
  if (Array.isArray(value)) return value.forEach((item, index) => scanKeys(item, `${at}[${index}]`));
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error(`${at} contains forbidden sensitive key ${key}`);
    scanKeys(nested, `${at}.${key}`);
  }
}

export function validateManifest(manifest: Manifest): void {
  scanKeys(manifest);
  if (manifest.schemaVersion !== 1 || manifest.rubricVersion !== "2026-08-05.1") {
    throw new Error("unsupported benchmark contract");
  }
  if (manifest.privacy !== "synthetic-only" || !manifest.license.trim()) {
    throw new Error("benchmark fixtures must be synthetic and licensed");
  }
  for (const capability of manifest.requiredCapabilities) {
    const definition = manifest.rubric?.[capability];
    if (!definition?.validOperation.trim() || !definition.criticalChecks.length) {
      throw new Error(`missing versioned rubric for ${capability}`);
    }
  }
  const ids = new Set<string>();
  const capabilities = new Set<Capability>();
  const tags = new Set<string>();
  for (const item of manifest.scenarios) {
    if (!item.id.trim() || ids.has(item.id)) throw new Error("scenario IDs must be unique");
    ids.add(item.id);
    capabilities.add(item.capability);
    item.tags.forEach(tag => tags.add(tag));
    const calls = item.calls ?? 1;
    const fallback = item.fallback ?? "none";
    const primaryValid = item.primaryValid ?? true;
    if ((item.latencyMs ?? 0) < 0 || calls < 0 || (item.attempts ?? 1) < 0) {
      throw new Error(`${item.id} has invalid numeric evidence`);
    }
    if (item.deterministic && calls !== 0) throw new Error(`${item.id} deterministic flow called a provider`);
    if (fallback !== "none" && calls < 2) throw new Error(`${item.id} fallback lacks an outbound call`);
    if ((item.concurrency ?? 1) > 1) throw new Error(`${item.id} provider calls ran in parallel`);
    if (primaryValid && fallback !== "none") throw new Error(`${item.id} fell back after a valid primary result`);
    if (item.localDegradation && fallback !== "none") throw new Error(`${item.id} counted local degradation as fallback`);
    if (fallback === "cross-provider" && !item.crossApproved) {
      throw new Error(`${item.id} cross-provider fallback lacks explicit approval`);
    }
    if ((item.tool ?? "none") === "none" && (item.toolUnits ?? 0) !== 0) {
      throw new Error(`${item.id} billed a tool that did not execute`);
    }
  }
  for (const capability of manifest.requiredCapabilities) {
    if (!capabilities.has(capability)) throw new Error(`missing capability ${capability}`);
  }
  for (const tag of manifest.requiredTags) if (!tags.has(tag)) throw new Error(`missing tag ${tag}`);
}

const round = (value: number, digits = 6) => Math.round(value * 10 ** digits) / 10 ** digits;
const rate = (yes: number, total: number) => total ? round(yes / total) : 0;
function percentile(values: number[], quantile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(quantile * sorted.length) - 1)] ?? null;
}

function summarize(capability: Capability, scenarios: Scenario[]) {
  const items = scenarios.filter(item => item.capability === capability);
  const criticalPassed = items.reduce((sum, item) => sum + (item.critical?.[0] ?? 1), 0);
  const criticalTotal = items.reduce((sum, item) => sum + (item.critical?.[1] ?? 1), 0);
  const sourceItems = items.filter(item => item.source && item.source !== "not-required");
  const deterministic = items.filter(item => item.deterministic);
  const valid = items.filter(item => item.valid !== false);
  const unknownCost = items.some(item => (item.calls ?? 1) > 0 && item.costUsd === null);
  const totalCost = unknownCost ? null : round(items.reduce((sum, item) => sum + (item.costUsd ?? 0), 0), 8);
  return {
    capability,
    observations: items.length,
    validOperationRate: rate(valid.length, items.length),
    criticalAccuracy: rate(criticalPassed, criticalTotal),
    falsePositiveRate: rate(items.filter(item => item.falsePositive).length, items.length),
    verifiedSourceRate: sourceItems.length
      ? rate(sourceItems.filter(item => item.source === "verified").length, sourceItems.length)
      : null,
    p50LatencyMs: percentile(items.map(item => item.latencyMs ?? 0), 0.5),
    p95LatencyMs: percentile(items.map(item => item.latencyMs ?? 0), 0.95),
    timeoutRate: rate(items.filter(item => item.timedOut).length, items.length),
    retryRate: rate(items.filter(item => (item.attempts ?? 1) > 1).length, items.length),
    fallbackRate: rate(items.filter(item => (item.fallback ?? "none") !== "none").length, items.length),
    unavailabilityRate: rate(items.filter(item => item.unavailable).length, items.length),
    deterministicNoCallPassRate: deterministic.length
      ? rate(deterministic.filter(item => (item.calls ?? 1) === 0).length, deterministic.length)
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
    const wins = candidate.successRate === 1 && candidate.usefulTextRate === 1 &&
      Number(candidate.averageCriticalTermRecall) >= Number(baseline.averageCriticalTermRecall) &&
      Number(candidate.averageWordErrorRate) <= Number(baseline.averageWordErrorRate) &&
      Number(candidate.averageLatencyMs) <= Number(baseline.averageLatencyMs) &&
      Number(candidate.estimatedTotalCostUsd) <= Number(baseline.estimatedTotalCostUsd);
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

export async function buildReport(input: {
  manifest: Manifest;
  testedSha: string;
  sourceTreeSha256: string;
  priceCatalogVersion: string;
  priceCatalogEffectiveDate: string;
  generatedAt?: string;
  transcriptionEvidencePath?: string;
}) {
  validateManifest(input.manifest);
  const summaries = CAPABILITIES.map(capability => summarize(capability, input.manifest.scenarios));
  const transcription = await readTranscriptionEvidence(input.transcriptionEvidencePath);
  const gates = {
    deterministicNoExternalCalls: input.manifest.scenarios.filter(item => item.deterministic)
      .every(item => (item.calls ?? 1) === 0),
    sequentialSingleFallback: input.manifest.scenarios.every(item =>
      (item.concurrency ?? 1) <= 1 &&
      ((item.fallback ?? "none") === "none" || (item.calls ?? 1) <= (item.attempts ?? 1) + 1)),
    validPrimaryAvoidsFallback: input.manifest.scenarios.filter(item => item.primaryValid ?? true)
      .every(item => (item.fallback ?? "none") === "none"),
    crossProviderRequiresApproval: input.manifest.scenarios.filter(item => item.fallback === "cross-provider")
      .every(item => item.crossApproved),
    noSafetyRegression: input.manifest.scenarios.every(item => !item.safetyRegression),
    noPrivacyRegression: input.manifest.scenarios.every(item => !item.privacyRegression),
  };
  const promotionDecisions = CAPABILITIES.map(capability => {
    const baseline = BASELINE[capability];
    if (capability === "IMAGE_ANNOTATION") return {
      capability, decision: "local-mode", primaryProvider: null, primaryModel: "local",
      fallbackEnabled: false, crossProviderFallbackEnabled: false, productionApplied: false,
      rollback: { AI_IMAGE_ANNOTATION_MODE: "local" },
    };
    if (capability === "FOOD_CLASSIFICATION") return {
      capability, decision: "embedded-no-separate-call", primaryProvider: null,
      primaryModel: baseline.model, fallbackEnabled: false, crossProviderFallbackEnabled: false,
      productionApplied: false, rollback: {},
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
  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    testedSha: input.testedSha,
    sourceTreeSha256: input.sourceTreeSha256,
    evidenceMode: "hermetic-with-versioned-live-transcription-evidence",
    privacy: "synthetic-only-no-raw-content",
    productionChangesApplied: false,
    rubricVersion: input.manifest.rubricVersion,
    priceCatalog: { version: input.priceCatalogVersion, effectiveDate: input.priceCatalogEffectiveDate, estimatedNotBilling: true },
    environment: { node: process.version, platform: process.platform, architecture: process.arch,
      region: process.env.BENCHMARK_REGION || "local-hermetic",
      endpointClass: process.env.BENCHMARK_ENDPOINT_CLASS || "no-live-endpoint" },
    coverage: { capabilities: input.manifest.requiredCapabilities, tags: input.manifest.requiredTags,
      observationCount: input.manifest.scenarios.length },
    operationDefinitions: input.manifest.rubric,
    rolloutDecision: {
      status: "paused-authorization-required",
      reason: "Production authorization was not granted for issue #927.",
      nextCapability: "TRANSCRIPTION",
      candidateModel: transcription.decision === "controlled-rollout-candidate"
        ? transcription.candidateModel
        : null,
      productionChangesApplied: false,
    },
    summaries,
    transcriptionEvidence: transcription,
    promotionDecisions,
    globalGates: { ...gates, passed: Object.values(gates).every(Boolean) },
    limitations: [
      "No Render variable, secret, provider or production model was changed.",
      "Only TRANSCRIPTION reuses sanitized, versioned live evidence; other capability evidence is hermetic.",
      "Cost is an estimate from a versioned catalog, not billing.",
      "Cross-provider remains disabled pending live evidence, LGPD review and explicit authorization.",
    ],
    reproduction: { command: "pnpm benchmark:ai:multi-provider" },
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

export async function runSelfTest(): Promise<void> {
  const manifest = JSON.parse(await readFile(DEFAULT_MANIFEST, "utf8")) as Manifest;
  const report = await buildReport({ manifest, testedSha: "self-test", sourceTreeSha256: "self-test",
    priceCatalogVersion: "2026-08-05.4", priceCatalogEffectiveDate: "2026-08-05",
    generatedAt: "2026-08-05T00:00:00.000Z" });
  assert.equal(report.globalGates.passed, true);
  assert.equal(report.productionChangesApplied, false);
  assert.equal(report.coverage.observationCount, 32);
  assert.equal(report.promotionDecisions.every(item => !item.fallbackEnabled), true);
}

async function main() {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
    process.stdout.write("issue-927 benchmark self-test passed\n");
    return;
  }
  const manifest = JSON.parse(await readFile(arg("--manifest") || DEFAULT_MANIFEST, "utf8")) as Manifest;
  const report = await buildReport({
    manifest,
    testedSha: arg("--tested-sha") || process.env.ISSUE_927_TESTED_SHA || "uncommitted",
    sourceTreeSha256: arg("--source-tree-sha256") || process.env.ISSUE_927_SOURCE_TREE_SHA256 || "unavailable",
    priceCatalogVersion: arg("--price-catalog-version") || "2026-08-05.4",
    priceCatalogEffectiveDate: arg("--price-catalog-effective-date") || "2026-08-05",
  });
  const output = `${JSON.stringify(report, null, 2)}\n`;
  const outputPath = arg("--output");
  if (outputPath) await writeFile(outputPath, output, "utf8"); else process.stdout.write(output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
