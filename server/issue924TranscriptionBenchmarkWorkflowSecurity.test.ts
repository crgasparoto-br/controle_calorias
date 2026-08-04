import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

function readTranscriptionJob(workflow: string) {
  const start = workflow.indexOf("  transcription-benchmark:");
  expect(start).toBeGreaterThan(0);
  return workflow.slice(start);
}

describe("issue 924 benchmark secret boundary", () => {
  it("triggers for the versioned benchmark harness and synthetic fixtures", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain('"scripts/issue-924-transcription-benchmark.ts"');
    expect(workflow).toContain('"scripts/issue-924-transcription-benchmark.test.ts"');
    expect(workflow).toContain('"docs/benchmarks/transcription/fixtures/**"');
    expect(workflow).toContain('"server/_core/voiceTranscription.ts"');
    expect(workflow).toContain('"server/issue924TranscriptionBenchmarkWorkflowSecurity.test.ts"');
  });

  it("locks execution to the exact trusted issue 924 PR head", () => {
    const workflow = readWorkflow();
    const job = readTranscriptionJob(workflow);

    expect(job).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(job).toContain(
      "github.event.pull_request.user.login == github.repository_owner",
    );
    expect(job).toContain(
      "github.event.pull_request.head.ref == 'feat/924-transcription-capability-benchmark'",
    );
    expect(job).toContain("ref: ${{ github.event.pull_request.head.sha }}");
    expect(job).toContain("persist-credentials: false");
    expect(job).toContain('test "$(git rev-parse HEAD)" = "${EXPECTED_HEAD_SHA}"');
    expect(workflow).not.toContain("pull_request_target:");
    expect(job).not.toContain("environment:\n");
  });

  it("injects only the canonical OpenAI secret after checkout, verification and installation", () => {
    const workflow = readWorkflow();
    const job = readTranscriptionJob(workflow);
    const stepsIndex = job.indexOf("    steps:");
    const verificationIndex = job.indexOf(
      "Verify trusted transcription identity and exact head SHA",
    );
    const installIndex = job.indexOf(
      "Install dependencies without transcription credentials",
    );
    const firstSecretIndex = job.indexOf("${{ secrets.");

    expect(stepsIndex).toBeGreaterThan(0);
    expect(verificationIndex).toBeGreaterThan(stepsIndex);
    expect(installIndex).toBeGreaterThan(verificationIndex);
    expect(firstSecretIndex).toBeGreaterThan(installIndex);
    expect(job.slice(0, installIndex)).not.toContain("${{ secrets.");
    expect(
      job.match(/OPENAI_API_KEY: \$\{\{ secrets\.OPENAI_API_KEY \}\}/gu),
    ).toHaveLength(1);
    expect(job).toContain(
      "TRANSCRIPTION_BENCHMARK_TESTED_SHA: ${{ github.event.pull_request.head.sha }}",
    );
    expect(job).toContain("TRANSCRIPTION_BENCHMARK_WHISPER_MODEL: whisper-1");
    expect(job).toContain(
      "TRANSCRIPTION_BENCHMARK_GPT4O_MINI_MODEL: gpt-4o-mini-transcribe",
    );
    expect(job).not.toContain("GEMINI_API_KEY");
    expect(job).not.toContain("AI_SMOKE_OPENAI_API_KEY");
    expect(job).toContain("GitHub secret OPENAI_API_KEY is unavailable.");
  });

  it("runs the productive benchmark once and uploads only the sanitized exact-head JSON", () => {
    const workflow = readWorkflow();
    const job = readTranscriptionJob(workflow);

    expect(job.match(/pnpm benchmark:transcription --/gu)).toHaveLength(1);
    expect(job).toContain('.testedSha == $expected_sha');
    expect(job).toContain('.models == ["whisper-1", "gpt-4o-mini-transcribe"]');
    expect(job).toContain("(.results | length == 12)");
    expect(job).toContain('select(.status == "ok")');
    expect(job).toContain('.usefulText != true');
    expect(job).toContain(".attempts != 1 or .usedFallback != false");
    expect(job).toContain("actions/upload-artifact@v4");
    expect(job).toContain(
      "name: issue-924-transcription-benchmark-${{ github.event.pull_request.head.sha }}",
    );
    expect(job).toContain(
      "path: ${{ runner.temp }}/issue-924-transcription-benchmark-${{ github.event.pull_request.head.sha }}.json",
    );
    expect(job).not.toContain("docs/benchmarks/transcription/results/");
  });
});
