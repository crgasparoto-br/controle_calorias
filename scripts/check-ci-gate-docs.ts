import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/agent-check.yml", "utf8");
const contributing = readFileSync("CONTRIBUTING.md", "utf8");
const pullRequestTemplate = readFileSync(".github/pull_request_template.md", "utf8");
const branchProtection = readFileSync(".github/branch-protection-main.md", "utf8");
const billingAdminOperations = readFileSync("docs/design-docs/billing-admin-operations.md", "utf8");
const billingVisualScript = readFileSync("scripts/render-billing-admin-visual.sh", "utf8");

const failures: string[] = [];

function requireText(source: string, expected: string, context: string) {
  if (!source.includes(expected)) failures.push(`${context} deve conter: ${expected}`);
}

function requireRegex(source: string, expected: RegExp, context: string) {
  if (!expected.test(source)) failures.push(`${context} deve atender ao padrão: ${expected}`);
}

requireText(workflow, "name: Agent-first gate", ".github/workflows/agent-check.yml");
requireRegex(workflow, /jobs:\s+classify:[\s\S]*?name:\s+Delivery V2 risk/, ".github/workflows/agent-check.yml classifier");
requireRegex(workflow, /merge-preview-integration:[\s\S]*?name:\s+Merge preview integration[\s\S]*?needs:\s+classify/, ".github/workflows/agent-check.yml merge preview");
requireRegex(workflow, /agent-check:[\s\S]*?name:\s+Agent-first gate[\s\S]*?needs:\s+\[classify, merge-preview-integration\][\s\S]*?if:\s+\$\{\{ always\(\) \}\}/, ".github/workflows/agent-check.yml required gate");
requireText(workflow, "needs.classify.result != 'success'", ".github/workflows/agent-check.yml classifier failure propagation");
requireText(workflow, "needs.merge-preview-integration.result != 'success'", ".github/workflows/agent-check.yml merge-preview failure propagation");
requireRegex(workflow, /push:\s*\n\s+branches:\s*\n\s+- main\s*\n\s+- develop/, ".github/workflows/agent-check.yml");
requireText(workflow, "ref: ${{ env.VERIFICATION_HEAD_SHA }}", ".github/workflows/agent-check.yml exact-head checkout");
requireText(workflow, 'CHECKOUT_SHA="$(git rev-parse HEAD)"', ".github/workflows/agent-check.yml exact-head manifest");
requireText(workflow, "value.checkoutSha !== value.headSha", ".github/workflows/agent-check.yml exact-head assertion");
requireText(workflow, "DELIVERY_V2_RISK_PROFILE", ".github/workflows/agent-check.yml risk propagation");
requireText(workflow, "FAST related tests", ".github/workflows/agent-check.yml FAST gate");
requireText(workflow, "vitest related", ".github/workflows/agent-check.yml FAST regression");
requireText(workflow, "Full tests", ".github/workflows/agent-check.yml full regression");

const mergePreviewBlock = workflow.match(/merge-preview-integration:[\s\S]*?\n  agent-check:/)?.[0] ?? "";
if (/vitest\s+(?:run|related)|pnpm\s+test/.test(mergePreviewBlock)) {
  failures.push("Merge preview integration nao deve repetir a suite Vitest; os testes pertencem ao exact-head gate");
}

for (const command of ["pnpm check", "pnpm test", "pnpm architecture:check", "pnpm docs:check", "pnpm build", "pnpm agent:check"]) {
  requireText(workflow, command, ".github/workflows/agent-check.yml");
}

requireText(workflow, "pnpm db:check-integrity", ".github/workflows/agent-check.yml");
requireText(workflow, "DATABASE_URL not available", ".github/workflows/agent-check.yml");
requireText(workflow, "GITHUB_STEP_SUMMARY", ".github/workflows/agent-check.yml");

for (const doc of [contributing, pullRequestTemplate, branchProtection]) {
  requireText(doc, "Agent-first gate", "documentacao de contribuicao/PR/branch protection");
  requireText(doc, "Delivery V2", "documentacao de contribuicao/PR/branch protection");
  requireText(doc, "DATABASE_URL", "documentacao de contribuicao/PR/branch protection");
  requireText(doc, "Vercel", "documentacao de contribuicao/PR/branch protection");
}

for (const profile of ["FAST", "STANDARD", "CRITICAL"]) {
  requireText(contributing, profile, "CONTRIBUTING.md adaptive CI profiles");
}
requireText(contributing, "status check obrigatório", "CONTRIBUTING.md");
requireText(contributing, "push direto para `develop` executa o workflow `Agent-first gate`", "CONTRIBUTING.md");
requireText(branchProtection, "Required status check: `Agent-first gate`", ".github/branch-protection-main.md");
requireText(pullRequestTemplate, "`Delivery V2 risk` classificou a PR e `Agent-first gate` passou no `head_sha` exato", ".github/pull_request_template.md");
requireText(pullRequestTemplate, "db:check-integrity", ".github/pull_request_template.md");

const billingViewportMatches = [...billingVisualScript.matchAll(/capture\s+"[^"]+"\s+"(\d+),(\d+)"/g)];
const billingViewports = billingViewportMatches.map((match) => `${match[1]}x${match[2]}`);

if (billingViewports.length === 0) {
  failures.push("scripts/render-billing-admin-visual.sh deve declarar ao menos um viewport de captura");
} else {
  for (const viewport of billingViewports) {
    requireText(billingAdminOperations, viewport, "docs/design-docs/billing-admin-operations.md deve refletir os viewports do harness visual");
  }
  requireText(billingAdminOperations, `${billingViewports.length} screenshots`, "docs/design-docs/billing-admin-operations.md deve refletir a quantidade de screenshots do harness visual");
}

if (failures.length > 0) {
  console.error("\nFalhas de alinhamento do gate de CI:\n");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Gate adaptativo de CI documentado e alinhado com o workflow.");
