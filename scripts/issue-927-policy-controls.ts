import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { validateIssue927PolicyManifest } from "./issue-927-policy-control-contract";
import { evaluateIssue927PolicyControls } from "./issue-927-policy-control-execution";

export { validateIssue927PolicyManifest } from "./issue-927-policy-control-contract";
export { evaluateIssue927PolicyControls } from "./issue-927-policy-control-execution";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const DEFAULT_ARTIFACT = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-policy-controls.json");
const RESULT_PREFIX = "docs/benchmarks/multi-provider/results/";
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();

export async function buildIssue927PolicyReport(testedSha = process.env.VERIFICATION_HEAD_SHA ?? git(["rev-parse", "HEAD"])) {
  const nonApplicablePolicies = await validateIssue927PolicyManifest(MANIFEST);
  const controls = await evaluateIssue927PolicyControls();
  return {
    schemaVersion: 1, generatedAt: "2026-08-06", issue: 927, testedSha,
    privacy: "synthetic-controls-no-user-content", productionChangesApplied: false,
    controlCount: controls.length, allPassed: controls.length === 32 && controls.every(item => item.passed),
    whatsappPrimaryProviderScenario: "intent-provider-primary", nonApplicablePolicies, controls,
  };
}

export async function verifyIssue927PolicyReport(artifactPath = DEFAULT_ARTIFACT): Promise<void> {
  try { await access(artifactPath); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  const committed = JSON.parse(await readFile(artifactPath, "utf8")) as Awaited<ReturnType<typeof buildIssue927PolicyReport>>;
  assert.match(committed.testedSha, /^[0-9a-f]{40}$/u);
  const head = process.env.VERIFICATION_HEAD_SHA ?? git(["rev-parse", "HEAD"]);
  execFileSync("git", ["merge-base", "--is-ancestor", committed.testedSha, head], { cwd: ROOT });
  const delta = git(["diff", "--name-only", `${committed.testedSha}..${head}`]).split("\n").filter(Boolean);
  assert.equal(delta.every(file => file.startsWith(RESULT_PREFIX)), true, `policy artifact tested a different source tree: ${delta.join(", ")}`);
  assert.deepEqual(committed, await buildIssue927PolicyReport(committed.testedSha));
}

async function main(): Promise<void> {
  const artifact = process.argv.includes("--artifact") ? process.argv[process.argv.indexOf("--artifact") + 1] : DEFAULT_ARTIFACT;
  if (process.argv.includes("--verify-if-present")) {
    await verifyIssue927PolicyReport(artifact);
    process.stdout.write("issue-927 policy controls verified\n");
    return;
  }
  const report = await buildIssue927PolicyReport();
  assert.equal(report.allPassed, true, "issue-927 policy controls failed");
  if (process.argv.includes("--output")) {
    const output = process.argv[process.argv.indexOf("--output") + 1];
    if (!output) throw new Error("--output requires a path");
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`ISSUE927_POLICY_REPORT=${JSON.stringify(report)}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
