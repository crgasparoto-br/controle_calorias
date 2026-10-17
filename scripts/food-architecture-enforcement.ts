/**
 * Food Intelligence V2 — enforcement of ADR §25(25), approved 2026-10-12.
 * Pinned legacy baseline is a temporary migration boundary, NOT an allowlist
 * for new findings or a way to renew debt. Runtime gates 6/8/15 are separate.
 */
import { compareFoodArchitectureFindings } from "./food-architecture-baseline";
import { assessFoodDebt, assessReviewedFoodDebt, type FoodDebt, type ReviewedFoodDebtSeed } from "./food-architecture-debt";
import type { FoodFinding } from "./food-intelligence-architecture";

export function evaluateFoodArchitectureGate(
  current: FoodFinding[],
  baseline: FoodFinding[],
  debts: FoodDebt[],
  today: Date,
  reviewedSeeds: readonly ReviewedFoodDebtSeed[] = [],
) {
  const delta = compareFoodArchitectureFindings(current, baseline);
  const assessment = assessFoodDebt(current, debts, today);
  // A source-reviewed legacy violation is enforceable only if it existed in the
  // immutable baseline. Heuristic legacy candidates remain warnings until
  // individually confirmed; a new finding always fails regardless of debt.
  const confirmedBaseline = new Set(baseline.filter(finding =>
    reviewedSeeds.some(seed =>
      seed.file === finding.file && seed.symbol === finding.symbol &&
      seed.rules.includes(finding.ruleId) &&
      seed.review?.classification === "confirmed-legacy-violation"),
  ).map(finding => finding.fingerprint));
  const debtKeys = new Set(debts.map(debt => debt.fingerprint));
  const confirmedLegacyUncovered = delta.retained.filter(finding =>
    confirmedBaseline.has(finding.fingerprint) && !debtKeys.has(finding.fingerprint));
  // Preserve the original four-argument API for isolated legacy candidate
  // probes. Production check/report always provide the reviewed source ledger.
  const reviewedDebtErrors = reviewedSeeds.length > 0
    ? assessReviewedFoodDebt(current, baseline, debts, reviewedSeeds)
    : [];
  const errors = [
    ...delta.added.map(f =>
      "New food architecture violation gate " + f.ruleId + " [" + f.failureClass +
      "] " + f.file + ":" + f.line + " " + f.symbol + " fingerprint=" + f.fingerprint),
    ...assessment.errors.filter(e => !e.startsWith("Uncovered architecture violation: ")),
    ...reviewedDebtErrors,
  ];
  const legacyUncovered = delta.retained.filter(f =>
    !debtKeys.has(f.fingerprint) && !confirmedBaseline.has(f.fingerprint));
  const warnings = [
    ...assessment.warnings,
    ...legacyUncovered.map(f =>
      "Legacy food architecture candidate requires triage gate " + f.ruleId +
      " [" + f.failureClass + "] " + f.file + ":" + f.line + " " + f.symbol),
  ];
  return { errors, warnings, delta, legacyUncovered, confirmedLegacyUncovered, assessment };
}
