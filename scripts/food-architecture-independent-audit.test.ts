/** Independent adversarial contract matrix for Issue #1300.
 * Keep these cases separate from implementation-local regressions.
 * Every positive case must be detected AND rejected by the wave-one gate.
 */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const asOf = new Date("2026-10-16T12:00:00Z");
const assess = (files: FoodArchitectureFile[]) => {
  const findings = findFoodStaticCandidates(files);
  return { findings, verdict: evaluateFoodArchitectureGate(findings, [], [], asOf) };
};

describe("AUD1300 independent adversarial architecture contract", () => {
  it("blocks food-specific literals even when placed under an administrative directory", () => {
    const control = assess([{
      path: "server/foodCatalogReference.ts",
      content: "const FOOD_ALIASES = ['pao', 'pão'];",
    }]);
    const adversarial = assess([{
      path: "server/account/foodCatalogReference.ts",
      content: "const FOOD_ALIASES = ['pao', 'pão'];",
    }]);
    expect(control.findings.some(f => f.ruleId === "17")).toBe(true);
    expect(adversarial.findings.some(f => f.ruleId === "17")).toBe(true);
    expect(adversarial.verdict.errors.length).toBeGreaterThan(0);
  });

  it("tracks imported food JSON by runtime consumption rather than directory label", () => {
    const findings = assess([
      { path: "server/account/data/records.json", content: JSON.stringify([
        { name: "pão", calories: 90 }, { name: "arroz", calories: 130 },
      ]) },
      { path: "server/account/foodService.ts", content:
        'import rows from "./data/records.json"; function selectFood(input: string) { return rows.find(row => row.name === input); }' },
    ]);
    expect(findings.findings.some(f =>
      f.file === "server/account/data/records.json" && (f.ruleId === "17" || f.ruleId === "5"))).toBe(true);
    expect(findings.verdict.errors.length).toBeGreaterThan(0);
  });

  it("never lets a debt entry introduced alongside a new finding exempt it", () => {
    const files: FoodArchitectureFile[] = [{
      path: "server/foodCatalogReference.ts",
      content: "const FOOD_ALIASES = ['pao', 'pão'];",
    }];
    const findings = findFoodStaticCandidates(files);
    expect(findings.length).toBeGreaterThan(0);
    const first = findings[0]!;
    const inventedDebt = {
      ruleId: first.ruleId, file: first.file, fingerprint: first.fingerprint,
      reason: "candidate", owner: "crgasparoto-br", issue: 1300,
      createdAt: "2026-10-16", expiresAt: "2026-11-16",
    };
    // The baseline must remain authoritative even if a debt is supplied.
    const verdict = evaluateFoodArchitectureGate(findings, [], [inventedDebt], asOf);
    expect(verdict.errors.some(e => e.startsWith("New food architecture violation"))).toBe(true);
  });

  it("does not convert ordinary status or account settings into food violations", () => {
    const files: FoodArchitectureFile[] = [
      { path: "server/account/settings.ts", content:
        'import fs from "node:fs"; function getAccountSettings(filePath: string) { return JSON.parse(fs.readFileSync(filePath, "utf8")); }' },
      { path: "server/admin/status.ts", content:
        'async function getAdminStatus(filePath: string) { return import(filePath); }' },
    ];
    const { findings } = assess(files);
    expect(findings.some(f => files.some(file => file.path === f.file) &&
      (f.ruleId === "17" || f.ruleId === "5"))).toBe(false);
  });
});
