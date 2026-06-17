import { readFileSync } from "node:fs";

const workflow = readFileSync(".github/workflows/agent-check.yml", "utf8");
const contributing = readFileSync("CONTRIBUTING.md", "utf8");
const pullRequestTemplate = readFileSync(".github/pull_request_template.md", "utf8");
const branchProtection = readFileSync(".github/branch-protection-main.md", "utf8");

const failures: string[] = [];

function requireText(source: string, expected: string, context: string) {
  if (!source.includes(expected)) {
    failures.push(`${context} deve conter: ${expected}`);
  }
}

function requireRegex(source: string, expected: RegExp, context: string) {
  if (!expected.test(source)) {
    failures.push(`${context} deve atender ao padrão: ${expected}`);
  }
}

requireText(workflow, "name: Agent-first gate", ".github/workflows/agent-check.yml");
requireRegex(workflow, /jobs:\s+agent-check:[\s\S]*?name:\s+Agent-first gate/, ".github/workflows/agent-check.yml");

for (const command of [
  "pnpm check",
  "pnpm test",
  "pnpm architecture:check",
  "pnpm docs:check",
  "pnpm build",
  "pnpm agent:check",
]) {
  requireText(workflow, command, ".github/workflows/agent-check.yml");
}

requireText(workflow, "pnpm db:check-integrity", ".github/workflows/agent-check.yml");
requireText(workflow, "DATABASE_URL not available", ".github/workflows/agent-check.yml");
requireText(workflow, "GITHUB_STEP_SUMMARY", ".github/workflows/agent-check.yml");

for (const doc of [contributing, pullRequestTemplate, branchProtection]) {
  requireText(doc, "Agent-first gate", "documentação de contribuição/PR/branch protection");
  requireText(doc, "DATABASE_URL", "documentação de contribuição/PR/branch protection");
  requireText(doc, "Vercel", "documentação de contribuição/PR/branch protection");
}

requireText(contributing, "status check obrigatório", "CONTRIBUTING.md");
requireText(branchProtection, "Required status check: `Agent-first gate`", ".github/branch-protection-main.md");
requireText(pullRequestTemplate, "db:check-integrity", ".github/pull_request_template.md");

if (failures.length > 0) {
  console.error("\nFalhas de alinhamento do gate de CI:\n");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Gate de CI documentado e alinhado com o workflow.");
