/** ADR §19.0.3: architecture debt is an expiring, fingerprint-bound exception. */
import { readFileSync } from "node:fs";
import path from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import type { FoodFinding } from "./food-intelligence-architecture";
import { FOOD_WAVE_ONE_IDS, type FoodWaveOneRuleId } from "./food-architecture-rules";

export type FoodDebt = {
  ruleId: FoodWaveOneRuleId;
  file: string;
  fingerprint: string;
  reason: string;
  owner: string;
  issue: number;
  /** Existing migration work owns replacing the legacy behavior. */
  migrationIssue: number;
  /** Cutover work owns retiring the remaining legacy fingerprint. */
  retirementIssue: number;
  createdAt: string;
  expiresAt: string;
};

export type FoodDebtLedger = { $schema?: string; entries: FoodDebt[] };

/** The JSON schema is executable at every consumer boundary, before casting. */
export function validateFoodDebtLedger(value: unknown, cwd = process.cwd()): FoodDebtLedger {
  const schemaPath = path.join(cwd, "docs/design-docs/food-architecture-debt.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);
  if (!validate(value)) {
    throw new Error("Invalid architecture debt ledger: " +
      ajv.errorsText(validate.errors, { separator: "; " }));
  }
  const ledger = value as FoodDebtLedger;
  const known = new Set<string>(FOOD_WAVE_ONE_IDS);
  const unknown = ledger.entries.filter(entry => !known.has(entry.ruleId));
  if (unknown.length) throw new Error("Unknown architecture debt ruleId: " +
    unknown.map(entry => entry.ruleId).join(", "));
  return ledger;
}

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
    if (validDates && created.getTime() > Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())) {
      errors.push("Future-dated food architecture debt: " + key);
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
/** ADR 25.2: a reviewed legacy violation requires a nominal debt until repaid.
 * This anchor works even before architecture-debt.json lands in develop.
 * An unreviewed AST candidate must never become an approved exception.
 */
export type ReviewedFoodDebtSeed = {
  file: string;
  symbol: string;
  rules: readonly string[];
  review?: { classification: string };
};

export function assessReviewedFoodDebt(
  currentFindings: FoodFinding[],
  frozenBaseline: FoodFinding[],
  debts: FoodDebt[],
  reviewedSeeds: readonly ReviewedFoodDebtSeed[],
): string[] {
  const approved = new Set(frozenBaseline.filter(finding =>
    reviewedSeeds.some(seed =>
      seed.file === finding.file && seed.symbol === finding.symbol &&
      seed.rules.includes(finding.ruleId) &&
      seed.review?.classification === "confirmed-legacy-violation"),
  ).map(finding => finding.fingerprint));
  const current = new Set(currentFindings.map(finding => finding.fingerprint));
  const debtKeys = new Set(debts.map(debt => debt.fingerprint));
  const errors: string[] = [];
  for (const fingerprint of approved) {
    if (current.has(fingerprint) && !debtKeys.has(fingerprint)) {
      errors.push("Confirmed legacy debt removed while violation remains: " + fingerprint);
    }
  }
  for (const debt of debts) {
    if (!approved.has(debt.fingerprint)) {
      errors.push("Architecture debt lacks source-reviewed immutable legacy approval: " + debt.fingerprint);
    }
  }
  return errors;
}

export function assessFoodDebtRenewal(previous: FoodDebt[], current: FoodDebt[], currentFindings: FoodFinding[]) {
  const errors: string[] = [];
  const rejectDuplicates = (items: FoodDebt[], label: string): void => {
    const seen = new Set<string>();
    for (const item of items) {
      if (seen.has(item.fingerprint)) {
        errors.push(`Duplicate ${label} food architecture debt: ${item.fingerprint}`);
      }
      seen.add(item.fingerprint);
    }
  };
  rejectDuplicates(previous, "previous");
  rejectDuplicates(current, "current");
  const indexed = new Map(current.map(item => [item.fingerprint, item]));
  for (const old of previous) {
    const next = indexed.get(old.fingerprint);
    if (!next) {
      const base = old.ruleId + ":" + old.file + ":";
      const oldSymbol = old.fingerprint.slice(base.length).split(":")[0];
      const reissued = current.find(item => item.fingerprint !== old.fingerprint &&
        item.ruleId === old.ruleId && item.file === old.file &&
        item.fingerprint.startsWith(base + oldSymbol + ":"));
      if (reissued) errors.push("Architecture debt cannot be reissued under a new fingerprint: " + old.fingerprint);
      // Repayment requires removing the underlying violation, not just the
      // ledger entry. Without this check debt can be dropped and renewed later.
      if (currentFindings.some(f => f.fingerprint === old.fingerprint && f.ruleId === old.ruleId && f.file === old.file)) {
        errors.push("Architecture debt removed while violation remains: " + old.fingerprint);
      }
      continue; // actual repayment is allowed only after fixing the code
    }
    if (next.createdAt !== old.createdAt || next.expiresAt !== old.expiresAt ||
        next.issue !== old.issue || next.owner !== old.owner ||
        next.migrationIssue !== old.migrationIssue ||
        next.retirementIssue !== old.retirementIssue) {
      errors.push("Architecture debt renewal or owner reassignment denied: " + old.fingerprint);
    }
  }
  return errors;
}
