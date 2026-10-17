/**
 * Food Intelligence V2 architecture report. Always prints machine-readable
 * JSON; CI writes it directly into a SHA-addressed workflow artifact.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findFoodStaticCandidates, findCompetingOwnerInventory, groupCompetingFoodOwners } from "./food-intelligence-architecture";
import { assessReviewedFoodDebt, type FoodDebt } from "./food-architecture-debt";
import { FOOD_WAVE_ONE_RULES } from "./food-architecture-rules";
import { findFoodBaselineDelta, readFoodFilesAtGitRef, readFoodWorkingFiles } from "./food-architecture-baseline";
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
const files = readFoodWorkingFiles(root);
const findings = findFoodStaticCandidates(files);
const provisionalInventory = findCompetingOwnerInventory(files);
const ledger = JSON.parse(readFileSync(path.join(root, "architecture-debt.json"), "utf8")) as { entries: FoodDebt[] };
if (!Array.isArray(ledger.entries)) throw new Error("Invalid architecture debt ledger: entries array required");
const pinned = JSON.parse(readFileSync(path.join(root, "docs/design-docs/food-architecture-owners-1300.json"), "utf8")) as {
  baseSha: string;
  observations: Array<{ file: string; symbol: string; rules: string[];
    review?: { classification: string; basis: string };
    behavioralReview?: {
      sourceAnchor: string; responsibility: string; observedDecision: string;
      disposition: string; verification: string; runtimeEvidence: string;
    };
  }>;
};
if (pinned.baseSha !== "0040adffc989d0b4d47e7cdc640ab9878e82c993") {
  throw new Error("Unapproved architecture baseline SHA");
}
// Only individual occurrences present in the immutable reviewed baseline can
// inherit a confirmation. A modified or repeated symbol is not automatically approved.
const frozenSourceFiles = readFoodFilesAtGitRef(pinned.baseSha, root);
const frozenFindings = findFoodStaticCandidates(frozenSourceFiles);
const frozenSourceIndex = new Map(frozenSourceFiles.map(file => [file.path, file.content]));
const reviewedOwnerResponsibilities = pinned.observations.map(item => {
  const review = item.behavioralReview;
  const source = frozenSourceIndex.get(item.file);
  if (!review || !review.sourceAnchor || !source?.includes(review.sourceAnchor)) {
    throw new Error("Stale or missing owner source review at immutable develop SHA: " +
      item.file + "#" + item.symbol);
  }
  return {
    file: item.file, symbol: item.symbol, baseSha: pinned.baseSha,
    responsibility: review.responsibility, observedDecision: review.observedDecision,
    disposition: review.disposition, sourceAnchor: review.sourceAnchor,
    status: "source-reviewed" as const,
    // Static source evidence can identify behavior but cannot alone certify
    // that two active runtime paths have equal authority or equivalent outputs.
    runtimeEquivalence: "requires-behavioral-review" as const,
  };
});
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
        migrationIssue: activeDebt.migrationIssue, retirementIssue: activeDebt.retirementIssue,
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
const reviewedDebtErrors = assessReviewedFoodDebt(
  findings, frozenFindings, ledger.entries, pinned.observations,
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
const rawTriageQueue = inventory.filter(item =>
  item.review.classification === "heuristic-candidate" &&
  legacyFingerprints.has(item.fingerprint)).map(item => ({
    fingerprint: item.fingerprint, ruleId: item.ruleId, failureClass: item.failureClass,
    file: item.file, line: item.line, status: "pending-evidence",
  }));
// Two expressions may yield the same fingerprint even on one source line.
// Preserve a distinct, deterministic review identity for each occurrence.
const occurrenceKey = (item: (typeof rawTriageQueue)[number]) => JSON.stringify([
  item.fingerprint, item.file, item.line, item.ruleId, item.failureClass,
]);
const occurrenceTotals = new Map<string, number>();
const occurrenceSeen = new Map<string, number>();
for (const item of rawTriageQueue) {
  const key = occurrenceKey(item);
  occurrenceTotals.set(key, (occurrenceTotals.get(key) ?? 0) + 1);
}
const triageQueue = rawTriageQueue.map(item => {
  const key = occurrenceKey(item);
  const occurrenceIndex = (occurrenceSeen.get(key) ?? 0) + 1;
  occurrenceSeen.set(key, occurrenceIndex);
  return { ...item, occurrenceIndex, occurrenceCount: occurrenceTotals.get(key)! };
});
// R1300-05: process *every* pending candidate rather than sampling. Prove
// the source/line at this SHA, but never call source inspection a behavioral
// certification of a competing owner or a nutrition rule.
const sourceSha = sha();
const sourceLines = new Map(files.map(file => [file.path, file.content.split(/\r?\n/)]));
const sourceAnchoredTriage = triageQueue.map(item => {
  const lines = sourceLines.get(item.file);
  const line = lines?.[item.line - 1];
  if (!line?.trim()) throw new Error("Unverifiable architecture triage source at " +
    sourceSha + " " + item.file + ":" + item.line);
  return {
    ...item,
    evidence: {
      kind: "source-line-only" as const,
      sourceSha,
      lineSha256: createHash("sha256").update(line).digest("hex"),
      sourceLocationValidated: true,
      behavioralDecisionCertified: false,
      nextVerification: "Confirm runtime decision, compare with canonical owner, then review disposition",
    },
  };
});
const report = {
  sourceSha,
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
    blockingErrors: enforced.errors.length + reviewedDebtErrors.length,
    warnings: enforced.warnings.length,
    confirmedLegacyFindings: inventory.filter(item => item.review.classification === "confirmed-legacy-violation").length,
    heuristicCandidates: inventory.filter(item => item.review.classification === "heuristic-candidate").length,
  },
  inventory,
  ownerInventory: {
    sourceSha: sha(),
    reviewPolicy: "AST owner candidates grouped by domain decision; competing responsibility requires runtime review",
    byDecisionFunction: groupCompetingFoodOwners(provisionalInventory),
    reviewedLegacyResponsibilities: reviewedOwnerResponsibilities,
    // Each unapproved legacy candidate stays individually traceable by SHA.
    // This is a review queue, not a certified inventory of competing runtime owners.
    pendingBehavioralReviews: sourceAnchoredTriage.map(item => ({
      sourceBaselineSha: pinned.baseSha,
      fingerprint: item.fingerprint, failureClass: item.failureClass,
      file: item.file, line: item.line, ruleId: item.ruleId,
      occurrenceIndex: item.occurrenceIndex, occurrenceCount: item.occurrenceCount,
      evidence: item.evidence,
      status: "requires-behavioral-review" as const,
    })),
    reviewTotals: {
      pendingBehavioralReviews: sourceAnchoredTriage.length,
      sourceAnchoredPending: sourceAnchoredTriage.length,
      sourceReviewed: reviewedOwnerResponsibilities.length,
      decisionOwnerCandidates: reviewedOwnerResponsibilities.filter(item =>
        item.disposition.endsWith("-decision-owner")).length,
      runtimeEquivalenceCertified: 0,
      runtimeEquivalenceStatus: "pending-behavioral-review",
    },
  },
  triage: {
    sourceBaselineSha: pinned.baseSha,
    policy: "Review each candidate against source and runtime behavior before nominal debt approval; never auto-exempt.",
    reviewRequirements: [
      "Record runtime food decision and exact source revision for this fingerprint",
      "Compare the result and responsibility against the canonical food decision owner",
      "Approve or reject each legacy violation explicitly before any nominal timeboxed debt",
      "Never treat a source-line hash or heuristic candidate as runtime certification",
    ],
    pendingByFailureClass: Object.fromEntries(
      ["A", "B", "C", "E", "I"].map(classId =>
        [classId, sourceAnchoredTriage.filter(item => item.failureClass === classId).length]),
    ),
    pending: sourceAnchoredTriage,
  },
  enforcement: {
    errors: [...enforced.errors, ...reviewedDebtErrors], activeDebtWarnings: enforced.assessment.warnings,
    newViolations: enforced.delta.added,
  },
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--enforce") && enforced.errors.length + reviewedDebtErrors.length > 0) process.exitCode = 1;
if (process.argv.includes("--fail-new") && enforced.delta.added.length > 0) process.exitCode = 1;
if (process.argv.includes("--require-baseline") && !baselineComparison) process.exitCode = 1;
