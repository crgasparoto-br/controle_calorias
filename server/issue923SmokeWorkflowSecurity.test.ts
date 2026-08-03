import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");
const smokeScriptPath = resolve(process.cwd(), "scripts/issue-923-live-provider-smoke.ts");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

function readSmokeScript() {
  return readFileSync(smokeScriptPath, "utf8");
}

describe("issue 923 live-provider smoke security boundary", () => {
  it("releases only the canonical provider credentials after setup and installation", () => {
    const workflow = readWorkflow();
    const stepsIndex = workflow.indexOf("    steps:");
    const installIndex = workflow.indexOf("Install dependencies without provider credentials");
    const firstSecretIndex = workflow.indexOf("${{ secrets.");

    expect(stepsIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(stepsIndex);
    expect(firstSecretIndex).toBeGreaterThan(installIndex);
    expect(workflow.slice(0, stepsIndex)).not.toContain("${{ secrets.");
    expect(workflow).toContain("OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}");
    expect(workflow).toContain("GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}");
    expect(workflow).not.toContain("AI_SMOKE_OPENAI_API_KEY");
    expect(workflow).not.toContain("AI_SMOKE_GEMINI_API_KEY");
  });

  it("runs automatically for the exact trusted PR head without manual approval state", () => {
    const workflow = readWorkflow();
    const smokeScript = readSmokeScript();
    const identityIndex = workflow.indexOf("Verify trusted identity and exact selected SHA");
    const installIndex = workflow.indexOf("Install dependencies without provider credentials");

    expect(workflow).not.toContain("environment:\n");
    expect(workflow).not.toContain("AI_SMOKE_APPROVED_SHA");
    expect(workflow).not.toContain("SMOKE_APPROVED_SHA");
    expect(smokeScript).not.toContain("SMOKE_APPROVED_SHA");
    expect(workflow).toContain('test "$(git rev-parse HEAD)" = "${EXPECTED_HEAD_SHA}"');
    expect(identityIndex).toBeGreaterThan(0);
    expect(installIndex).toBeGreaterThan(identityIndex);
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

  it("fails closed when the canonical provider credentials are absent", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("GitHub secret OPENAI_API_KEY is unavailable.");
    expect(workflow).toContain("GitHub secret GEMINI_API_KEY is unavailable.");
  });
});
