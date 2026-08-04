import { performance } from "node:perf_hooks";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { isUsefulTranscriptionText } from "../server/_core/ai/domainAudioTranscription";
import { transcribeAudio } from "../server/_core/voiceTranscription";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const FIXTURE_DIR = path.join(ROOT, "docs/benchmarks/transcription/fixtures");
const execFileAsync = promisify(execFile);
const TIMEOUT_MS = 30_000;
const MODELS = [
  process.env.TRANSCRIPTION_BENCHMARK_WHISPER_MODEL?.trim() || "whisper-1",
  process.env.TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL?.trim() || "gpt-4o-mini-transcribe",
] as const;

const PRICE_CATALOG = {
  version: "2026-08-03",
  source: "OpenAI model catalog",
  whisper: { usdPerMinute: 0.006 },
  gpt4oMiniTranscribe: {
    usdPerMillionInputTokens: 1.25,
    usdPerMillionOutputTokens: 5,
  },
} as const;

const SAFE_FAILURE_REASONS = new Set([
  "timeout",
  "network",
  "rate_limit",
  "empty_output",
  "invalid_json",
  "invalid_payload",
  "missing_secret",
  "authentication",
  "model_not_found",
  "incompatible_operation",
  "safety_block",
  "invalid_configuration",
  "functional_result",
  "abort_not_acknowledged",
  "unknown",
]);

export type Fixture = {
  id: string;
  file: string;
  reference: string;
  criticalTerms: string[];
  scenario: string;
  mimeType: string;
  durationSeconds: number;
  encoding?: "base64";
};

export type Manifest = {
  schemaVersion: number;
  generatedAt: string;
  generator: string;
  privacy: string;
  fixtures: Fixture[];
};

export type SuccessfulResult = {
  fixtureId: string;
  model: string;
  status: "ok";
  latencyMs: number;
  usefulText: boolean;
  wordErrorRate: number;
  criticalTermRecall: number;
  segmentsPresent: boolean;
  attempts: number;
  usedFallback: boolean;
  estimatedCostUsd: number | null;
};

export type BenchmarkResult = SuccessfulResult | {
  fixtureId: string;
  model: string;
  status: "error";
  latencyMs: number;
  code: string;
  reason: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function levenshtein(left: string[], right: string[]): number {
  const rows = Array.from({ length: left.length + 1 }, () =>
    Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) rows[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) rows[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      rows[i][j] = Math.min(
        rows[i - 1][j] + 1,
        rows[i][j - 1] + 1,
        rows[i - 1][j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
  }
  return rows[left.length][right.length];
}

function wordErrorRate(reference: string, actual: string): number {
  const referenceWords = normalize(reference).split(" ").filter(Boolean);
  const actualWords = normalize(actual).split(" ").filter(Boolean);
  return referenceWords.length
    ? levenshtein(referenceWords, actualWords) / referenceWords.length
    : actualWords.length ? 1 : 0;
}

function isWhisperModel(model: string) {
  return model === "whisper-1" || model.startsWith("whisper-1-");
}

function estimateCostUsd(input: {
  model: string;
  durationSeconds: number | null;
  usage?: { inputTokens?: number; outputTokens?: number };
}): number | null {
  if (isWhisperModel(input.model)) {
    return input.durationSeconds === null
      ? null
      : (input.durationSeconds / 60) * PRICE_CATALOG.whisper.usdPerMinute;
  }
  if (!input.usage) return null;
  const price = PRICE_CATALOG.gpt4oMiniTranscribe;
  return ((input.usage.inputTokens ?? 0) / 1_000_000) * price.usdPerMillionInputTokens
    + ((input.usage.outputTokens ?? 0) / 1_000_000) * price.usdPerMillionOutputTokens;
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function rate(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

export function sanitizeFailureReason(details?: string): string {
  const match = details?.match(/(?:recoverable |classification )([a-z_]+)/u);
  const candidate = match?.[1] ?? "unknown";
  return SAFE_FAILURE_REASONS.has(candidate) ? candidate : "unknown";
}

export async function resolveTestedSha(
  env: NodeJS.ProcessEnv = process.env,
  cwd = ROOT,
): Promise<string> {
  const environmentSha = env.GITHUB_SHA?.trim();
  if (environmentSha) {
    if (!/^[a-f0-9]{40}$/u.test(environmentSha)) {
      throw new Error("GITHUB_SHA must contain the exact 40-character commit SHA.");
    }
    return environmentSha;
  }

  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8",
  });
  const gitSha = stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(gitSha)) {
    throw new Error("Unable to resolve the exact commit SHA for the benchmark result.");
  }
  return gitSha;
}

async function readFixtureAudio(fixture: Fixture): Promise<Buffer> {
  const raw = await readFile(path.join(FIXTURE_DIR, fixture.file));
  if (fixture.encoding !== "base64") return raw;

  const encoded = raw
    .toString("utf8")
    .split(/\r?\n/u)
    .filter(line => line.trim() && !line.startsWith("#"))
    .join("");
  return Buffer.from(encoded, "base64");
}

export function validateManifest(manifest: Manifest): void {
  if (manifest.privacy !== "synthetic-only") {
    throw new Error("Benchmark refuses fixtures that are not marked synthetic-only.");
  }
  if (!Array.isArray(manifest.fixtures) || manifest.fixtures.length === 0) {
    throw new Error("Transcription benchmark manifest must contain at least one fixture.");
  }
  const fixtureIds = new Set<string>();
  for (const fixture of manifest.fixtures) {
    if (!fixture.id.trim() || fixtureIds.has(fixture.id)) {
      throw new Error("Transcription benchmark fixture IDs must be unique and non-empty.");
    }
    fixtureIds.add(fixture.id);
    if (!fixture.file.trim() || !fixture.reference.trim()) {
      throw new Error(`Transcription benchmark fixture ${fixture.id} is incomplete.`);
    }
    if (!Array.isArray(fixture.criticalTerms) || fixture.criticalTerms.length === 0) {
      throw new Error(`Transcription benchmark fixture ${fixture.id} requires critical terms.`);
    }
    if (!Number.isFinite(fixture.durationSeconds) || fixture.durationSeconds <= 0) {
      throw new Error(`Transcription benchmark fixture ${fixture.id} has invalid duration.`);
    }
  }
}

export function summarize(
  results: BenchmarkResult[],
  models: readonly string[] = MODELS,
) {
  return models.map(model => {
    const modelResults = results.filter(result => result.model === model);
    const successful = modelResults.filter(
      (result): result is SuccessfulResult => result.status === "ok",
    );
    return {
      model,
      fixtures: modelResults.length,
      successRate: rate(successful.length, modelResults.length),
      usefulTextRate: rate(
        successful.filter(result => result.usefulText).length,
        modelResults.length,
      ),
      averageLatencyMs: average(successful.map(result => result.latencyMs)),
      averageWordErrorRate: average(successful.map(result => result.wordErrorRate)),
      averageCriticalTermRecall: average(successful.map(result => result.criticalTermRecall)),
      retryRate: rate(
        successful.filter(result => result.attempts > 1).length,
        modelResults.length,
      ),
      fallbackRate: rate(
        successful.filter(result => result.usedFallback).length,
        modelResults.length,
      ),
      segmentAvailabilityRate: rate(
        successful.filter(result => result.segmentsPresent).length,
        modelResults.length,
      ),
      estimatedTotalCostUsd: Number(successful.reduce(
        (sum, result) => sum + (result.estimatedCostUsd ?? 0),
        0,
      ).toFixed(8)),
    };
  });
}

export async function runBenchmark(outputPath?: string) {
  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error("OPENAI_API_KEY is required to execute the transcription benchmark.");
  }
  const manifest = JSON.parse(
    await readFile(path.join(FIXTURE_DIR, "manifest.json"), "utf8"),
  ) as Manifest;
  validateManifest(manifest);
  const testedSha = await resolveTestedSha();

  const results: BenchmarkResult[] = [];
  for (const model of MODELS) {
    for (const fixture of manifest.fixtures) {
      const audio = await readFixtureAudio(fixture);
      const started = performance.now();
      const result = await transcribeAudio(
        {
          audioBase64: audio.toString("base64"),
          mimeType: fixture.mimeType,
          language: "pt",
          prompt: "Transcreva em português do Brasil, preservando alimentos, marcas, números, pesos e unidades.",
        },
        {
          env: {
            ...process.env,
            AI_TRANSCRIPTION_PROVIDER: "openai",
            AI_TRANSCRIPTION_MODEL: model,
            AI_TRANSCRIPTION_TIMEOUT_MS: String(TIMEOUT_MS),
            AI_TRANSCRIPTION_MAX_ATTEMPTS: "1",
            AI_TRANSCRIPTION_FALLBACK_ENABLED: "false",
          },
        },
      );
      const latencyMs = Math.round(performance.now() - started);
      const durationSeconds = fixture.durationSeconds;
      if ("error" in result) {
        results.push({
          fixtureId: fixture.id,
          model,
          status: "error",
          code: result.code,
          reason: sanitizeFailureReason(result.details),
          latencyMs,
        });
        continue;
      }

      const normalizedText = normalize(result.text);
      const criticalMatches = fixture.criticalTerms.filter(term =>
        normalizedText.includes(normalize(term)));
      results.push({
        fixtureId: fixture.id,
        model,
        status: "ok",
        latencyMs,
        usefulText: isUsefulTranscriptionText(result.text),
        wordErrorRate: Number(wordErrorRate(fixture.reference, result.text).toFixed(4)),
        criticalTermRecall: Number(
          (criticalMatches.length / fixture.criticalTerms.length).toFixed(4),
        ),
        segmentsPresent: Object.prototype.hasOwnProperty.call(result, "segments"),
        attempts: result.execution.attempts,
        usedFallback: result.execution.usedFallback,
        estimatedCostUsd: estimateCostUsd({
          model,
          durationSeconds,
          usage: result.usage,
        }),
      });
    }
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    testedSha,
    fixtureManifest: "docs/benchmarks/transcription/fixtures/manifest.json",
    manifestMetadata: {
      generatedAt: manifest.generatedAt,
      generator: manifest.generator,
      privacy: manifest.privacy,
    },
    environment: {
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      cpuCount: os.cpus().length,
      provider: "openai",
      endpoint: "/v1/audio/transcriptions",
    },
    executionPolicy: {
      timeoutMs: TIMEOUT_MS,
      maxAttempts: 1,
      fallbackEnabled: false,
      sequential: true,
    },
    priceCatalog: PRICE_CATALOG,
    models: MODELS,
    limitations: [
      "Synthetic voices do not represent the full diversity of real PT-BR speech.",
      "Network latency and provider load vary between executions.",
      "Cost is estimated from duration or provider-reported token usage and the versioned price catalog.",
      "The harness does not persist audio, prompts, or returned transcripts in its result file.",
    ],
    summary: summarize(results),
    results,
  };
  if (outputPath) {
    await writeFile(path.resolve(outputPath), `${JSON.stringify(output, null, 2)}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  }
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT_PATH)) {
  runBenchmark(process.argv[2]).catch(error => {
    const message = error instanceof Error ? error.message : "benchmark failed";
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
