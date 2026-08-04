import { describe, expect, it } from "vitest";
import { isUsefulTranscriptionText } from "../server/_core/ai/domainAudioTranscription";
import {
  sanitizeFailureReason,
  resolveBenchmarkOutputPath,
  resolveTestedSha,
  summarize,
  validateManifest,
  type Manifest,
} from "./issue-924-transcription-benchmark";

describe("issue #924 transcription benchmark harness", () => {
  it.each([
    ["arroz 100 g", true],
    ["[inaudível] arroz 100 g", true],
    ["...", false],
    ["[inaudível]", false],
    ["silêncio", false],
    ["Não foi possível transcrever o áudio.", false],
    ["Áudio inaudível. Tente novamente.", false],
    ["[inaudível] [inaudível]", false],
    ["The audio is inaudible.", false],
    ["Sem fala detectada no áudio.", false],
  ])("classifies useful transcription text consistently: %s", (text, expected) => {
    expect(isUsefulTranscriptionText(text)).toBe(expected);
  });

  it("returns deterministic zero rates when a model has no results", () => {
    expect(summarize([], ["whisper-1"])).toEqual([
      {
        model: "whisper-1",
        fixtures: 0,
        successRate: 0,
        usefulTextRate: 0,
        averageLatencyMs: null,
        averageWordErrorRate: null,
        averageCriticalTermRecall: null,
        retryRate: 0,
        fallbackRate: 0,
        segmentAvailabilityRate: 0,
        estimatedTotalCostUsd: 0,
      },
    ]);
  });

  it("rejects an empty manifest before any provider call", () => {
    const manifest: Manifest = {
      schemaVersion: 1,
      generatedAt: "2026-08-04",
      generator: "test",
      privacy: "synthetic-only",
      fixtures: [],
    };
    expect(() => validateManifest(manifest)).toThrow(
      "Transcription benchmark manifest must contain at least one fixture.",
    );
  });

  it("records only allow-listed provider failure classifications", () => {
    expect(sanitizeFailureReason(
      "Transcription provider failed with a recoverable rate_limit condition.",
    )).toBe("rate_limit");
    expect(sanitizeFailureReason(
      "Transcription request was rejected with classification model_not_found.",
    )).toBe("model_not_found");
    expect(sanitizeFailureReason("provider message with sensitive detail")).toBe("unknown");
  });

  it("accepts pnpm's argument separator before the output path", () => {
    expect(resolveBenchmarkOutputPath(["--", "/tmp/result.json"])).toBe(
      "/tmp/result.json",
    );
    expect(resolveBenchmarkOutputPath(["/tmp/result.json"])).toBe(
      "/tmp/result.json",
    );
    expect(resolveBenchmarkOutputPath([])).toBeUndefined();
    expect(() =>
      resolveBenchmarkOutputPath(["first.json", "second.json"]),
    ).toThrow("Transcription benchmark accepts at most one output path.");
  });

  it("records the explicitly trusted exact head and rejects identity drift", async () => {
    const currentHead = await resolveTestedSha({});

    await expect(
      resolveTestedSha({
        TRANSCRIPTION_BENCHMARK_TESTED_SHA: currentHead,
      }),
    ).resolves.toBe(currentHead);
    await expect(
      resolveTestedSha({
        TRANSCRIPTION_BENCHMARK_TESTED_SHA: "0123456789abcdef0123456789abcdef01234567",
      }),
    ).rejects.toThrow(
      "TRANSCRIPTION_BENCHMARK_TESTED_SHA must match the checked-out HEAD.",
    );
    await expect(
      resolveTestedSha({
        TRANSCRIPTION_BENCHMARK_TESTED_SHA: "not-a-sha",
      }),
    ).rejects.toThrow(
      "TRANSCRIPTION_BENCHMARK_TESTED_SHA must contain the exact 40-character commit SHA.",
    );
  });

  it("keeps GITHUB_SHA as a validated compatibility fallback", async () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    await expect(resolveTestedSha({ GITHUB_SHA: sha })).resolves.toBe(sha);
    await expect(resolveTestedSha({ GITHUB_SHA: "not-a-sha" })).rejects.toThrow(
      "GITHUB_SHA must contain the exact 40-character commit SHA.",
    );
  });
});
