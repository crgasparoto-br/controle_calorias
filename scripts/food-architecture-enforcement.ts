/**
 * Food Intelligence V2 — enforcement of ADR §25(25), approved 2026-10-12.
 * Pinned legacy baseline is a temporary migration boundary, NOT an allowlist
 * for new findings or a way to renew debt. Runtime gates 6/8/15 are separate.
 */
import { compareFoodArchitectureFindings } from "./food-architecture-baseline";
import { assessFoodDebt, type FoodDebt } from "./food-architecture-debt";
import type { FoodFinding } from "./food-intelligence-architecture";

export function evaluateFoodArchitectureGate(
  current: FoodFinding[],
  baseline: FoodFinding[],
  debts: FoodDebt[],
  today: Date,
) {
  const delta = compareFoodArchitectureFindings(current, baseline);
  const assessment = assessFoodDebt(current, debts, today);
  const errors = [
    ...delta.added.map(f =>
      "New food architecture violation gate " + f.ruleId + " [" + f.failureClass +
      "] " + f.file + ":" + f.line + " " + f.symbol + " fingerprint=" + f.fingerprint),
    ...assessment.errors.filter(e => !e.startsWith("Uncovered architecture violation: ")),
  ];
  const legacyUncovered = delta.retained.filter(f =>
    !debts.some(d => d.fingerprint === f.fingerprint));
  const warnings = [
    ...assessment.warnings,
    ...legacyUncovered.map(f =>
      "Legacy food architecture candidate requires triage gate " + f.ruleId +
      " [" + f.failureClass + "] " + f.file + ":" + f.line + " " + f.symbol),
  ];
  return { errors, warnings, delta, legacyUncovered, assessment };
}
