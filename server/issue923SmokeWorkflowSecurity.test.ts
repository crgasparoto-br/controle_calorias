import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

describe("issue 923 live-provider smoke security boundary", () => {
  it("releases only dedicated smoke credentials after setup and installation", () => {
    const workflow = readWorkflow();
    const stepsIndex = workflow.indexOf("    steps:");
    const installIndex = workflow.indexOf("Install dependencies without provider credentials");
    const firstSecretIndex = workflow.indexOf("${{ secrets.");

    expect(stepsIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(stepsIndex);
    expect(firstSecretIndex).toBeGreaterThan(installIndex);
    expect(workflow.slice(0, stepsIndex)).not.toContain("${{ secrets.");
    expect(workflow).toContain(
      "AI_SMOKE_OPENAI_API_KEY: ${{ secrets.AI_SMOKE_OPENAI_API_KEY }}",
    );
    expect(workflow).toContain(
      "AI_SMOKE_GEMINI_API_KEY: ${{ secrets.AI_SMOKE_GEMINI_API_KEY }}",
    );
    expect(workflow).not.toContain("secrets.OPENAI_API_KEY");
    expect(workflow).not.toContain("secrets.GEMINI_API_KEY");
  });

  it("requires a protected environment and external approval of the exact SHA", () => {
    const workflow = readWorkflow();
    const approvalIndex = workflow.indexOf("APPROVED_HEAD_SHA: ${{ vars.AI_SMOKE_APPROVED_SHA }}");
    const installIndex = workflow.indexOf("Install dependencies without provider credentials");

    expect(workflow).toContain("environment:\n      name: issue-923-live-smoke");
    expect(workflow).toContain('[ "${APPROVED_HEAD_SHA}" != "${EXPECTED_HEAD_SHA}" ]');
    expect(workflow).toContain(
      "Set protected-environment variable AI_SMOKE_APPROVED_SHA to the independently reviewed PR head before releasing provider credentials.",
    );
    expect(approvalIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(approvalIndex);
  });

  it("locks checkout and execution to the trusted repository, owner and issue branch", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain(
      "github.event.pull_request.user.login == github.repository_owner",
    );
    expect(workflow).toContain(
      "startsWith(github.event.pull_request.head.ref, 'feat/923-ai-capabilities-question-nutrition-embedding')",
    );
    expect(workflow).not.toContain("pull_request_target:");
  });

  it("fails closed when dedicated credentials are absent", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain(
      "The protected issue-923-live-smoke environment has no dedicated OpenAI smoke credential.",
    );
    expect(workflow).toContain(
      "The protected issue-923-live-smoke environment has no dedicated Gemini smoke credential.",
    );
    expect(workflow).toContain(
      "unset AI_SMOKE_OPENAI_API_KEY AI_SMOKE_GEMINI_API_KEY",
    );
  });
});
