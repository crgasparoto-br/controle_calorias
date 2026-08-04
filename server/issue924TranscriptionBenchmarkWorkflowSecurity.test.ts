import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

function readBenchmarkJob() {
  const workflow = readWorkflow();
  const start = workflow.indexOf("  transcription-benchmark:");
  expect(start).toBeGreaterThan(0);
  return workflow.slice(start);
}

describe("issue 924 transcription benchmark workflow security boundary", () => {
  it("runs only for the trusted same-repository owner branch and exact PR head", () => {
    const workflow = readWorkflow();
    const job = readBenchmarkJob();

    expect(job).toContain("github.event_name == 'pull_request'");
    expect(job).not.toContain("github.event_name == 'workflow_dispatch'");
    expect(job).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(job).toContain(
      "github.event.pull_request.user.login == github.repository_owner",
    );
    expect(job).toContain(
      "startsWith(github.event.pull_request.head.ref, 'feat/924-transcription-capability-benchmark')",
    );
    expect(job).toContain('ref: ${{ github.event.pull_request.head.sha }}');
    expect(job).toContain('test "$(git rev-parse HEAD)" = "${EXPECTED_HEAD_SHA}"');
    expect(workflow).not.toContain("pull_request_target:");
    expect(job).not.toContain("environment:\n");
  });

  it("releases OPENAI_API_KEY only after checkout, identity verification and installation", () => {
    const job = readBenchmarkJob();
    const checkoutIndex = job.indexOf("Checkout exact pull request head without credentials");
    const identityIndex = job.indexOf("Verify trusted issue 924 identity and exact head");
    const installIndex = job.indexOf("Install dependencies without provider credentials");
    const secretIndex = job.indexOf("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}");

    expect(checkoutIndex).toBeGreaterThan(0);
    expect(identityIndex).toBeGreaterThan(checkoutIndex);
    expect(installIndex).toBeGreaterThan(identityIndex);
    expect(secretIndex).toBeGreaterThan(installIndex);
    expect(job.slice(0, installIndex)).not.toContain("${{ secrets.");
    expect(job).toContain('${OPENAI_API_KEY:-}');
    expect(job).toContain("GitHub secret OPENAI_API_KEY is unavailable.");
    expect(job).toContain("persist-credentials: false");
  });

  it("executes the fixed comparison and uploads only the sanitized JSON result", () => {
    const workflow = readWorkflow();
    const job = readBenchmarkJob();

    expect(workflow).toContain('"scripts/issue-924-transcription-benchmark.ts"');
    expect(workflow).toContain('"docs/benchmarks/transcription/fixtures/**"');
    expect(job).toContain("TRANSCRIPTION_BENCHMARK_WHISPER_MODEL: whisper-1");
    expect(job).toContain(
      "TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL: gpt-4o-mini-transcribe",
    );
    expect(job).toContain('pnpm benchmark:transcription "${BENCHMARK_RESULT_PATH}"');
    expect(job).toContain("Validate sanitized benchmark evidence");
    expect(job).toContain('path: ${{ env.BENCHMARK_RESULT_PATH }}');
    expect(job).toContain("forbiddenKeys");
    expect(job).not.toContain("tee ");
    expect(job).not.toMatch(/\/tmp\/.*\.log/u);
  });
});
