import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");
const benchmarkReadmePath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/README.md",
);
const resultsReadmePath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/results/README.md",
);
const canonicalResultPath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/results/2026-08-04-751c3c709674.json",
);
const evidenceManifestPath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/results/evidence-manifest.json",
);

function read(path: string) {
  return readFileSync(path, "utf8");
}

describe("issue 924 benchmark credential boundary", () => {
  it("does not execute the live transcription benchmark from a pull request workflow", () => {
    const workflow = read(workflowPath);

    expect(workflow).not.toContain("  transcription-benchmark:");
    expect(workflow).not.toContain("pnpm benchmark:transcription");
    expect(workflow).not.toContain("issue-924-transcription-benchmark");
    expect(workflow).not.toContain("TRANSCRIPTION_BENCHMARK_TESTED_SHA");
  });

  it("documents that repository secrets cannot be exposed to mutable PR code", () => {
    const benchmarkReadme = read(benchmarkReadmePath);
    const resultsReadme = read(resultsReadmePath);

    expect(benchmarkReadme).toContain(
      "Um workflow de `pull_request` não deve executar este benchmark com secrets permanentes do repositório",
    );
    expect(resultsReadme).toContain(
      "Não executar o benchmark em workflow de `pull_request` com secrets permanentes do repositório",
    );
  });

  it("keeps the sanitized exact-runtime evidence durable and hash-addressed", () => {
    const result = JSON.parse(read(canonicalResultPath)) as {
      testedSha: string;
      results: Array<{
        status: string;
        usefulText?: boolean;
        attempts?: number;
        usedFallback?: boolean;
      }>;
    };
    const manifest = JSON.parse(read(evidenceManifestPath)) as {
      canonicalRun: {
        testedSha: string;
        resultPath: string;
        artifactDigestSha256: string;
        jsonSha256: string;
      };
    };

    expect(result.testedSha).toBe(
      "751c3c7096748c16a1546b2ab8161e512ecf133a",
    );
    expect(result.results).toHaveLength(12);
    expect(result.results.every(item => item.status === "ok")).toBe(true);
    expect(result.results.every(item => item.usefulText === true)).toBe(true);
    expect(result.results.every(item => item.attempts === 1)).toBe(true);
    expect(result.results.every(item => item.usedFallback === false)).toBe(true);
    expect(manifest.canonicalRun.testedSha).toBe(result.testedSha);
    expect(manifest.canonicalRun.resultPath).toBe(
      "docs/benchmarks/transcription/results/2026-08-04-751c3c709674.json",
    );
    expect(manifest.canonicalRun.artifactDigestSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(manifest.canonicalRun.jsonSha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
