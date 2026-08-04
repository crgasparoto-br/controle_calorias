import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

describe("issue 924 benchmark secret boundary", () => {
  it("keeps the real transcription benchmark outside pull-request workflows", () => {
    const workflow = readWorkflow();

    expect(workflow).not.toContain("  transcription-benchmark:");
    expect(workflow).not.toContain("issue-924-transcription-benchmark");
    expect(workflow).not.toContain("feat/924-transcription-capability-benchmark");
    expect(workflow).not.toContain('"scripts/issue-924-transcription-benchmark.ts"');
    expect(workflow).not.toContain('"docs/benchmarks/transcription/fixtures/**"');
  });

  it("does not expose provider secrets to issue 924 PR code", () => {
    const workflow = readWorkflow();
    const liveSmokeStart = workflow.indexOf("  live-smoke:");
    expect(liveSmokeStart).toBeGreaterThan(0);
    const liveSmoke = workflow.slice(liveSmokeStart);

    expect(liveSmoke).toContain(
      "startsWith(github.event.pull_request.head.ref, 'feat/923-ai-capabilities-question-nutrition-embedding')",
    );
    expect(liveSmoke).not.toContain("feat/924-transcription-capability-benchmark");
    expect(workflow).not.toContain("pull_request_target:");
    expect(workflow).not.toContain("environment:\n");
  });
});
