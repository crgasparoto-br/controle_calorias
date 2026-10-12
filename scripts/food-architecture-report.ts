/**
 * Wave 1 discovery/preview. Run: pnpm exec tsx scripts/food-architecture-report.ts
 * --enforce is opt-in until ADR §25(25) settles generated/test/fixture scope.
 * The CI architecture gate must not silently promote preview findings to errors.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { findFoodStaticCandidates, findCompetingOwnerInventory } from "./food-intelligence-architecture";
import { assessFoodDebt, type FoodDebt } from "./food-architecture-debt";

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
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { return "unavailable"; }
}
const files = walk("server").filter(p => /\.[cm]?tsx?$/.test(p))
  .map(p => ({ path: p, content: readFileSync(path.join(root, p), "utf8") }));
const findings = findFoodStaticCandidates(files);
const inventory = findCompetingOwnerInventory(files);
const ledger = JSON.parse(readFileSync(path.join(root, "architecture-debt.json"), "utf8")) as { entries: FoodDebt[] };
if (!Array.isArray(ledger.entries)) throw new Error("Invalid architecture debt ledger: entries array required");
const debt = assessFoodDebt(findings, ledger.entries, new Date());
const report = {
  sourceSha: sha(),
  rules: [
    { id: "17", layer: 1, mode: "preview", matrixClasses: ["A", "C", "I"] },
    { id: "18", layer: 1, mode: "preview", matrixClasses: ["B"] },
  ],
  scopeDecision: "ADR 25(25) OPEN - no automatic block",
  promotionDecision: "ADR 25(26) OPEN - no automatic promotion",
  summary: { findings: findings.length, activeDebt: debt.active, uncovered: debt.uncovered.length,
    errors: debt.errors.length, warnings: debt.warnings.length },
  inventory,
  debt: { errors: debt.errors, warnings: debt.warnings },
};
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes("--enforce") && debt.errors.length > 0) process.exitCode = 1;
