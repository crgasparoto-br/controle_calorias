/** ADR §19.0.3: architecture debt is an expiring, fingerprint-bound exception. */
import type { FoodFinding } from "./food-intelligence-architecture";

export type FoodDebt = {
  ruleId: string;
  file: string;
  fingerprint: string;
  reason: string;
  owner: string;
  issue: number;
  createdAt: string;
  expiresAt: string;
};

export function assessFoodDebt(findings: FoodFinding[], debts: FoodDebt[], today: Date) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = new Set<string>();
  const current = new Map(findings.map(f => [f.fingerprint, f]));
  for (const debt of debts) {
    const key = debt.fingerprint;
    const created = new Date(debt.createdAt + "T00:00:00Z");
    const expiry = new Date(debt.expiresAt + "T00:00:00Z");
    const validDates = /^\d{4}-\d{2}-\d{2}$/.test(debt.createdAt) &&
      /^\d{4}-\d{2}-\d{2}$/.test(debt.expiresAt) &&
      Number.isFinite(created.getTime()) && Number.isFinite(expiry.getTime()) &&
      created.toISOString().slice(0, 10) === debt.createdAt &&
      expiry.toISOString().slice(0, 10) === debt.expiresAt;
    if (!debt.owner?.trim() || !debt.reason?.trim() ||
      !Number.isInteger(debt.issue) || debt.issue <= 0 ||
      !debt.ruleId?.trim() || !debt.file?.trim() || !key?.trim()) {
      errors.push("Invalid debt ownership/reason/issue/fingerprint: " + String(key));
    }
    if (!validDates || expiry.getTime() < created.getTime() ||
      expiry.getTime() - created.getTime() > 90 * 86400000) {
      errors.push("Invalid 90-day debt period: " + String(key));
    }
    if (validDates && expiry.getTime() < Date.UTC(today.getUTCFullYear(),today.getUTCMonth(),today.getUTCDate())) {
      errors.push("Expired food architecture debt: " + key);
    }
    if (known.has(key)) errors.push("Duplicate food architecture debt: " + key);
    known.add(key);
    const match = current.get(key);
    if (!match || match.ruleId !== debt.ruleId || match.file !== debt.file) {
      errors.push("Orphan/repaid food architecture debt: " + key);
    } else if (validDates && expiry.getTime() >= Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
      const age = Math.max(0, Math.floor((today.getTime() - created.getTime()) / 86400000));
      warnings.push("Active architecture debt: " + key + " age=" + age + "d expires=" + debt.expiresAt);
    }
  }
  const uncovered = findings.filter(f => !known.has(f.fingerprint));
  for (const f of uncovered) errors.push("Uncovered architecture violation: " + f.fingerprint);
  return { errors, warnings, uncovered, active: findings.length - uncovered.length };
}


/**
 * Existing exceptions cannot be extended by changing their creation/expiry
 * dates or substituting their owner issue. CI compares against the base ref.
 */
export function assessFoodDebtRenewal(previous: FoodDebt[], current: FoodDebt[]) {
  const errors: string[] = [];
  const indexed = new Map(current.map(item => [item.fingerprint, item]));
  for (const old of previous) {
    const next = indexed.get(old.fingerprint);
    if (!next) continue; // repayment is allowed and required
    if (next.createdAt !== old.createdAt || next.expiresAt !== old.expiresAt ||
        next.issue !== old.issue || next.owner !== old.owner) {
      errors.push("Architecture debt renewal or owner reassignment denied: " + old.fingerprint);
    }
  }
  return errors;
}
