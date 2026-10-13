import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, isProductionFoodSource } from "./food-intelligence-architecture";
import { assessFoodDebt, assessFoodDebtRenewal } from "./food-architecture-debt";
import { compareFoodArchitectureFindings } from "./food-architecture-baseline";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const today = new Date("2026-10-12T12:00:00Z");
const legacy = { path: "server/foodCatalogReference.ts", content: "const FOOD_ALIASES = ['pao', 'pão'];" };
const finding = findFoodStaticCandidates([legacy])[0];

describe("food intelligence architecture wave 1", () => {
  it("detects food literals in production but not fixture/docs/test code", () => {
    expect(finding).toMatchObject({ ruleId: "17", file: legacy.path, failureClass: "A" });
    expect(findFoodStaticCandidates([{ ...legacy, path: "server/foodCatalogReference.test.ts" }])).toEqual([]);
    expect(isProductionFoodSource("docs/example.ts")).toBe(false);
    expect(findFoodStaticCandidates([{ path: "server/quantities.ts", content: "const units = [1, 2];" }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/importer.ts", content:
      "const records = [{ name: 'pao', calories: 75, protein: 2 }];" }]).some(f => f.ruleId === "17")).toBe(true);
  });

  it("detects a scalar food hardcode or food-specific if/branch in production", () => {
    const findings = findFoodStaticCandidates([{
      path: "server/foodRules.ts",
      content: "const DEFAULT_FOOD_NAME = 'pão'; function resolve(input: { foodName: string }) { return input.foodName === 'ovo'; }",
    }]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol === "DEFAULT_FOOD_NAME")).toBe(true);
    expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("lexical-branch"))).toBe(true);
    expect(findFoodStaticCandidates([{ path: "server/utils.ts",
      content: "function ordinary(mode: string) { return mode === 'auto'; }" }])).toEqual([]);
  });

  it("detects hardcoded attribute materiality token sets", () => {
    const matches = findFoodStaticCandidates([{
      path: "server/materiality.ts",
      content: "const ATTRIBUTE_MATERIALITY_TOKENS = new Set(['integral', 'light']);",
    }]);
    expect(matches).toMatchObject([{ ruleId: "18", failureClass: "B" }]);
    const legacy = findFoodStaticCandidates([{ path: "server/foodItemResolution.ts", content:
      "const NUTRITIONALLY_NEUTRAL_PACKAGING_TOKENS = new Set(['longa vida']);" }]);
    expect(legacy.some(f => f.ruleId === "18")).toBe(true);
    const inline = findFoodStaticCandidates([{ path: "server/foodMateriality.ts", content:
      "function isMaterialAttribute(variant: string) { return variant === 'integral'; }" }]);
    expect(inline.some(f => f.ruleId === "18" && f.symbol.includes("lexical-branch"))).toBe(true);
  });

  it("detects typed production catalogs and channel lexicons, not type-only imports", () => {
    const findings = findFoodStaticCandidates([
      { path: "server/foodCatalogReference.ts", content:
        "export const FOOD_CATALOG_REFERENCE: CatalogFoodReference[] = [{ name: 'ovo', calories: 78 }];" },
      { path: "server/modules/whatsapp/informalLanguageNormalizer.ts", content:
        "const BUILT_IN_REPLACEMENTS = [{raw: 'refri', normalized: 'refrigerante'}];" },
      { path: "server/modules/whatsapp/imageAdapter.ts", content:
        "import type { X } from '../../nutritionEngine';" },
      { path: "server/modules/whatsapp/anotherImageAdapter.ts", content:
        "import { type X } from '../../nutritionEngine';" },
    ]);
    expect(findings.some(f => f.ruleId === "5" && f.file.endsWith("foodCatalogReference.ts"))).toBe(true);
    expect(findings.some(f => f.ruleId === "11" && f.file.endsWith("informalLanguageNormalizer.ts"))).toBe(true);
    expect(findings.some(f => f.ruleId === "10")).toBe(false);
  });

  it("detects candidate owner, adapter bypass and round-trip without treating them as proven runtime failures", () => {
    const findings = findFoodStaticCandidates([{
      path: "server/modules/whatsapp/intent/foodAdapter.ts",
      content: [
        "import { foo } from '../../../nutritionEngine';",
        "function resolveNutrition(input: string) { return input; }",
        "const nutrition = findLocalNutritionReference(item);",
        "const roundTrip = parseFoodText(decision.normalizedText);",
      ].join("\n"),
    }]);
    for (const id of ["1", "2", "3", "4", "10"]) {
      expect(findings.some(f => f.ruleId === id), "missing gate " + id).toBe(true);
    }
    expect(findings.every(f => f.fingerprint.includes(f.file))).toBe(true);
  });

  it("keeps fingerprints stable for whitespace changes but changes on rule material changes", () => {
    const input = { path: "server/food.ts", content: "const FOOD_ALIASES = ['ovo'];" };
    const a = findFoodStaticCandidates([input])[0];
    const b = findFoodStaticCandidates([{ ...input, content: "\n  const FOOD_ALIASES = ['ovo'];" }])[0];
    const c = findFoodStaticCandidates([{ ...input, content: "const FOOD_ALIASES = ['pão'];" }])[0];
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(a.fingerprint).not.toBe(c.fingerprint);
    const d = findFoodStaticCandidates([{ ...input, content: "const FOOD_ALIASES = ['ovo  ao forno'];" }])[0];
    const e = findFoodStaticCandidates([{ ...input, content: "const FOOD_ALIASES = ['ovo ao forno'];" }])[0];
    expect(d.fingerprint).not.toBe(e.fingerprint);
  });

  it("distinguishes new hardcodes from existing debt and resolved legacy by fingerprint", () => {
    const current = findFoodStaticCandidates([legacy, {
      path: "server/newFood.ts",
      content: "const FOOD_PORTIONS = [{ name: 'pão', grams: 25 }];",
    }]);
    const baseline = findFoodStaticCandidates([legacy, {
      path: "server/oldFood.ts",
      content: "const FOOD_ALIASES = ['old'];",
    }]);
    const delta = compareFoodArchitectureFindings(current, baseline);
    expect(delta.added.some(f => f.file === "server/newFood.ts")).toBe(true);
    expect(delta.retained.some(f => f.fingerprint === finding.fingerprint)).toBe(true);
    expect(delta.removed.some(f => f.file === "server/oldFood.ts")).toBe(true);
  });

  it("blocks new hardcodes even if added to debt in the same PR, while reporting old candidates", () => {
    const fresh = findFoodStaticCandidates([{
      path: "server/newHardcode.ts",
      content: "const FOOD_PORTIONS = [{ name: 'pão', grams: 25 }];",
    }]);
    const debt = {
      ruleId: fresh[0].ruleId, file: fresh[0].file, fingerprint: fresh[0].fingerprint,
      reason: "must not mask new code", owner: "food-team", issue: 1300,
      createdAt: "2026-10-12", expiresAt: "2026-12-12",
    };
    const result = evaluateFoodArchitectureGate([...fresh, finding], [finding], [debt], today);
    expect(result.errors.some(e => e.includes("New food architecture violation"))).toBe(true);
    expect(result.legacyUncovered).toHaveLength(1);
    expect(evaluateFoodArchitectureGate([finding], [finding], [], today).errors).toEqual([]);
    expect(evaluateFoodArchitectureGate([finding], [finding], [], today).legacyUncovered).toHaveLength(1);
    expect(evaluateFoodArchitectureGate([finding], [finding], [{ ...debt, ruleId: finding.ruleId,
      file: finding.file, fingerprint: finding.fingerprint, expiresAt: "2026-10-01" }], today)
      .errors.some(e => e.includes("Expired"))).toBe(true);
  });

  it("scans productive shared/client code and imported fixtures, not isolated samples", () => {
    const example = "const FOOD_ALIASES = ['ovo', 'ovos'];";
    expect(findFoodStaticCandidates([{ path: "shared/foodKnowledge.ts", content: example }])).toHaveLength(1);
    expect(findFoodStaticCandidates([{ path: "client/src/foodKnowledge.ts", content: example }])).toHaveLength(1);
    const fixture = { path: "server/fixtures/foodData.ts", content: example };
    const generated = { path: "server/generated/foodData.ts", content: example };
    expect(findFoodStaticCandidates([fixture, generated])).toEqual([]);
    const active = findFoodStaticCandidates([fixture, {
      path: "server/liveService.ts", content: "import { FOOD_ALIASES } from './fixtures/foodData';",
    }]);
    expect(active.some(f => f.file === fixture.path)).toBe(true);
    expect(findFoodStaticCandidates([generated, {
      path: "server/liveService.ts", content: "import type { FoodData } from './generated/foodData';",
    }])).toEqual([]);
    expect(isProductionFoodSource("server/food.generated.ts")).toBe(false);
    expect(isProductionFoodSource("server/food.fixture.ts")).toBe(false);
    expect(findFoodStaticCandidates([{ path: "server/food.generated.ts", content: example }])).toEqual([]);
    expect(isProductionFoodSource("server/x.spec.ts")).toBe(false);
    expect(isProductionFoodSource("docs/recipe.ts")).toBe(false);
  });

  it("fails uncovered and orphaned debt", () => {
    expect(assessFoodDebt([finding], [], today).errors).toContain(
      "Uncovered architecture violation: " + finding.fingerprint);
    const debt = {
      ruleId: finding.ruleId, file: finding.file, fingerprint: finding.fingerprint,
      reason: "legacy migration", owner: "food-team", issue: 1300,
      createdAt: "2026-10-01", expiresAt: "2026-12-01",
    };
    expect(assessFoodDebt([], [debt], today).errors.some(s => s.includes("Orphan"))).toBe(true);
    expect(assessFoodDebt([finding], [debt], today).errors).toEqual([]);
    expect(assessFoodDebt([finding], [debt], today).warnings).toHaveLength(1);
  });

  it("denies renewal and owner reassignment but permits repayment", () => {
    const old = {
      ruleId: finding.ruleId, file: finding.file, fingerprint: finding.fingerprint,
      reason: "migration", owner: "food-team", issue: 1300,
      createdAt: "2026-10-01", expiresAt: "2026-12-01",
    };
    expect(assessFoodDebtRenewal([old], [{ ...old, expiresAt: "2027-01-01" }])).toHaveLength(1);
    expect(assessFoodDebtRenewal([old], [{ ...old, createdAt: "2026-10-10" }])).toHaveLength(1);
    expect(assessFoodDebtRenewal([old], [{ ...old, owner: "different" }])).toHaveLength(1);
    expect(assessFoodDebtRenewal([old], [{ ...old, fingerprint: old.fingerprint.replace(/:[^:]+$/, ":newhash") }])).toHaveLength(1);
    expect(assessFoodDebtRenewal([old], [])).toEqual([]);
    expect(assessFoodDebtRenewal([old], [old])).toEqual([]);
  });

  it("fails expired, over-90-day and unowned debt", () => {
    const debt = {
      ruleId: finding.ruleId, file: finding.file, fingerprint: finding.fingerprint,
      reason: "legacy", owner: "team", issue: 1300,
      createdAt: "2026-01-01", expiresAt: "2026-02-01",
    };
    expect(assessFoodDebt([finding], [debt], today).errors.some(s => s.includes("Expired"))).toBe(true);
    expect(assessFoodDebt([finding], [{ ...debt, expiresAt: "2027-01-01" }], today)
      .errors.some(s => s.includes("90-day"))).toBe(true);
    expect(assessFoodDebt([finding], [{ ...debt, owner: "", issue: 0 }], today)
      .errors.some(s => s.includes("ownership"))).toBe(true);
    expect(assessFoodDebt([finding], [{ ...debt, createdAt: "2027-01-01", expiresAt: "2027-02-01" }], today)
      .errors.some(s => s.includes("Future-dated"))).toBe(true);
  });
});
