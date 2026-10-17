/** AUD1300-20261017-F40: confirmed legacy lexicon must have nominal debt. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const sourcePath = "server/modules/whatsapp/foodClarificationContract.ts";
const fingerprint = "11:" + sourcePath + ":SAFE_TYPO_REPLACEMENTS:8cc36d28";
const today = new Date("2026-10-17T12:00:00Z");
const reviewed = [{
  file: sourcePath, symbol: "SAFE_TYPO_REPLACEMENTS", rules: ["11"],
  review: { classification: "confirmed-legacy-violation" },
}];
const pending = [{
  ...reviewed[0], review: { classification: "heuristic-candidate" },
}];

function snapshot() {
  return findFoodStaticCandidates([{
    path: sourcePath, content: readFileSync(sourcePath, "utf8"),
  }]);
}

describe("AUD1300-F40 confirmed lexical legacy gate", () => {
  it("pins the productive legacy lexicon and its frozen review anchor", () => {
    const actual = snapshot();
    expect(actual.some(f => f.ruleId === "11" && f.fingerprint === fingerprint)).toBe(true);
    const owners = JSON.parse(readFileSync("docs/design-docs/food-architecture-owners-1300.json", "utf8"));
    const seed = owners.observations.find((item: { file: string; symbol: string }) =>
      item.file === sourcePath && item.symbol === "SAFE_TYPO_REPLACEMENTS");
    expect(seed.review.classification).toBe("confirmed-legacy-violation");
    expect(seed.rules).toContain("11");
    expect(seed.sourceBlobSha).toBe("4a70e9a0d0bcdd70dfb19fe4c9019bfdd0a3cacb");
  });

  it("fails confirmed legacy without debt, but warns for unconfirmed candidates", () => {
    const actual = snapshot();
    const failed = evaluateFoodArchitectureGate(actual, actual, [], today, reviewed);
    expect(failed.errors).toContain("Confirmed legacy debt removed while violation remains: " + fingerprint);
    expect(failed.confirmedLegacyUncovered.some(f => f.fingerprint === fingerprint)).toBe(true);
    expect(failed.legacyUncovered.some(f => f.fingerprint === fingerprint)).toBe(false);
    const candidate = evaluateFoodArchitectureGate(actual, actual, [], today, pending);
    expect(candidate.errors).toEqual([]);
    expect(candidate.legacyUncovered.some(f => f.fingerprint === fingerprint)).toBe(true);
  });

  it("accepts the nominated debt and rejects orphaned or expired replacements", () => {
    const actual = snapshot();
    const ledger = JSON.parse(readFileSync("architecture-debt.json", "utf8"));
    const debt = ledger.entries.find((item: { fingerprint: string }) => item.fingerprint === fingerprint);
    expect(debt).toMatchObject({ ruleId: "11", file: sourcePath, owner: "crgasparoto-br",
      issue: 1300, migrationIssue: 1304, retirementIssue: 1313 });
    expect(evaluateFoodArchitectureGate(actual, actual, [debt], today, reviewed).errors).toEqual([]);
    const orphan = evaluateFoodArchitectureGate(actual, actual,
      [{ ...debt, fingerprint: debt.fingerprint + ":bad" }], today, reviewed);
    expect(orphan.errors.some(e => e.startsWith("Orphan/repaid"))).toBe(true);
    const expired = evaluateFoodArchitectureGate(actual, actual,
      [{ ...debt, expiresAt: "2026-10-16" }], today, reviewed);
    expect(expired.errors.some(e => e.startsWith("Expired"))).toBe(true);
  });

  it("blocks new hardcodes even when a debt is proposed in the same change", () => {
    const old = snapshot();
    const added = findFoodStaticCandidates([{ path: "server/modules/whatsapp/newFoodAlias.ts",
      content: "const FOOD_ALIASES = ['pitaya', 'cupuaçu'];" }]);
    expect(added.length).toBeGreaterThan(0);
    const debt = { ruleId: added[0]!.ruleId, file: added[0]!.file,
      fingerprint: added[0]!.fingerprint, reason: "unauthorized new debt",
      owner: "crgasparoto-br", issue: 1300, createdAt: "2026-10-17", expiresAt: "2027-01-15" };
    const verdict = evaluateFoodArchitectureGate([...old, ...added], old, [debt], today, reviewed);
    expect(verdict.errors.some(e => e.includes("New food architecture violation"))).toBe(true);
  });
});
