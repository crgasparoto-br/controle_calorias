import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isUsefulTranscriptionText } from "../server/_core/ai/domainAudioTranscription";
import { assertCleanWorkingTree } from "./issue-924-benchmark-identity";
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
    ["Silêncio detectado.", false],
    ["Não foi possível detectar fala.", false],
    ["Não consegui entender o áudio.", false],
    ["Nenhuma voz detectada.", false],
    ["Somente ruído de fundo.", false],
    ["Áudio sem conteúdo.", false],
    ["No speech detected in the audio.", false],
    ["Only background noise.", false],
    ["Could not understand the audio. Please try again.", false],
    ["iogurte sem açúcar", true],
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

  it("accepts GITHUB_SHA only when it matches the checked-out HEAD", async () => {
    const currentHead = await resolveTestedSha({});
    await expect(resolveTestedSha({ GITHUB_SHA: currentHead })).resolves.toBe(
      currentHead,
    );
    await expect(
      resolveTestedSha({
        GITHUB_SHA: "0123456789abcdef0123456789abcdef01234567",
      }),
    ).rejects.toThrow("GITHUB_SHA must match the checked-out HEAD.");
    await expect(resolveTestedSha({ GITHUB_SHA: "not-a-sha" })).rejects.toThrow(
      "GITHUB_SHA must contain the exact 40-character commit SHA.",
    );
  });

  it("rejects an uncommitted benchmark runtime before provider access", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "issue-924-benchmark-"));
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.email", "issue-924@example.invalid"], { cwd });
    execFileSync("git", ["config", "user.name", "Issue 924 Test"], { cwd });
    writeFileSync(join(cwd, "runtime.ts"), "export const version = 1;\n");
    execFileSync("git", ["add", "runtime.ts"], { cwd });
    execFileSync("git", ["commit", "-q", "-m", "fixture"], { cwd });

    await expect(assertCleanWorkingTree(cwd)).resolves.toBeUndefined();
    writeFileSync(join(cwd, "runtime.ts"), "export const version = 2;\n");
    await expect(assertCleanWorkingTree(cwd)).rejects.toThrow(
      "Transcription benchmark requires a clean working tree before provider access.",
    );
  });
});
