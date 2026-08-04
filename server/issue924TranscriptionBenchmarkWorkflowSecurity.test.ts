import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");
const temporaryBenchmarkWorkflowPath = resolve(
  process.cwd(),
  ".github/workflows/issue-924-transcription-benchmark.yml",
);
const benchmarkReadmePath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/README.md",
);
const resultsReadmePath = resolve(
  process.cwd(),
  "docs/benchmarks/transcription/results/README.md",
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
    expect(existsSync(temporaryBenchmarkWorkflowPath)).toBe(false);
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

  it("promotes only the reviewed push benchmark and keeps unsafe history invalidated", () => {
    const manifest = JSON.parse(read(evidenceManifestPath)) as {
      schemaVersion: number;
      canonicalRun: null | {
        status: string;
        testedSha: string;
        resultPath: string;
        workflowRunId: number;
        event: string;
        artifactDigestSha256: string;
        jsonSha256: string;
      };
      trustedRunRequired: {
        status: string;
        satisfiedByTestedSha?: string;
      };
      invalidatedRuns: Array<{
        testedSha: string;
        workflowRunId?: number;
        role: string;
        invalidatedReason: string;
      }>;
    };

    const canonicalSha = "af087f9b0c643a3146d46c1567c8fd80bbeff03e";

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.canonicalRun).toEqual(
      expect.objectContaining({
        status: "trusted",
        testedSha: canonicalSha,
        resultPath:
          "docs/benchmarks/transcription/results/2026-08-04-af087f9b0c64.json",
        workflowRunId: 30954486742,
        event: "push",
        artifactDigestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        jsonSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      }),
    );
    expect(manifest.trustedRunRequired).toEqual(
      expect.objectContaining({
        status: "satisfied",
        satisfiedByTestedSha: canonicalSha,
      }),
    );
    expect(manifest.invalidatedRuns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          testedSha: "751c3c7096748c16a1546b2ab8161e512ecf133a",
          workflowRunId: 30935644636,
          role: "historical-untrusted-provenance",
          invalidatedReason: expect.stringContaining("OPENAI_API_KEY"),
        }),
      ]),
    );
  });
});
