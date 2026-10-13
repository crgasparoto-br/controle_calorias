/**
 * Food Intelligence V2 architecture report. Always prints machine-readable
 * JSON; CI writes it directly into a SHA-addressed workflow artifact.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findFoodStaticCandidates, findCompetingOwnerInventory } from "./food-intelligence-architecture";
import { type FoodDebt } from "./food-architecture-debt";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";
import { findFoodBaselineDelta, readFoodFilesAtGitRef } from "./food-architecture-baseline";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const root = process.cwd();
function walk(dir: string): string[] {
  const base = path.join(root, dir);
  if (!existsSync(base)) return [];
  return readdirSync(base).flatMap(entry => {
    if (["node_modules", "dist", ".git"].includes(entry)) return [];
    const p = path.join(dir, entry);
    return statSync(path.join(root, p)).isDirectory() ? walk(p) : [p.replace(/\\/g, "/")];
  });
}
function sha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}
const files = ["server", "shared", "client/src"].flatMap(walk)
  .filter(p => /\.[cm]?[jt]sx?$/.test(p))
  .map(p => ({ path: p, content: readFileSync(path.join(root, p), "utf8") }));
const findings = findFoodStaticCandidates(files);
const provisionalInventory = findCompetingOwnerInventory(files);
const ledger = JSON.parse(readFileSync(path.join(root, "architecture-debt.json"), "utf8")) as { entries: FoodDebt[] };
if (!Array.isArray(ledger.entries)) throw new Error("Invalid architecture debt ledger: entries array required");
const pinned = JSON.parse(readFileSync(path.join(root, "docs/design-docs/food-architecture-owners-1300.json"), "utf8")) as {
  baseSha: string;
  observations: Array<{ file: string; symbol: string; rules: string[]; review?: { classification: string; basis: string } }>;
};
if (pinned.baseSha !== "0040adffc989d0b4d47e7cdc640ab9878e82c993") {
  throw new Error("Unapproved architecture baseline SHA");
}
// Only individual occurrences present in the immutable reviewed baseline can
// inherit a confirmation. A modified or repeated symbol is not automatically approved.
const frozenFindings = findFoodStaticCandidates(readFoodFilesAtGitRef(pinned.baseSha, root));
const confirmedBudget = new Map<string, number>();
for (const finding of frozenFindings) {
  const review = pinned.observations.find(item =>
    item.file === finding.file && item.symbol === finding.symbol &&
    item.rules.includes(finding.ruleId));
  if (review?.review?.classification === "confirmed-legacy-violation") {
    confirmedBudget.set(finding.fingerprint, (confirmedBudget.get(finding.fingerprint) ?? 0) + 1);
  }
}
const inventory = provisionalInventory.map(finding => {
  const seed = pinned.observations.find(entry =>
    entry.file === finding.file && entry.symbol === finding.symbol &&
    entry.rules.includes(finding.ruleId));
  const confirmed = seed?.review?.classification === "confirmed-legacy-violation" &&
    (confirmedBudget.get(finding.fingerprint) ?? 0) > 0;
  if (confirmed) confirmedBudget.set(finding.fingerprint, confirmedBudget.get(finding.fingerprint)! - 1);
  const activeDebt = ledger.entries.find(debt => debt.fingerprint === finding.fingerprint);
  return {
    ...finding,
    review: {
      classification: confirmed ? "confirmed-legacy-violation" : "heuristic-candidate",
      basis: confirmed ? seed!.review!.basis : "AST candidate: no validated source-specific behavioral decision",
      debt: activeDebt ? "timeboxed" : "none",
      ...(activeDebt ? { owner: activeDebt.owner, issue: activeDebt.issue,
        expiresAt: activeDebt.expiresAt } : {}),
    },
  };
});
const inconsistentDebt = inventory.filter(item =>
  item.review.debt === "timeboxed" && item.review.classification !== "confirmed-legacy-violation");
if (inconsistentDebt.length) {
  throw new Error("Approved food architecture debt without confirmed inventory evidence: " +
    inconsistentDebt.map(item => item.fingerprint).join(", "));
}
const enforced = evaluateFoodArchitectureGate(
  findings, frozenFindings,
  ledger.entries, new Date(),
);
const baselineRef = process.env.GITHUB_BASE_REF ? "origin/" + process.env.GITHUB_BASE_REF : "origin/develop";
let baselineComparison: ReturnType<typeof findFoodBaselineDelta> | null = null;
let baselineSha: string | null = null;
let baselineError: string | null = null;
try {
  baselineSha = execFileSync("git", ["rev-parse", "--verify", baselineRef], { cwd: root, encoding: "utf8" }).trim();
  baselineComparison = findFoodBaselineDelta(files, baselineSha, root);
} catch (error) {
  baselineError = String(error);
}
const legacyFingerprints = new Set(enforced.delta.retained.map(item => item.fingerprint));
const triageQueue = inventory.filter(item =>
  item.review.classification === "heuristic-candidate" &&
  legacyFingerprints.has(item.fingerprint)).map(item => ({
    fingerprint: item.fingerprint, ruleId: item.ruleId, failureClass: item.failureClass,
    file: item.file, line: item.line, status: "pending-evidence",
  }));
const report = {
  sourceSha: sha(),
  enforcementBaselineSha: pinned.baseSha,
  baselineRef,
  baselineSha,
  baselineStatus: baselineError ? "unavailable" : "compared",
  baselineError,
  baseline: baselineComparison ? {
    newFindings: baselineComparison.added.length,
    retainedFindings: baselineComparison.retained.length,
    removedFindings: baselineComparison.removed.length,
    added: baselineComparison.added,
    removed: baselineComparison.removed,
  } : null,
  rules: FOOD_WAVE_ONE_RULES,
  scopeDecision: "ADR 25(25) DECIDIDO 2026-10-12: block new production violations",
  promotionDecision: "ADR 25(26) DECIDIDO 2026-10-12: runtime only after seven days and explicit approval",
  summary: {
    findings: findings.length,
    newViolations: enforced.delta.added.length,
    retainedLegacyCandidates: enforced.delta.retained.length,
    removedLegacyCandidates: enforced.delta.removed.length,
    pendingLegacyTriage: triageQueue.length,
    activeDebt: enforced.assessment.active,
    blockingErrors: enforced.errors.length,
    warnings: enforced.warnings.length,
    confirmedLegacyFindings: inventory.filter(item => item.review.classification === "confirmed-legacy-violation").length,
    heuristicCandidates: inventory.filter(item => item.review.classification === "heuristic-candidate").length,
  },
  inventory,
  triage: {
    sourceBaselineSha: pinned.baseSha,
    policy: "Review each candidate against source and runtime behavior before nominal debt approval; never auto-exempt.",
    pending: triageQueue,
  },
  enforcement: {
    errors: enforced.errors, activeDebtWarnings: enforced.assessment.warnings,
    newViolations: enforced.delta.added,
  },
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--enforce") && enforced.errors.length > 0) process.exitCode = 1;
if (process.argv.includes("--fail-new") && enforced.delta.added.length > 0) process.exitCode = 1;
if (process.argv.includes("--require-baseline") && !baselineComparison) process.exitCode = 1;
