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

  it("does not promote benchmark evidence produced across an untrusted PR-secret boundary", () => {
    const manifest = JSON.parse(read(evidenceManifestPath)) as {
      schemaVersion: number;
      canonicalRun: null;
      trustedRunRequired: { status: string };
      invalidatedRuns: Array<{
        testedSha: string;
        workflowRunId?: number;
        role: string;
        invalidatedReason: string;
      }>;
    };

    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.canonicalRun).toBeNull();
    expect(manifest.trustedRunRequired.status).toBe("pending");
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
