import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = resolve(process.cwd(), ".github/workflows/ai-provider-live-smoke.yml");
const smokeScriptPath = resolve(process.cwd(), "scripts/issue-923-live-provider-smoke.ts");
const catalogSearchPath = resolve(process.cwd(), "server/catalogSemanticSearch.ts");

function readWorkflow() {
  return readFileSync(workflowPath, "utf8");
}

function readSmokeScript() {
  return readFileSync(smokeScriptPath, "utf8");
}

function readCatalogSearch() {
  return readFileSync(catalogSearchPath, "utf8");
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
    expect(workflow).toContain("cache: pnpm");
    expect(workflow).not.toContain("cache: pnm");
    expect(workflow).toContain('${OPENAI_API_KEY:-}');
    expect(workflow).not.toContain("OPNAI_API_KEY");
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

  it("executes the real production nutrition path once and preserves safe degradation", () => {
    const smokeScript = readSmokeScript();
    const nutritionStart = smokeScript.indexOf("async function runNutrition");
    const embeddingStart = smokeScript.indexOf("async function runEmbedding");
    const nutritionBlock = smokeScript.slice(nutritionStart, embeddingStart);

    expect(nutritionStart).toBeGreaterThan(0);
    expect(embeddingStart).toBeGreaterThan(nutritionStart);
    expect(nutritionBlock.match(/findPackagedSnackByWebSearch\(/g)).toHaveLength(1);
    expect(nutritionBlock).not.toContain("createDomainTextResponse");
    expect(nutritionBlock).not.toContain("executeResolvedCapability");
    expect(nutritionBlock).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
    expect(nutritionBlock).not.toContain("runNutritionProbe");
    expect(smokeScript).not.toContain("SMOKE_NUTRITION_ATTEMPTS");
    expect(nutritionBlock).toContain('/^fonte: https?:\\/\\//u.test(alias)');
    expect(nutritionBlock).toContain('outcome: "matched-verified-production-result"');
    expect(nutritionBlock).toContain('outcome: "safe-no-match"');
    expect(smokeScript).toContain("nutritionMatched: nutritionResult.matched");
    expect(smokeScript).not.toContain("nutritionMatched: true");
  });

  it("keeps the production path single-attempt and rejects source-less results", () => {
    const catalogSearch = readCatalogSearch();
    const start = catalogSearch.indexOf("export async function findPackagedSnackByWebSearch");
    const end = catalogSearch.indexOf("function cosineSimilarity", start);
    const productionBlock = catalogSearch.slice(start, end);

    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    expect(productionBlock.match(/executeResolvedCapability\(/g)).toHaveLength(1);
    expect(productionBlock.match(/createDomainTextResponse\(/g)).toHaveLength(1);
    expect(productionBlock).not.toMatch(/\bfor\s*\(|\bwhile\s*\(/);
    expect(catalogSearch).toContain("if (!sourceUrl || !evidence) return null;");
    expect(catalogSearch).toContain("const sourceUrl = findVerifiedNutritionSource");
  });
});
