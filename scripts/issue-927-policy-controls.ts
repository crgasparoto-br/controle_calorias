import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { executeScenario } from "./issue-927-benchmark/execution";
import { readManifest } from "./issue-927-benchmark/report";
import { validateIssue927PolicyManifest } from "./issue-927-policy-control-contract";
import { evaluateIssue927PolicyControls } from "./issue-927-policy-control-execution";
import {
  isTrackedResultArtifact,
  verificationHeadSha,
  verifyPublishedResultArtifactLineage,
} from "./issue-927-benchmark/artifact-lineage";

export { validateIssue927PolicyManifest } from "./issue-927-policy-control-contract";
export { evaluateIssue927PolicyControls } from "./issue-927-policy-control-execution";

const ROOT = path.resolve(import.meta.dirname, "..");
const MANIFEST = path.join(ROOT, "docs/benchmarks/multi-provider/fixtures/manifest.json");
const DEFAULT_ARTIFACT = path.join(ROOT, "docs/benchmarks/multi-provider/results/2026-08-06-policy-controls.json");
const git = (args: string[]) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
const sha256 = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

export async function buildIssue927PolicyReport(
  testedSha = process.env.VERIFICATION_HEAD_SHA ?? git(["rev-parse", "HEAD"]),
) {
  const nonApplicablePolicies = await validateIssue927PolicyManifest(MANIFEST);
  const manifest = await readManifest(MANIFEST);
  const whatsappScenario = manifest.scenarios.find(item => item.id === "intent-provider-primary");
  assert(whatsappScenario, "missing intent-provider-primary scenario");
  const whatsappObservation = await executeScenario(
    whatsappScenario,
    manifest.rubric.WHATSAPP_INTENT.criticalChecks,
  );
  assert.equal(whatsappObservation.valid, true, "WHATSAPP_INTENT provider scenario failed");
  assert.equal(whatsappObservation.calls, 1, "WHATSAPP_INTENT provider scenario must call once");
  const whatsappAttempt = whatsappObservation.attemptDetails[0];
  assert.deepEqual(whatsappAttempt, {
    role: "primary",
    provider: "openai",
    model: "gpt-4.1-mini",
    outcome: "success",
  });
  const controls = await evaluateIssue927PolicyControls();
  const families = Object.fromEntries([
    "fallback-disabled",
    "retry",
    "same-provider-fallback",
    "cross-provider-blocked",
  ].map(family => [family, controls.filter(item => item.family === family).length]));
  return {
    schemaVersion: 2,
    generatedAt: "2026-08-06",
    issue: 927,
    testedSha,
    privacy: "synthetic-controls-no-user-content",
    productionChangesApplied: false,
    whatsappPrimaryProviderScenario: "intent-provider-primary",
    whatsappPrimaryProviderEvidence: {
      valid: whatsappObservation.valid,
      calls: whatsappObservation.calls,
      attempt: whatsappAttempt,
      observationSha256: sha256(whatsappObservation),
    },
    controlCount: controls.length,
    allPassed: controls.length === 32 && controls.every(item => item.passed),
    failedControlIds: controls.filter(item => !item.passed).map(item => item.id),
    maxConcurrencyObserved: Math.max(0, ...controls.map(item => item.maxConcurrency)),
    families,
    controlIds: controls.map(item => item.id),
    controlsSha256: sha256(controls),
    nonApplicablePolicyCount: nonApplicablePolicies.length,
    nonApplicableReasonCodes: [...new Set(nonApplicablePolicies.map(item => item.reasonCode))].sort(),
    nonApplicablePoliciesSha256: sha256(nonApplicablePolicies),
  };
}

export async function verifyIssue927PolicyReport(artifactPath = DEFAULT_ARTIFACT): Promise<void> {
  const committed = JSON.parse(await readFile(artifactPath, "utf8")) as Awaited<ReturnType<typeof buildIssue927PolicyReport>>;
  assert.match(committed.testedSha, /^[0-9a-f]{40}$/u);
  const head = verificationHeadSha();

  if (isTrackedResultArtifact(artifactPath)) {
    await verifyPublishedResultArtifactLineage({
      artifactPaths: [artifactPath],
      testedSha: committed.testedSha,
      verifiedHead: head,
    });
    assert.equal(committed.controlCount, 32, "historical policy artifact has incomplete control coverage");
    assert.equal(committed.allPassed, true, "historical policy artifact recorded failed controls");
    assert.deepEqual(committed.failedControlIds, [], "historical policy artifact recorded failed control ids");
    assert.equal(committed.maxConcurrencyObserved <= 1, true, "historical policy artifact recorded parallel fallback");
    return;
  }

  assert.equal(
    committed.testedSha,
    head,
    "non-versioned policy artifact must target the current verification head",
  );
  assert.deepEqual(committed, await buildIssue927PolicyReport(committed.testedSha));
}

async function main(): Promise<void> {
  const artifact = process.argv.includes("--artifact")
    ? process.argv[process.argv.indexOf("--artifact") + 1]
    : DEFAULT_ARTIFACT;
  if (process.argv.includes("--verify") || process.argv.includes("--verify-if-present")) {
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
