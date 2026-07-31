import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(
  process.cwd(),
  ".github/workflows/issue-922-live-provider-smoke.yml",
);

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

describe("issue 922 live-provider smoke security boundary", () => {
  it("keeps provider credentials out of job setup and dependency installation", () => {
    const workflow = readWorkflow();
    const stepsIndex = workflow.indexOf("    steps:");
    const firstSecretIndex = workflow.indexOf("${{ secrets.");
    const installIndex = workflow.indexOf("Install dependencies without provider credentials");

    expect(stepsIndex).toBeGreaterThan(0);
    expect(firstSecretIndex).toBeGreaterThan(stepsIndex);
    expect(installIndex).toBeGreaterThan(stepsIndex);
    expect(firstSecretIndex).toBeGreaterThan(installIndex);
    expect(workflow.slice(0, stepsIndex)).not.toContain("${{ secrets.");
  });

  it("accepts only dedicated smoke credentials in the protected environment", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain("name: issue-922-live-smoke");
    expect(workflow).toContain(
      "ISSUE_922_SMOKE_OPENAI_API_KEY: ${{ secrets.ISSUE_922_SMOKE_OPENAI_API_KEY }}",
    );
    expect(workflow).toContain(
      "ISSUE_922_SMOKE_GEMINI_API_KEY: ${{ secrets.ISSUE_922_SMOKE_GEMINI_API_KEY }}",
    );
    expect(workflow).not.toContain("secrets.OPENAI_API_KEY");
    expect(workflow).not.toContain("secrets.GEMINI_API_KEY");
  });

  it("limits execution to the trusted repository, owner and issue branch family", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain(
      "github.event.pull_request.head.repo.full_name == github.repository",
    );
    expect(workflow).toContain(
      "github.event.pull_request.user.login == 'crgasparoto-br'",
    );
    expect(workflow).toContain(
      "startsWith(github.event.pull_request.head.ref, 'feat/922-ai-capabilities-meal-whatsapp')",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).not.toContain("pull_request_target:");
  });

  it("fails closed instead of falling back to generic provider secrets", () => {
    const workflow = readWorkflow();

    expect(workflow).toContain(
      "The protected issue-922-live-smoke environment has no dedicated provider credential.",
    );
    expect(workflow).toContain(
      "unset ISSUE_922_SMOKE_OPENAI_API_KEY ISSUE_922_SMOKE_GEMINI_API_KEY",
    );
  });
});
