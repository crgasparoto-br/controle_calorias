import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { normalizeWhatsappInformalLanguage } from "../server/modules/whatsapp/informalLanguageNormalizer";
import { normalizeText } from "../server/mealTextParsing";
import { findFoodStaticCandidates, isProductionFoodSource, findCompetingOwnerInventory, groupCompetingFoodOwners } from "./food-intelligence-architecture";
import { assessFoodDebt, assessFoodDebtRenewal, assessReviewedFoodDebt } from "./food-architecture-debt";
import { compareFoodArchitectureFindings, isFoodArchitectureSourcePath, readFoodWorkingFiles } from "./food-architecture-baseline";
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

  it("R1300-01 tracks each approved debt to specific migration and retirement issues", () => {
    const debtBook = JSON.parse(readFileSync("architecture-debt.json", "utf8")) as {
      entries: Array<{ issue: number; migrationIssue: number; retirementIssue: number;
        fingerprint: string; ruleId: string; file: string; reason: string; owner: string;
        createdAt: string; expiresAt: string }>;
    };
    expect(debtBook.entries).toHaveLength(12);
    for (const entry of debtBook.entries) {
      expect(entry.issue).toBe(1300);
      expect([1302, 1304, 1305, 1306]).toContain(entry.migrationIssue);
      expect(entry.retirementIssue).toBe(1313);
      expect(entry.retirementIssue).not.toBe(entry.issue);
    }
    const entry = debtBook.entries[0];
    expect(assessFoodDebtRenewal([entry], [{ ...entry, retirementIssue: 1312 }]))
      .toHaveLength(1);
    expect(assessFoodDebtRenewal([entry], [{ ...entry, migrationIssue: 1303 }]))
      .toHaveLength(1);
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
  it("F01 blocks numeric portions and inline nutrition objects without named catalogs", () => {
    const findings = findFoodStaticCandidates([{
      path: "server/foodResolver.ts",
      content: [
        "const FOOD_PORTION_GRAMS = 25;",
        "function makeFood() { return { name: 'ovo', calories: 78, protein: 6 }; }",
      ].join("\n"),
    }]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol === "FOOD_PORTION_GRAMS")).toBe(true);
    expect(findings.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge")).toBe(true);
    expect(findFoodStaticCandidates([{
      path: "server/unrelated.ts", content: "const RETRY_COUNT = 25; function make(){return { name: 'test', count: 3 };}",
    }])).toEqual([]);
  });

  it("F02 detects inline lexical membership and unnamed food channel dictionaries", () => {
    const material = findFoodStaticCandidates([{
      path: "server/foodMateriality.ts",
      content: "function isMaterialAttribute(variant: string) { return ['integral', 'light'].includes(variant); }",
    }]);
    expect(material.some(f => f.ruleId === "18" && f.symbol.includes("lexical-membership"))).toBe(true);
    const vocabulary = findFoodStaticCandidates([{
      path: "server/modules/whatsapp/foodMessageNormalizer.ts",
      content: [
        "function normalizeFoodName(value: string) {",
        " const map = { refri: 'refrigerante', cafezinho: 'café' };",
        " return ['refri', 'cafezinho'].includes(value) ? map.refri : value;",
        "}",
      ].join("\n"),
    }]);
    expect(vocabulary.some(f => f.ruleId === "11")).toBe(true);
    expect(findFoodStaticCandidates([{
      path: "server/modules/whatsapp/foodAdapter.ts",
      content: "const STATUS_LABELS = { pending: 'Pendente', saved: 'Salvo' };",
    }]).filter(f => f.ruleId === "11")).toEqual([]);
    expect(findFoodStaticCandidates([{
      path: "server/utility.ts",
      content: "function supports(mode:string) {return ['auto', 'manual'].includes(mode);}",
    }])).toEqual([]);
  });

  it("F03 traverses runtime dynamic imports, require and reexports of excluded source", () => {
    const generated = { path: "server/generated/knownFood.ts",
      content: "const FOOD_ALIASES = ['pão', 'paes'];" };
    for (const consumer of [
      "async function getData(){ return import('./generated/knownFood'); }",
      "const data = require('./generated/knownFood');",
      "export { FOOD_ALIASES } from './generated/knownFood';",
    ]) {
      const findings = findFoodStaticCandidates([generated, {
        path: "server/liveService.ts", content: consumer,
      }]);
      expect(findings.some(f => f.file === generated.path && f.ruleId === "17"),
        "runtime import should activate generated data: " + consumer).toBe(true);
    }
    expect(findFoodStaticCandidates([generated, {
      path: "server/liveService.ts", content:
        "export type { FoodAliases } from './generated/knownFood';",
    }])).toEqual([]);
    const fixture = { path: "client/src/fixtures/foodData.ts",
      content: "const FOOD_ALIASES = ['pão', 'paes'];" };
    const alias = findFoodStaticCandidates([fixture, {
      path: "client/src/liveService.ts", content:
        "async function load(){ return import('@/fixtures/foodData'); }",
    }]);
    expect(alias.some(f => f.file === fixture.path)).toBe(true);
    const sharedFixture = { path: "shared/fixtures/knownFood.ts",
      content: "const FOOD_ALIASES = ['pão', 'paes'];" };
    expect(findFoodStaticCandidates([sharedFixture, {
      path: "server/liveService.ts", content:
        "export * from '@shared/fixtures/knownFood';",
    }]).some(f => f.file === sharedFixture.path)).toBe(true);
  });

  it("F04 treats repeated identical findings as new occurrences, not inherited exceptions", () => {
    const before = findFoodStaticCandidates([{
      path: "server/catalog.ts",
      content: "function first() { const FOOD_ALIASES = ['pão']; }",
    }]);
    const after = findFoodStaticCandidates([{
      path: "server/catalog.ts",
      content: [
        "function first() { const FOOD_ALIASES = ['pão']; }",
        "function second() { const FOOD_ALIASES = ['pão']; }",
      ].join("\n"),
    }]);
    expect(before).toHaveLength(1);
    expect(after).toHaveLength(2);
    expect(after[0].fingerprint).toBe(after[1].fingerprint);
    expect(compareFoodArchitectureFindings(after, before)).toMatchObject({
      added: [after[1]], retained: [after[0]], removed: [],
    });
    expect(evaluateFoodArchitectureGate(after, before, [], today).errors.some(e =>
      e.includes("New food architecture violation"))).toBe(true);
    expect(compareFoodArchitectureFindings(before, after).removed).toHaveLength(1);
  });

  it("F02 recognizes an inline lexical table referenced through a local variable", () => {
    const findings = findFoodStaticCandidates([{
      path: "server/foodMateriality.ts",
      content: "function isMaterialAttribute(variant:string) { const tokens = ['integral', 'light']; return tokens.includes(variant); }",
    }]);
    expect(findings.some(f => f.ruleId === "18" && f.symbol.includes("lexical-membership"))).toBe(true);
    // A dynamically supplied set from governed knowledge is not a literal table.
    const governed = findFoodStaticCandidates([{
      path: "server/foodMateriality.ts",
      content: "function isMaterialAttribute(variant:string, tokens: string[]) { return tokens.includes(variant); }",
    }]);
    expect(governed.some(f => f.ruleId === "18" && f.symbol.includes("lexical-membership"))).toBe(false);
  });

  it("F03 rejects dynamic and reexported imports of competing channel resolvers", () => {
    for (const consumer of [
      "async function resolve(){ return import('../../../nutritionEngine'); }",
      "const existing = require('../../../nutritionEngine');",
      "export { resolveNutrition } from '../../../nutritionEngine';",
    ]) {
      const findings = findFoodStaticCandidates([{
        path: "server/modules/whatsapp/foodAdapter.ts", content: consumer,
      }]);
      expect(findings.some(f => f.ruleId === "10"), consumer).toBe(true);
    }
    expect(findFoodStaticCandidates([{
      path: "server/modules/whatsapp/foodAdapter.ts",
      content: "export type { Resolver } from '../../../nutritionEngine';",
    }]).some(f => f.ruleId === "10")).toBe(false);
  });

  it("F05 runs architectural enforcement even on fast-profile changes", () => {
    const workflow = readFileSync(".github/workflows/agent-check.yml", "utf8");
    expect(workflow).toContain("if: github.event_name != 'pull_request' || needs.classify.outputs.code_changed == 'true'");
    expect(workflow).not.toContain("if: github.event_name != 'pull_request' || needs.classify.outputs.risk_profile != 'fast'\n        run: pnpm architecture:check");
  });

  it("F06 blocks label/kcal inline rows in TypeScript and JavaScript", () => {
    for (const path of ["server/recipes.ts", "server/recipes.js"]) {
      const findings = findFoodStaticCandidates([{ path,
        content: "const rows = [{label: 'arroz', kcal: 130, protein: 3}];" }]);
      expect(findings.some(f => f.ruleId === "17"), path).toBe(true);
    }
  });

  it("F06 detects inline and locally declared materiality regex tests", () => {
    for (const content of [
      "function isMaterialAttribute(v: string) { return /integral|light/.test(v); }",
      "const matcher = /integral|light/; function isMaterialAttribute(v: string) { return matcher.test(v); }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/foodMateriality.ts", content }]
        ).some(f => f.ruleId === "18"), content).toBe(true);
    }
  });

  it("F07 excludes UI presentation lists without hiding real food aliases", () => {
    expect(findFoodStaticCandidates([{ path: "client/src/components/Widget.tsx",
      content: "const FOOD_TABS = ['Resumo', 'Histórico'];" }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/foodInfo.ts",
      content: "const FOOD_ALIASES = ['pão', 'bread'];" }])
      .some(f => f.ruleId === "17")).toBe(true);
  });

  it("F08 refuses to drop a live debt without fixing its code first", () => {
    const legacyFinding = findFoodStaticCandidates([{ path: "server/foodInfo.ts",
      content: "const FOOD_ALIASES = ['pão', 'bread'];" }])[0];
    const debt = { ruleId: legacyFinding.ruleId, file: legacyFinding.file,
      fingerprint: legacyFinding.fingerprint, reason: "migration", owner: "crgasparoto-br",
      issue: 1300, createdAt: "2026-10-13", expiresAt: "2027-01-11" };
    expect(assessFoodDebtRenewal([debt], [], [legacyFinding])
      .some(message => message.includes("removed while violation remains"))).toBe(true);
    expect(assessFoodDebtRenewal([debt], [], [])).toEqual([]);
    expect(compareFoodArchitectureFindings([legacyFinding], []).added).toHaveLength(1);
  });

  it("R01 ties every timeboxed debt to a reviewed finding and exact rule", () => {
    const inventory = JSON.parse(readFileSync("docs/design-docs/food-architecture-owners-1300.json", "utf8"));
    const debts = JSON.parse(readFileSync("architecture-debt.json", "utf8"));
    for (const debt of debts.entries) {
      const symbol = debt.fingerprint.slice((debt.ruleId + ":" + debt.file + ":").length).split(":")[0];
      const source = inventory.observations.find((item: { file: string; symbol: string }) =>
        item.file === debt.file && item.symbol === symbol);
      expect(source, debt.fingerprint).toBeDefined();
      expect(source.review.classification, debt.fingerprint).toBe("confirmed-legacy-violation");
      expect(source.rules, debt.fingerprint).toContain(debt.ruleId);
    }
  });

  it("A1300-01 rejects anonymous nutrition rows keyed by foodId without false positives", () => {
    for (const content of [
      "const rows = [{ foodId: 'arroz', portionGrams: 75, calories: 98 }];",
      "function make(foodId: string) { return { foodId, portionGrams: 50, calories: 100 }; }",
      "const rows = [{ food_id: 'ovo', serving_grams: 50, kcal: 78 }];",
    ]) {
      const violations = findFoodStaticCandidates([{ path: "server/metrics.ts", content }]);
      expect(violations.some(v => v.ruleId === "17" && v.symbol === "inline-food-knowledge"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(violations, [], [], today).errors
        .some(message => message.includes("New food architecture violation")), content).toBe(true);
    }
    expect(findFoodStaticCandidates([{ path: "server/metrics.ts",
      content: "const rows = [{ foodId: 'x', displayCalories: '98' }];" }])).toEqual([]);
  });

  it("A1300-02 detects materiality membership, regex and branches in generic channel handler paths", () => {
    const samples = [
      { path: "server/modules/whatsapp/handler.ts",
        content: "function isMaterialAttribute(variant: string) { const tokens = ['integral', 'light']; return tokens.includes(variant); }" },
      { path: "server/modules/whatsapp/handler2.ts",
        content: "function hasMateriality(variant: string) { return /integral|light/.test(variant); }" },
      { path: "server/modules/whatsapp/handler3.ts",
        content: "function isMaterialAttribute(variant: string) { return variant === 'integral'; }" },
    ];
    const violations = findFoodStaticCandidates(samples);
    for (const sample of samples) {
      expect(violations.some(v => v.file === sample.path && v.ruleId === "18"), sample.path).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(violations, [], [], today).errors).not.toEqual([]);
    expect(findFoodStaticCandidates([{
      path: "server/modules/whatsapp/handler.ts",
      content: "function acceptsStatus(status: string) { return ['pending', 'saved'].includes(status); }",
    }]).filter(v => v.ruleId === "18")).toEqual([]);
  });

  it("A1300-03 includes imported JS generated and fixture modules in runtime enforcement", () => {
    const samples = [
      { target: "server/generated/foodData.js", importText: "const x = require('./generated/foodData');" },
      { target: "server/generated/foodData.mjs", importText: "async function get() { return import('./generated/foodData.mjs'); }" },
      { target: "server/generated/foodData.jsx", importText: "import { FOOD_ALIASES } from './generated/foodData.jsx';" },
      { target: "server/generated/foodData.cjs", importText: "const x = require('./generated/foodData.cjs');" },
      { target: "server/fixtures/foodData/index.js", importText: "export * from './fixtures/foodData';" },
    ];
    for (const sample of samples) {
      const generated = { path: sample.target, content: "const FOOD_ALIASES = ['ovo', 'eggs'];" };
      expect(findFoodStaticCandidates([generated])).toEqual([]);
      const violations = findFoodStaticCandidates([generated, {
        path: "server/liveAdapter.ts", content: sample.importText,
      }]);
      expect(violations.some(v => v.file === sample.target && v.ruleId === "17"), sample.target).toBe(true);
      expect(evaluateFoodArchitectureGate(violations, [], [], today).errors
        .some(message => message.includes("New food architecture violation")), sample.target).toBe(true);
    }
    expect(findFoodStaticCandidates([{
      path: "server/generated/foodData.js", content: "const FOOD_ALIASES = ['ovo', 'eggs'];",
    }, {
      path: "server/liveAdapter.ts", content: "import type { FoodData } from './generated/foodData.js';",
    }])).toEqual([]);
  });

  it("A1300-04 blocks JSON food catalogs and catalog edits, not ordinary JSON", () => {
    const baseline = { path: "server/foodCatalog.json", content:
      JSON.stringify([{ name: "arroz", calories: 128, protein: 2 }]) };
    const original = findFoodStaticCandidates([baseline]);
    expect(original.map(f => f.ruleId)).toEqual(["17", "5"]);
    const equivalent = findFoodStaticCandidates([{ ...baseline, content:
      '[ { "name": "arroz", "calories": 128, "protein": 2 } ]' }]);
    expect(equivalent.map(f => f.fingerprint)).toEqual(original.map(f => f.fingerprint));
    const modified = findFoodStaticCandidates([{ ...baseline, content:
      JSON.stringify([{ name: "arroz", calories: 150, protein: 2 }]) }]);
    expect(compareFoodArchitectureFindings(modified, original).added).toHaveLength(2);
    expect(evaluateFoodArchitectureGate(modified, original, [], today).errors
      .some(message => message.includes("New food architecture violation"))).toBe(true);
    expect(findFoodStaticCandidates([{ path: "server/config.json",
      content: JSON.stringify({ name: "service", timeout: 20 }) }])).toEqual([]);
    expect(findFoodStaticCandidates([{ ...baseline, path: "docs/foodCatalog.json" }])).toEqual([]);
  });

  it("A1300-04 includes imported JSON fixtures and generated catalogs, not inert data", () => {
    const samples = ["server/fixtures/menu.json", "server/generated/menu.json"];
    for (const target of samples) {
      const catalog = { path: target, content:
        JSON.stringify({ foods: [{ foodId: "ovo", kcal: 78, protein: 6 }] }) };
      expect(findFoodStaticCandidates([catalog])).toEqual([]);
      const active = findFoodStaticCandidates([catalog, { path: "server/useCatalog.ts",
        content: 'import data from "./' + target.split("/").slice(1).join("/") + '";' }]);
      expect(active.filter(f => f.file === target)).toHaveLength(2);
      expect(active.some(f => f.ruleId === "17" && f.file === target)).toBe(true);
    }
    expect(isProductionFoodSource("server/tacoCatalog.json")).toBe(true);
    expect(isProductionFoodSource("server/fixtures/menu.json")).toBe(false);
  });

  it("A1300-05 detects dynamic food identities with hardcoded nutrition without generic false positives", () => {
    const positive = [
      "const rows = [{ name: foodName, calories: 125 }];",
      "function buildFood(name: string) { return { name, calories: 80 }; }",
      "const entries = [{ label: currentName, kcal: 78, protein: 6 }];",
    ];
    for (const content of positive) {
      const hits = findFoodStaticCandidates([{ path: "server/metrics.ts", content }]);
      expect(hits.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(hits, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/metrics.ts",
      content: "const progress = [{ name: user.name, calories: 100 }];" }])).toEqual([]);
  });

  it("A1300-04 detects alias, portion and classification JSON without numeric macros", () => {
    const documents = [
      [{ name: "pão", aliases: ["bread", "pao"] }],
      [{ food: "pão", grams: 25 }],
      [{ name: "biscoito", processingLevel: "ultra-processed" }],
      [{ name: "ovo", nutrition: { calories: 78, protein: 6 } }],
    ];
    for (const rows of documents) {
      const findings = findFoodStaticCandidates([{ path: "server/catalog.json",
        content: JSON.stringify(rows) }]);
      expect(findings.map(f => f.ruleId), JSON.stringify(rows)).toEqual(["17", "5"]);
    }
  });

  it("A1300-05 recognizes nested literal macros with dynamically selected identity", () => {
    const hits = findFoodStaticCandidates([{ path: "server/foodResolver.ts",
      content: "const rows = [{ name: currentFood.name, nutrition: { calories: 120, protein: 3 } }];" }]);
    expect(hits.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge")).toBe(true);
    expect(evaluateFoodArchitectureGate(hits, [], [], today).errors.length).toBeGreaterThan(0);
  });

  it("A1300-06 permits UI copy without hiding productive food aliases", () => {
    const displayOnly = [
      { path: "client/src/components/FoodCard.tsx", content:
        'const foodLabel = "Adicionar alimento"; const nutritionTitle = "Resumo nutricional";' },
      { path: "server/presentation.ts", content:
        'const foodLabel = "Adicionar alimento";' },
      { path: "client/src/pages/FoodList.tsx", content:
        'const foodPlaceholder = "Buscar alimento";' },
    ];
    for (const sample of displayOnly) {
      expect(findFoodStaticCandidates([sample]), sample.path).toEqual([]);
    }
    const productive = findFoodStaticCandidates([
      { path: "server/foodRules.ts", content: 'const DEFAULT_FOOD_NAME = "pão";' },
      { path: "client/src/components/FoodCard.tsx",
        content: 'const FOOD_ALIASES = ["pão", "bread"];' },
    ]);
    expect(productive.filter(f => f.ruleId === "17").length).toBeGreaterThanOrEqual(2);
  });

  it("A1300-07 blocks item.name food and portion branches without food-named variables", () => {
    const samples = [
      { path: "server/helpers.ts", content:
        "function computeServing(item: {name: string}) { if (item.name === 'pão') return 50; return 80; }" },
      { path: "server/rules.ts", content:
        "function rule(item: FoodPortion) { return item['name'] === 'pão' ? 45 : 70; }" },
      { path: "server/foodRules.ts", content:
        "function match(item: {name: string}) { return item.name === 'pão'; }" },
    ];
    for (const sample of samples) {
      const hits = findFoodStaticCandidates([sample]);
      expect(hits.some(f => f.ruleId === "17" && f.symbol.includes("lexical-branch")), sample.content).toBe(true);
      expect(evaluateFoodArchitectureGate(hits, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function isAdmin(user: {name: string}) { return user.name === 'admin'; }",
      "function show(item: {name: string}) { return item.name === 'premium'; }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/accounts.ts", content }])).toEqual([]);
    }
  });

  it("A1300-08 blocks productive JSON food alias dictionaries without numeric macros", () => {
    const examples = [
      { path: "server/foodAliases.json", content: '{"pao":"pão"}' },
      { path: "server/config.json", content: '{"foodAliases":{"pao":"pão"}}' },
      { path: "server/modules/whatsapp/foodLexicon.json", content: '{"pao":"pão"}' },
    ];
    for (const sample of examples) {
      const hits = findFoodStaticCandidates([sample]);
      expect(hits.some(f => f.ruleId === "17"), sample.path).toBe(true);
      expect(evaluateFoodArchitectureGate(hits, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/settings.json",
      content: '{"status":{"pending":"aguardando","saved":"salvo"}}' }])).toEqual([]);
  });

  it("A1300-07 catches the exact anonymous picker from the rejected audit", () => {
    const source = { path: "server/portionRules.ts",
      content: "function pick(item: { name: string }) { return item.name === 'pão' ? 50 : 0; }" };
    const findings = findFoodStaticCandidates([source]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("lexical-branch"))).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
  });

  it("A1300-08 resolves a generic aliases.json through its food-runtime importer", () => {
    const source = { path: "server/aliases.json", content: '{"pao":"pão","bread":"pão"}' };
    const importer = { path: "server/foodItemResolution.ts",
      content: "import aliases from './aliases.json'; export const result = aliases;" };
    expect(findFoodStaticCandidates([source])).toEqual([]);
    const findings = findFoodStaticCandidates([source, importer]);
    expect(findings.some(f => f.file === source.path && f.ruleId === "17")).toBe(true);
    const generic = findFoodStaticCandidates([source, {
      path: "server/accountAliases.ts",
      content: "import aliases from './aliases.json'; export const result = aliases;",
    }]);
    expect(generic).toEqual([]);
  });

  it("A1300-09 excludes ambiguous activity calories while preserving food catalogs", () => {
    const exercise = [
      { path: "server/exerciseCatalog.json", content: '[{"name":"caminhada","calories":120}]' },
      { path: "server/activityLog.json", content: '[{"name":"corrida","calories":320}]' },
    ];
    for (const sample of exercise) expect(findFoodStaticCandidates([sample])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/exerciseCatalog.ts",
      content: "const exercises = [{ name: 'caminhada', calories: 120 }];" }])).toEqual([]);
    const food = findFoodStaticCandidates([{ path: "server/foodCatalog.json",
      content: '[{"name":"pão","calories":120}]' }]);
    expect(food.map(f => f.ruleId)).toEqual(["17", "5"]);
  });

  it("R1300-02 groups suspected decision owners by food-domain function and surface", () => {
    const files = [
      { path: "server/foodAliases.ts", content: "const FOOD_ALIASES = ['pao', 'pão'];" },
      { path: "server/modules/whatsapp/foodNormalizer.ts",
        content: "const FOOD_ALIASES = ['pao', 'pão'];" },
      { path: "server/foodCatalog.ts", content: "const FOOD_CATALOG_REFERENCE = [{name:'pão', protein:2}];" },
    ];
    const inventory = findCompetingOwnerInventory(files);
    const groups = groupCompetingFoodOwners(inventory);
    const lexical = groups.find(group => group.decisionFunction === "lexical-knowledge");
    expect(lexical?.candidateCount).toBe(2);
    expect(lexical?.observedSurfaces).toEqual(["channel", "server-domain"]);
    expect(lexical?.crossSurfaceCandidates).toBe(true);
    expect(lexical?.suspectedCompetingPairs).toEqual([{
      left: "server/foodAliases.ts",
      right: "server/modules/whatsapp/foodNormalizer.ts",
      status: "requires-behavioral-review",
    }]);
    expect(lexical?.status).toBe("requires-behavioral-review");
    expect(inventory.every(f => f.candidateOwner.includes(f.file))).toBe(true);
  });



  it("A1300-10 blocks food/portion decisions in switch/case including generic item.name", () => {
    const cases = [
      { path: "server/portionRules.ts", content:
        "function resolvePortion(item: {name: string}) { switch (item.name) { case 'pão': return 50; default: return 0; } }" },
      { path: "server/foodRules.ts", content:
        "function pick(foodName: string) { switch (foodName) { case 'arroz': return 90; default: return 0; } }" },
      { path: "server/foodAttribute.ts", content:
        "function decideMateriality(attribute: string) { switch (attribute) { case 'integral': return true; default: return false; } }" },
    ];
    for (const source of cases) {
      const findings = findFoodStaticCandidates([source]);
      const expectedGate = source.content.includes("decideMateriality") ? "18" : "17";
      expect(findings.some(f => f.ruleId === expectedGate &&
        f.symbol.includes("lexical-switch")), source.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const negative = [
      { path: "server/accountStatus.ts", content:
        "function pick(status: string) { switch (status) { case 'active': return 1; default: return 0; } }" },
      { path: "server/foodRules.ts", content:
        "function status(value: string) { switch (value) { case 'active': return 1; default: return 0; } }" },
    ];
    for (const source of negative) {
      expect(findFoodStaticCandidates([source]).filter(f => f.symbol.includes("lexical-switch"))).toEqual([]);
    }
  });

  it("A1300-11 blocks numeric food-to-portion maps in productive JSON", () => {
    const cases = [
      { path: "server/foodPortions.json", content: '{"pão":50,"arroz":90}' },
      { path: "server/foodCatalog.json", content: '{"pão":50}' },
      { path: "server/mappings.json", content: '{"foodPortions":{"arroz":90}}' },
    ];
    for (const source of cases) {
      const findings = findFoodStaticCandidates([source]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol === "json-food-catalog"), source.path).toBe(true);
      expect(findings.some(f => f.ruleId === "5"), source.path).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/featureFlags.json",
      content: '{"retry":3,"timeout":500}' }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/foodPortionsConfig.json",
      content: '{"retry":3,"timeout":500}' }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/exerciseCalories.json",
      content: '{"caminhada":120,"corrida":320}' }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/fixtures/foodPortions.json",
      content: '{"pão":50}' }])).toEqual([]);
  });

  it("A1300-11 checks JSON numeric maps imported into food runtime", () => {
    const fixture = { path: "server/fixtures/foodPortions.json", content: '{"pão":50}' };
    const imported = { path: "server/foodItemResolution.ts",
      content: "import portions from './fixtures/foodPortions.json'; export const values = portions;" };
    const findings = findFoodStaticCandidates([fixture, imported]);
    expect(findings.some(f => f.file === fixture.path && f.ruleId === "17")).toBe(true);
  });

  it("A1300-12 detects anonymous materiality regex and lexical membership using food-domain evidence", () => {
    const positives = [
      { path: "server/foodItemResolution.ts", content:
        "function decide(value: string) { return /integral|light/.test(value); }" },
      { path: "server/foodItemResolution.ts", content:
        "function decide(value: string) { const words = ['integral', 'light']; return words.includes(value); }" },
      { path: "server/foodItemResolution.ts", content:
        "const words = /integral|light/; function decide(value: string) { return words.test(value); }" },
    ];
    for (const source of positives) {
      const findings = findFoodStaticCandidates([source]);
      expect(findings.some(f => f.ruleId === "18" &&
        /lexical-(regex|membership)/.test(f.symbol)), source.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const negatives = [
      { path: "server/foodItemResolution.ts", content:
        "function decide(value: string) { return /^\\d+$/.test(value); }" },
      { path: "server/accountHelpers.ts", content:
        "function decide(value: string) { return /integral|light/.test(value); }" },
    ];
    for (const source of negatives) {
      expect(findFoodStaticCandidates([source]).filter(f => f.ruleId === "18")).toEqual([]);
    }
  });


  it("R1300-03 records source-backed responsibilities without falsely certifying runtime owner equivalence", () => {
    const pinned = JSON.parse(readFileSync("docs/design-docs/food-architecture-owners-1300.json", "utf8"));
    expect(pinned.observations).toHaveLength(8);
    const dispositions = new Set<string>();
    for (const item of pinned.observations) {
      const review = item.behavioralReview;
      expect(review?.sourceAnchor, item.symbol).toBeTruthy();
      expect(readFileSync(item.file, "utf8").includes(review.sourceAnchor), item.file).toBe(true);
      expect(review.verification).toBe("source-anchor-in-frozen-develop");
      expect(review.runtimeEvidence).toBe("not-executed");
      expect(review.observedDecision.length).toBeGreaterThan(25);
      dispositions.add(review.disposition);
    }
    expect(dispositions.has("domain-decision-owner")).toBe(true);
    expect(dispositions.has("channel-decision-owner")).toBe(true);
    expect(dispositions.has("data-source")).toBe(true);
    expect(dispositions.has("grammar-only")).toBe(true);
  });


  it("R1300-03 contrasts channel lexical ownership with general text normalization at runtime", () => {
    const phrase = "refri zero";
    const channel = normalizeWhatsappInformalLanguage(phrase);
    const general = normalizeText(phrase);
    expect(general).toBe("refri zero");
    expect(channel?.normalizedText).toBe("refrigerante zero");
    expect(channel?.replacements.some(item => item.source === "built_in" &&
      item.kind === "food")).toBe(true);
    // Different outputs demonstrate a channel-owned semantic replacement;
    // do not claim equivalent resolution or authorize an automatic exception.
    expect(channel?.normalizedText).not.toBe(general);
  });


  it("A1300-13 blocks anonymous nutritional returns but not activity summaries", () => {
    const positive = { path: "server/foodItemResolution.ts",
      content: "function resolveFood() { return { calories: 120, protein: 2, carbs: 27 }; }" };
    const findings = findFoodStaticCandidates([positive]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge")).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    const negative = { path: "server/exerciseService.ts",
      content: "function exerciseSummary() { return { calories: 120, protein: 2, carbs: 27 }; }" };
    expect(findFoodStaticCandidates([negative])).toEqual([]);
  });

  it("A1300-14 treats numeric JSON maps as food when imported by a food decision module", () => {
    const json = { path: "server/portions.json", content: '{"pao":50,"arroz":90}' };
    expect(findFoodStaticCandidates([json])).toEqual([]);
    const importer = { path: "server/foodItemResolution.ts",
      content: "import portions from './portions.json'; export const lookup = portions;" };
    const active = findFoodStaticCandidates([json, importer]);
    expect(active.some(f => f.file === json.path && f.ruleId === "17")).toBe(true);
    const nonFood = { path: "server/retries.json", content: '{"retry":3,"timeout":8}' };
    expect(findFoodStaticCandidates([nonFood, importer])).toEqual([]);
  });

  it("A1300-15 treats static backtick strings like quoted strings in decisions", () => {
    const positives = [
      { path: "server/foodItemResolution.ts",
        content: "function foodPortion(foodName: string) { return foodName === `pao` ? 50 : 0; }" },
      { path: "server/foodItemResolution.ts",
        content: "function foodPortion(foodName: string) { switch(foodName) { case `pao`: return 50; default: return 0; } }" },
      { path: "server/materiality.ts",
        content: "function decideMateriality(attribute: string) { return attribute === `integral`; }" },
    ];
    for (const source of positives) {
      expect(findFoodStaticCandidates([source]).some(f =>
        f.ruleId === (source.path.includes("materiality") ? "18" : "17")), source.content).toBe(true);
    }
    expect(findFoodStaticCandidates([{ path: "server/account.ts",
      content: "function status(value: string) { return value === `active`; }" }])).toEqual([]);
  });

  it("A1300-16 blocks anonymous lexical dictionaries at consumption, not account/status dictionaries", () => {
    const sources = [
      { path: "server/foodItemResolution.ts",
        content: "function resolveFood(input: string) { const dict = {pao:'pão'}; return dict[input]; }" },
      { path: "server/modules/whatsapp/handler.ts",
        content: "function normalizeInput(input: string) { const dict = {pao:'pão'}; return dict[input]; }" },
    ];
    for (const source of sources) {
      expect(findFoodStaticCandidates([source]).some(f =>
        f.symbol.includes("lexical-dictionary")), source.path).toBe(true);
    }
    expect(findFoodStaticCandidates([{ path: "server/foodItemResolution.ts",
      content: "function showStatus(status: string) { const statusMap = {active:'Ativo'}; return statusMap[status]; }" }])
      .some(f => f.symbol.includes("lexical-dictionary"))).toBe(false);
    const lexicalOnly = findFoodStaticCandidates([sources[0]]);
    expect(lexicalOnly.some(f => f.ruleId === "18" && f.symbol.includes("lexical-dictionary"))).toBe(false);
    const materiality = findFoodStaticCandidates([{ path: "server/foodMateriality.ts",
      content: "function decide(input: string) { const dict = {integral:'material', light:'neutral'}; return dict[input]; }" }]);
    expect(materiality.some(f => f.ruleId === "18" && f.symbol.includes("lexical-dictionary"))).toBe(true);
  });

  it("A1300-17 follows transitive imports to detect alternative channel resolvers", () => {
    const sources = [
      { path: "server/modules/whatsapp/service.ts",
        content: "import { lookup } from './bridge'; export { lookup };" },
      { path: "server/modules/whatsapp/bridge.ts",
        content: "export { lookup } from '../../foodItemResolution';" },
      { path: "server/foodItemResolution.ts", content: "export function lookup() { return null; }" },
    ];
    const found = findFoodStaticCandidates(sources);
    expect(found.some(f => f.ruleId === "10" &&
      f.file === "server/modules/whatsapp/service.ts" &&
      f.symbol.includes("transitive-import:server/foodItemResolution.ts"))).toBe(true);
    expect(findFoodStaticCandidates([
      { path: "server/modules/whatsapp/service.ts", content: "import type { Lookup } from './bridge';" },
      { path: "server/modules/whatsapp/bridge.ts", content: "export type { Lookup } from '../../foodItemResolution';" },
      { path: "server/foodItemResolution.ts", content: "export type Lookup = string;" },
    ]).some(f => f.ruleId === "10")).toBe(false);
  });

  it("A1300-18 exempts pure visual filters but still catches server-side food rule lists", () => {
    const ui = { path: "client/src/FoodsPage.tsx",
      content: "const FOOD_FILTERS = ['Todas', 'Favoritas']; export const Page = () => FOOD_FILTERS.map(label => label);" };
    expect(findFoodStaticCandidates([ui])).toEqual([]);
    const productive = { path: "server/foodRules.ts",
      content: "const FOOD_FILTERS = ['pao','arroz']; export const allowed = FOOD_FILTERS;" };
    expect(findFoodStaticCandidates([productive]).some(f => f.ruleId === "17")).toBe(true);
    const uiDecision = { path: "client/src/FoodsPage.tsx",
      content: "const FOOD_FILTERS = ['pao']; export const allowed = (foodName: string) => FOOD_FILTERS.includes(foodName);" };
    expect(findFoodStaticCandidates([uiDecision]).some(f => f.ruleId === "17")).toBe(true);
  });

  it("A1300-19 blocks unnamed numeric food portion maps by consumption without flagging status tables", () => {
    const positive = [
      { path: "server/portionRules.ts",
        content: "function resolvePortion(foodName: string) { const table = { pao: 50, arroz: 90 }; return table[foodName] ?? 0; }" },
      { path: "server/foodCatalog.ts",
        content: "function resolveFood(item: { name: string }) { const mapping = { pao: 50 }; return mapping[item.name]; }" },
      { path: "server/portionRules.ts",
        content: "function resolvePortion(foodName: string) { return ({ pao: 50, arroz: 90 })[foodName]; }" },
    ];
    for (const input of positive) {
      const findings = findFoodStaticCandidates([input]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("numeric-food-map")), input.content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" && f.symbol.includes("numeric-food-map")), input.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const negatives = [
      { path: "server/foodRules.ts",
        content: "function applyStatus(status: string) { const table = { active: 1, disabled: 0 }; return table[status]; }" },
      { path: "server/account.ts",
        content: "function resolveRole(name: string) { const table = { admin: 1, member: 2 }; return table[name]; }" },
      { path: "server/exerciseService.ts",
        content: "function recordExercise(foodName: string) { const table = { walking: 120 }; return table[foodName]; }" },
    ];
    for (const input of negatives) {
      expect(findFoodStaticCandidates([input]).filter(f =>
        f.symbol.includes("numeric-food-map")), input.content).toEqual([]);
    }
  });

  it("A1300-20 blocks literal default grams inside food resolution but not unit conversion constants", () => {
    const positive = [
      { path: "server/quantityUtils.ts",
        content: "function resolveFood(foodName: string) { const defaultGrams = 50; return defaultGrams; }" },
      { path: "server/foodItemResolution.ts",
        content: "function resolvePortion(foodName: string) { const servingGrams = 35; return servingGrams; }" },
      { path: "server/portionRules.ts",
        content: "function resolvePortion(foodName: string) { const grams = 30; return grams; }" },
    ];
    for (const input of positive) {
      const findings = findFoodStaticCandidates([input]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("Grams") ||
        f.ruleId === "17" && f.symbol === "grams"), input.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const negatives = [
      { path: "server/exerciseService.ts",
        content: "function calculateExercise() { const defaultGrams = 50; return defaultGrams; }" },
      { path: "server/foodItemResolution.ts",
        content: "function resolveFood() { const gramsPerKilogram = 1000; return gramsPerKilogram; }" },
    ];
    for (const input of negatives) {
      expect(findFoodStaticCandidates([input]).filter(f =>
        f.ruleId === "17" && f.symbol === "defaultGrams" ||
        f.ruleId === "17" && f.symbol === "gramsPerKilogram"), input.content).toEqual([]);
    }
  });

  it("A1300-21 blocks Map-based numeric food portions, including inline consumption", () => {
    const positives = [
      "function resolvePortion(foodName: string) { const table = new Map([['pão', 50], ['arroz', 90]]); return table.get(foodName); }",
      "function resolvePortion(foodName: string) { return new Map([['pão', 50]]).get(foodName); }",
      "function resolvePortion(foodName: string) { const table = new Map<string, number>([['pão', 50]]); return table.get(foodName); }",
    ];
    for (const content of positives) {
      const findings = findFoodStaticCandidates([{ path: "server/portionRules.ts", content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("numeric-food-map")), content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" && f.symbol.includes("numeric-food-map")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function resolveRole(name: string) { const table = new Map([['admin', 1]]); return table.get(name); }",
      "function exerciseSummary(foodName: string) { const table = new Map([['walking', 120]]); return table.get(foodName); }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/account.ts", content }]
        ).filter(f => f.symbol.includes("numeric-food-map"))).toEqual([]);
    }
  });

  it("A1300-22 detects competing food owners on web and API channel entrypoints", () => {
    for (const file of [
      "server/modules/web/handler.ts", "server/routes/food.ts", "server/modules/api/food.ts",
      "server/modules/newDeliveryChannel/food.ts", "server/customFoodAdapter.ts",
    ]) {
      const content = "export function resolveFood(input: string) { return { input }; }";
      const findings = findFoodStaticCandidates([{ path: file, content }]);
      expect(findings.some(f => f.ruleId === "1"), file).toBe(true);
      expect(findings.some(f => f.ruleId === "2"), file).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/foodItemResolution.ts",
      content: "export function resolveCanonicalFoodQuantity(foodName: string) { return foodName; }" }]
    ).filter(f => f.ruleId === "1" || f.ruleId === "2")).toEqual([]);
    for (const competing of ["server/foodItemResolution.ts",
      "server/modules/foodIntelligenceV1/foodResolver.ts",
      "server/modules/foodIntelligence" + "V2/foodResolver.ts",
      "server/modules/foodIntelligenceV3/foodResolver.ts"]) {
      const findings = findFoodStaticCandidates([{ path: competing,
        content: "export function resolveFood(input: string) { return input; }" }]);
      expect(findings.some(f => f.ruleId === "1" || f.ruleId === "2"), competing).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/modules/web/handler.ts",
      content: "export function resolveAccount(input: string) { return input; }" }]
    ).filter(f => f.ruleId === "1" || f.ruleId === "2")).toEqual([]);
  });

  it("A1300-23 blocks textual reinference through local decision aliases", () => {
    for (const content of [
      "function rerun(decision: ResolvedFoodDecision) { const raw = decision.normalizedText; return parseFoodText(raw); }",
      "function rerun(decision: ResolvedFoodDecision) { const raw = decision.normalizedText; const alias = raw; return parseFoodText(alias); }",
      "function rerun(decision: ResolvedFoodDecision) { const { normalizedText: raw } = decision; return parseFoodText(raw); }",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodReparser.ts", content }]);
      expect(findings.some(f => f.ruleId === "3"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function parseUserText(req: { body: string }) { const raw = req.body; return parseFoodText(raw); }",
      "function parseUserText(input: string) { return parseFoodText(input); }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/inputParsing.ts", content }]
        ).filter(f => f.ruleId === "3")).toEqual([]);
    }
  });


  it("A1300-24 blocks exported generic numeric maps used as portions by another module", () => {
    const producer = { path: "server/numbers.ts",
      content: "export const table = { pao: 50, arroz: 90 };" };
    const consumer = { path: "server/foodResolver.ts",
      content: "import { table as portions } from './numbers'; function resolvePortion(foodName: string) { return portions[foodName]; }" };
    const findings = findFoodStaticCandidates([producer, consumer]);
    for (const ruleId of ["17", "5"]) {
      expect(findings.some(f => f.ruleId === ruleId &&
        f.symbol.includes("imported-numeric-food-map") && f.file === consumer.path)).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    const account = { path: "server/account.ts",
      content: "import { table as mapping } from './numbers'; function getRole(name: string) { return mapping[name]; }" };
    expect(findFoodStaticCandidates([producer, account]).filter(f =>
      f.symbol.includes("imported-numeric-food-map"))).toEqual([]);
    const types = { path: "server/foodResolver.ts",
      content: "import type { table } from './numbers';" };
    expect(findFoodStaticCandidates([producer, types]).filter(f =>
      f.symbol.includes("imported-numeric-food-map"))).toEqual([]);
  });

  it("A1300-25 treats filesystem-loaded fixtures as production data, but not isolated samples", () => {
    const fixture = { path: "server/fixtures/foodPortions.json",
      content: '{"pao":50,"arroz":90}' };
    const readers = [
      "import { readFileSync } from 'node:fs'; const rows = JSON.parse(readFileSync(new URL('./fixtures/foodPortions.json', import.meta.url), 'utf8'));",
      "import fs from 'node:fs'; const rows = JSON.parse(fs.readFileSync(new URL('./fixtures/foodPortions.json', import.meta.url), 'utf8'));",
      "import { readFileSync } from 'node:fs'; const rows = JSON.parse(readFileSync(path.join(__dirname, 'fixtures', 'foodPortions.json'), 'utf8'));",
    ];
    for (const content of readers) {
      const findings = findFoodStaticCandidates([fixture, { path: "server/foodResolver.ts", content }]);
      expect(findings.some(f => f.file === fixture.path && f.ruleId === "17"), content).toBe(true);
      expect(findings.some(f => f.file === fixture.path && f.ruleId === "5"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
    const accountData = { path: "server/fixtures/settings.json", content: '{"active":1,"disabled":0}' };
    expect(findFoodStaticCandidates([accountData, { path: "server/account.ts",
      content: "import fs from 'node:fs'; const config = fs.readFileSync('./fixtures/settings.json');" }])).toEqual([]);
  });

  it("A1300-26 excludes visual navigation only when it is not a food decision", () => {
    const tabs = { path: "client/src/FoodsPage.tsx",
      content: "const FOOD_TABS = ['pão', 'arroz']; export const Page = () => FOOD_TABS.map(label => label);" };
    expect(findFoodStaticCandidates([tabs])).toEqual([]);
    const deciding = { ...tabs, content:
      "const FOOD_TABS = ['pão', 'arroz']; export const allowsFood = (foodName: string) => FOOD_TABS.includes(foodName);" };
    const findings = findFoodStaticCandidates([deciding]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol === "FOOD_TABS")).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
  });

  it("A1300-27 follows imported runtime modules outside server/shared/client-src", () => {
    const packageData = { path: "packages/food-intelligence/knowledge.ts",
      content: "export const FOOD_ALIASES = ['pão', 'paes'];" };
    const entry = { path: "server/foodApi.ts",
      content: "import { FOOD_ALIASES } from '../packages/food-intelligence/knowledge'; export const value = FOOD_ALIASES;" };
    expect(isFoodArchitectureSourcePath(packageData.path)).toBe(true);
    expect(isFoodArchitectureSourcePath(entry.path)).toBe(true);
    expect(isFoodArchitectureSourcePath("docs/food-intelligence/knowledge.ts")).toBe(true);
    expect(isFoodArchitectureSourcePath("scripts/food-intelligence-architecture.ts")).toBe(true);
    expect(isFoodArchitectureSourcePath("node_modules/generated/food.ts")).toBe(false);
    expect(findFoodStaticCandidates([{ path: "docs/food-knowledge.ts",
      content: "export const FOOD_ALIASES = ['pão'];" }])).toEqual([]);
    const findings = findFoodStaticCandidates([packageData, entry].filter(file =>
      isFoodArchitectureSourcePath(file.path)));
    expect(findings.some(f => f.file === packageData.path && f.ruleId === "17")).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    expect(findFoodStaticCandidates([packageData])).toEqual([]);
    const typeEntry = { path: "server/foodApi.ts",
      content: "import type { FoodAlias } from '../packages/food-intelligence/knowledge';" };
    expect(findFoodStaticCandidates([packageData, typeEntry])).toEqual([]);
  });

  it("A1300-28 follows cwd-rooted filesystem catalogs without exempting isolated JSON", () => {
    const catalog = { path: "data/foodPortions.json", content: '{"pao":50,"arroz":90}' };
    const consumers = [
      "import { readFileSync } from 'node:fs'; const rows = readFileSync(path.join(process.cwd(), 'data', 'foodPortions.json'));",
      "import fs from 'node:fs'; const rows = fs.readFileSync(path.resolve(process.cwd(), 'data', 'foodPortions.json'));",
    ];
    expect(findFoodStaticCandidates([catalog])).toEqual([]);
    for (const content of consumers) {
      const findings = findFoodStaticCandidates([catalog, { path: "server/foodResolver.ts", content }]);
      expect(findings.some(f => f.file === catalog.path && f.ruleId === "17"), content).toBe(true);
      expect(findings.some(f => f.file === catalog.path && f.ruleId === "5"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
  });

  it("A1300-29 blocks numeric food maps with default exports and imported aliases", () => {
    const producers = [
      "export default { pao: 50, arroz: 90 };",
      "const table = { pao: 50, arroz: 90 }; export default table;",
      "export default new Map([['pao', 50], ['arroz', 90]]);",
    ];
    for (const content of producers) {
      const producer = { path: "server/numbers.ts", content };
      const consumer = { path: "server/foodResolver.ts",
        content: "import portions from './numbers'; const rows = portions; function resolvePortion(foodName: string) { return rows[foodName]; }" };
      const findings = findFoodStaticCandidates([producer, consumer]);
      expect(findings.some(f => f.ruleId === "17" &&
        f.symbol.includes("imported-numeric-food-map")), content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" &&
        f.symbol.includes("imported-numeric-food-map")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
      const account = { path: "server/account.ts",
        content: "import roles from './numbers'; function accountRole(username: string) { return roles[username]; }" };
      expect(findFoodStaticCandidates([producer, account]).filter(f =>
        f.symbol.includes("imported-numeric-food-map"))).toEqual([]);
    }
  });

  it("A1300-30 blocks direct numeric returns for food-specific decisions, not conversion units", () => {
    for (const content of [
      "function defaultPortionGrams(foodName: string) { return 50; }",
      "const resolveServingGrams = (item: {foodId: string}) => 80;",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodResolver.ts", content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes(":numeric-return")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function gramsPerKilogram(weightKg: number) { return 1000; }",
      "function caloriesBurned(activity: string) { return 50; }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/exercise.ts", content }])
        .filter(f => f.symbol.includes(":numeric-return"))).toEqual([]);
    }
  });

  it("A1300-31 fails removal of confirmed debt while the reviewed violation persists", () => {
    const reviewed = [{ file: finding.file, symbol: finding.symbol,
      rules: [finding.ruleId], review: { classification: "confirmed-legacy-violation" } }];
    const approved = { ruleId: finding.ruleId, file: finding.file,
      fingerprint: finding.fingerprint, reason: "reviewed legacy",
      owner: "food-team", issue: 1300, createdAt: "2026-10-12", expiresAt: "2026-12-11" };
    expect(assessReviewedFoodDebt([finding], [finding], [], reviewed)).toContain(
      "Confirmed legacy debt removed while violation remains: " + finding.fingerprint);
    expect(assessReviewedFoodDebt([finding], [finding], [approved], reviewed)).toEqual([]);
    expect(assessReviewedFoodDebt([], [finding], [], reviewed)).toEqual([]);
    expect(assessReviewedFoodDebt([finding], [finding], [approved], [
      { ...reviewed[0], review: { classification: "heuristic-candidate" } },
    ]).some(error => error.includes("lacks source-reviewed"))).toBe(true);
  });

  it("A1300-32 follows named aliases and chained reexports for imported portion maps", () => {
    const files = [
      { path: "server/numbers.ts",
        content: "const table = { pao: 50, arroz: 90 }; export { table as quantities };" },
      { path: "server/barrel.ts", content: "export { quantities as portions } from './numbers';" },
      { path: "server/aggregate.ts", content: "export * from './barrel';" },
      { path: "server/foodResolver.ts", content:
        "import { portions as sizes } from './aggregate'; function resolvePortion(foodName: string) { return sizes[foodName]; }" },
    ];
    const findings = findFoodStaticCandidates(files);
    for (const id of ["17", "5"]) {
      expect(findings.some(f => f.ruleId === id && f.file === "server/foodResolver.ts" &&
        f.symbol.includes("imported-numeric-food-map"))).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    const account = { path: "server/account.ts",
      content: "import { portions } from './aggregate'; function role(user: string) { return portions[user]; }" };
    expect(findFoodStaticCandidates([...files.slice(0, 3), account]).filter(f =>
      f.symbol.includes("imported-numeric-food-map"))).toEqual([]);
    const types = { path: "server/typeBarrel.ts",
      content: "export type { quantities as portions } from './numbers';" };
    expect(findFoodStaticCandidates([files[0], types, { path: "server/foodResolver.ts",
      content: "import type { portions } from './typeBarrel';" }]).filter(f =>
      f.symbol.includes("imported-numeric-food-map"))).toEqual([]);
  });

  it("A1300-33 detects conditional and arithmetic nutritional returns, not unit conversions", () => {
    for (const content of [
      "function defaultPortionGrams(foodName: string) { return foodName.length > 0 ? 50 : 80; }",
      "const resolveServingGrams = (foodId: string) => foodId ? 40 * 2 : getServing(foodId);",
      "function nutritionKcal(item: {foodId: string}) { return choose(item) ? 120 : 0; }",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodResolver.ts", content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes(":numeric-return")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function gramsPerKilogram(weightKg: number) { return weightKg > 0 ? 1000 : 0; }",
      "function caloriesBurned(activity: string) { return activity ? 50 : 80; }",
      "function defaultPortionGrams(foodName: string) { return lookupPortion(foodName); }",
    ]) {
      expect(findFoodStaticCandidates([{ path: "server/calculations.ts", content }])
        .filter(f => f.symbol.includes(":numeric-return"))).toEqual([]);
    }
  });

  it("A1300-34 blocks generic numeric JSON only when the imported binding is indexed by food identity", () => {
    const weights = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const direct = { path: "server/foodItemResolution.ts", content:
      "import weights from './weights.json'; function resolvePortion(foodName: string) { return weights[foodName]; }" };
    expect(findFoodStaticCandidates([weights])).toEqual([]);
    const findings = findFoodStaticCandidates([weights, direct]);
    for (const ruleId of ["17", "5"]) {
      expect(findings.some(f => f.file === weights.path && f.ruleId === ruleId &&
        f.symbol === "json-food-catalog"), ruleId).toBe(true);
      expect(findings.some(f => f.file === direct.path && f.ruleId === ruleId &&
        f.symbol.includes("imported-numeric-food-map")), ruleId).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);

    const aliased = { path: direct.path, content:
      "import weights from './weights.json'; const sizes = weights; function resolvePortion(foodName: string) { return sizes[foodName]; }" };
    expect(findFoodStaticCandidates([weights, aliased]).some(f =>
      f.file === weights.path && f.ruleId === "17")).toBe(true);

    const fixture = { path: "server/fixtures/weights.json", content: weights.content };
    const fixtureConsumer = { path: direct.path, content:
      "import weights from './fixtures/weights.json'; function resolvePortion(foodName: string) { return weights[foodName]; }" };
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
    expect(findFoodStaticCandidates([fixture, fixtureConsumer]).some(f =>
      f.file === fixture.path && f.ruleId === "17")).toBe(true);
    expect(findFoodStaticCandidates([fixture, { path: direct.path,
      content: "import type weights from './fixtures/weights.json';" }])).toEqual([]);

    const negatives = [
      { path: "server/account.ts", content:
        "import weights from './weights.json'; function role(user: string) { return weights[user]; }" },
      { path: direct.path, content:
        "import weights from './weights.json'; function status(value: string) { return weights[value]; }" },
      { path: "server/exerciseService.ts", content:
        "import weights from './weights.json'; function exercise(foodName: string) { return weights[foodName]; }" },
      { path: direct.path, content:
        "import weights from './weights.json'; const unused = weights;" },
    ];
    for (const negative of negatives) {
      expect(findFoodStaticCandidates([weights, negative]).filter(f =>
        f.symbol === "json-food-catalog" || f.symbol.includes("imported-numeric-food-map")),
      negative.content).toEqual([]);
    }
  });

  it("A1300-35 follows CommonJS and import-equals JSON bindings only in food decisions", () => {
    const weights = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const consumerPath = "server/foodItemResolution.ts";
    const variants = [
      "const weights = require('./weights.json'); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import weights = require('./weights.json'); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = require('./weights.json'); const sizes = weights; function resolvePortion(foodName: string) { return sizes[foodName]; }",
      "function resolvePortion(foodName: string) { const weights = require('./weights.json'); return weights[foodName]; }",
      "function resolvePortion(foodName: string) { const weights = require('./weights.json'); const sizes = weights; return sizes[foodName]; }",
    ];
    for (const content of variants) {
      const findings = findFoodStaticCandidates([weights, { path: consumerPath, content }]);
      for (const ruleId of ["17", "5"]) {
        expect(findings.some(f => f.file === weights.path && f.ruleId === ruleId &&
          f.symbol === "json-food-catalog"), content + ":" + ruleId).toBe(true);
        expect(findings.some(f => f.file === consumerPath && f.ruleId === ruleId &&
          f.symbol.includes("imported-numeric-food-map")), content + ":" + ruleId).toBe(true);
      }
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length,
        content).toBeGreaterThan(0);
    }
    const fixture = { path: "server/fixtures/weights.json", content: weights.content };
    const viaRequire = { path: consumerPath, content:
      "const weights = require('./fixtures/weights.json'); function resolvePortion(foodName: string) { return weights[foodName]; }" };
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
    expect(findFoodStaticCandidates([fixture, viaRequire]).some(f =>
      f.file === fixture.path && f.ruleId === "17" && f.symbol === "json-food-catalog")).toBe(true);
    const negatives = [
      { path: "server/account.ts", content:
        "const weights = require('./weights.json'); function role(user: string) { return weights[user]; }" },
      { path: "server/account.ts", content:
        "function role(user: string) { const weights = require('./weights.json'); return weights[user]; }" },
      { path: "server/exerciseService.ts", content:
        "const weights = require('./weights.json'); function exercise(foodName: string) { return weights[foodName]; }" },
      { path: consumerPath, content:
        "import weights = require('./weights.json'); function status(value: string) { return weights[value]; }" },
      { path: consumerPath, content:
        "const weights = require('./weights.json'); const unused = weights;" },
      { path: consumerPath, content:
        "import type weights = require('./weights.json');" },
    ];
    for (const negative of negatives) {
      expect(findFoodStaticCandidates([weights, negative]).filter(f =>
        f.symbol === "json-food-catalog" || f.symbol.includes("imported-numeric-food-map")),
      negative.content).toEqual([]);
    }
  });

  it("A1300-36 blocks food-indexed JSON.parse(readFileSync(...)) and excludes unrelated reads", () => {
    const weights = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const foodPath = "server/foodItemResolution.ts";
    const positives = [
      "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'node:fs'; function resolvePortion(foodName: string) { const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); const sizes = weights; return sizes[foodName]; }",
      "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(path.join(__dirname, 'weights.json'), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'node:fs'; const weights = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'server', 'weights.json'), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of positives) {
      const findings = findFoodStaticCandidates([weights, { path: foodPath, content }]);
      for (const ruleId of ["17", "5"]) {
        expect(findings.some(f => f.file === weights.path && f.ruleId === ruleId &&
          f.symbol === "json-food-catalog"), content + ":" + ruleId).toBe(true);
        expect(findings.some(f => f.file === foodPath && f.ruleId === ruleId &&
          f.symbol.includes("imported-numeric-food-map")), content + ":" + ruleId).toBe(true);
      }
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length,
        content).toBeGreaterThan(0);
    }
    const fixture = { path: "server/fixtures/weights.json", content: weights.content };
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
    expect(findFoodStaticCandidates([fixture, { path: foodPath, content:
      "import fs from 'node:fs'; const weights = JSON.parse(fs.readFileSync(new URL('./fixtures/weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }" }])
      .some(f => f.file === fixture.path && f.ruleId === "17" && f.symbol === "json-food-catalog")).toBe(true);
    const negatives = [
      { path: "server/account.ts", content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function role(user: string) { return weights[user]; }" },
      { path: "server/exerciseService.ts", content:
        "import fs from 'node:fs'; const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function exercise(foodName: string) { return weights[foodName]; }" },
      { path: foodPath, content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function status(value: string) { return weights[value]; }" },
      { path: foodPath, content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); const unused = weights;" },
      { path: foodPath, content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(getPath(), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }" },
    ];
    for (const negative of negatives) {
      expect(findFoodStaticCandidates([weights, negative]).filter(f =>
        f.symbol === "json-food-catalog" || f.symbol.includes("imported-numeric-food-map")),
      negative.content).toEqual([]);
    }
  });

  it("A1300-37 follows aliased filesystem JSON readers without classifying unrelated data", () => {
    const weights = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const foodPath = "server/foodItemResolution.ts";
    const positives = [
      "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const { readFileSync: load } = require('node:fs'); const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fileSystem = require('node:fs'); const weights = JSON.parse(fileSystem.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'node:fs'; const weights = JSON.parse(fs['readFileSync'](new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import * as io from 'fs'; const weights = JSON.parse(io.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import { readFileSync as load } from 'node:fs'; const readAlias = load; const weights = JSON.parse(readAlias(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of positives) {
      const findings = findFoodStaticCandidates([weights, { path: foodPath, content }]);
      for (const ruleId of ["17", "5"]) {
        expect(findings.some(f => f.file === weights.path && f.ruleId === ruleId &&
          f.symbol === "json-food-catalog"), content + ":" + ruleId).toBe(true);
        expect(findings.some(f => f.file === foodPath && f.ruleId === ruleId &&
          f.symbol.includes("imported-numeric-food-map")), content + ":" + ruleId).toBe(true);
      }
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length,
        content).toBeGreaterThan(0);
    }
    const fixture = { path: "server/fixtures/weights.json", content: weights.content };
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
    expect(findFoodStaticCandidates([fixture, { path: foodPath, content:
      "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load(new URL('./fixtures/weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }" }])
      .some(f => f.file === fixture.path && f.ruleId === "17" && f.symbol === "json-food-catalog")).toBe(true);
    const negatives = [
      { path: "server/account.ts", content:
        "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function role(user: string) { return weights[user]; }" },
      { path: "server/exerciseService.ts", content:
        "const fileSystem = require('fs'); const weights = JSON.parse(fileSystem.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function exercise(foodName: string) { return weights[foodName]; }" },
      { path: foodPath, content:
        "import * as io from 'fs'; const weights = JSON.parse(io.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function status(value: string) { return weights[value]; }" },
      { path: foodPath, content:
        "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); const unused = weights;" },
      { path: foodPath, content:
        "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load(getPath(), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }" },
      { path: foodPath, content:
        "import type { readFileSync as load } from 'node:fs'; function resolvePortion(foodName: string) { return 0; }" },
    ];
    for (const negative of negatives) {
      expect(findFoodStaticCandidates([weights, negative]).filter(f =>
        f.symbol === "json-food-catalog" || f.symbol.includes("imported-numeric-food-map")),
      negative.content).toEqual([]);
    }
  });


  it("A1300-38 tracks direct CommonJS filesystem member calls and aliases", () => {
    const source = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const consumerPath = "server/foodItemResolution.ts";
    const positives = [
      "const weights = JSON.parse(require('node:fs').readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('node:fs').readFileSync; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('fs')['readFileSync'](new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('fs')['readFileSync']; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of positives) {
      const findings = findFoodStaticCandidates([source, { path: consumerPath, content }]);
      for (const ruleId of ["17", "5"]) {
        expect(findings.some(f => f.file === source.path && f.ruleId === ruleId &&
          f.symbol === "json-food-catalog"), content + ":" + ruleId).toBe(true);
        expect(findings.some(f => f.file === consumerPath && f.ruleId === ruleId &&
          f.symbol.includes("imported-numeric-food-map")), content + ":" + ruleId).toBe(true);
      }
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length,
        content).toBeGreaterThan(0);
    }
    const negatives = [
      "const weights = JSON.parse(require('not-fs').readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require(moduleName).readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('node:fs/promises').readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('node:fs').readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function role(user: string) { return weights[user]; }",
    ];
    for (const content of negatives) {
      const findings = findFoodStaticCandidates([source, { path: consumerPath, content }]);
      expect(findings.filter(f => f.symbol === "json-food-catalog" ||
        f.symbol.includes("imported-numeric-food-map")), content).toEqual([]);
    }
  });

  it("A1300-39 requires a real filesystem provider rather than matching shadowed names", () => {
    const source = { path: "server/weights.json", content: '{"arroz":90,"pao":50}' };
    const path = "server/foodItemResolution.ts";
    const positive = [
      "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs = require('node:fs'); const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('fs').readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('fs').readFileSync; const weights = JSON.parse(load(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of positive) {
      const findings = findFoodStaticCandidates([source, { path, content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol === "json-food-catalog"),
        content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" && f.symbol.includes("imported-numeric-food-map")),
        content).toBe(true);
    }
    const negative = [
      "const readFileSync = (_path: string) => '{\"arroz\":90}'; const weights = JSON.parse(readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fs = { readFileSync: (_path: string) => '{\"arroz\":90}' }; const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'fake-fs'; const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fs = require('my-fs-wrapper'); const weights = JSON.parse(fs.readFileSync(new URL('./weights.json', import.meta.url), 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of negative) {
      const findings = findFoodStaticCandidates([source, { path, content }]);
      expect(findings.filter(f => f.symbol === "json-food-catalog" ||
        f.symbol.includes("imported-numeric-food-map")), content).toEqual([]);
    }
  });

  it("audit 2026-10-14 blocks nested per-food numeric maps and keeps activity data inert", () => {
    for (const literal of [
      "const values = { pao: { calories: 90 }, arroz: { calories: 120 } }; function resolvePortion(foodName: string) { return values[foodName]?.calories; }",
      "const values = new Map([['pao', { calories: 90, unit: 'g' }], ['arroz', { nutrition: { calories: 120 }, source: 'label' }]]); function resolvePortion(foodName: string) { return values.get(foodName)?.calories; }",
    ]) {
      const detected = findFoodStaticCandidates([{ path: "server/foodItemResolution.ts", content: literal }]);
      for (const id of ["17", "5"]) {
        expect(detected.some(f => f.ruleId === id && f.symbol.includes("numeric-food-map")), literal + id).toBe(true);
      }
      expect(evaluateFoodArchitectureGate(detected, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const source = { path: "server/weights.json",
      content: '{"pao":{"calories":90,"unit":"g"},"arroz":{"nutrition":{"calories":120},"source":"label"}}' };
    const consumer = { path: "server/foodItemResolution.ts",
      content: 'import weights from "./weights.json"; function resolvePortion(foodName: string) { return weights[foodName]?.calories; }' };
    const detected = findFoodStaticCandidates([source, consumer]);
    expect(detected.some(f => f.file === source.path && f.ruleId === "17" && f.symbol === "json-food-catalog")).toBe(true);
    expect(detected.some(f => f.file === consumer.path && f.ruleId === "5" &&
      f.symbol.includes("imported-numeric-food-map"))).toBe(true);
    const activity = findFoodStaticCandidates([{ path: "server/handlers/activity.ts",
      content: "const values = { running: { calories: 90 } }; function getActivity(activityName: string) { return values[activityName]?.calories; }" }]);
    expect(activity.filter(f => f.symbol.includes("numeric-food-map"))).toEqual([]);
  });

  it("audit 2026-10-14 never exempts presentation labels used as food identity predicates", () => {
    const productive = findFoodStaticCandidates([{ path: "client/src/components/FoodEntry.tsx",
      content: "const foodLabel = 'pao'; function detect(input: string) { return input === foodLabel; }" }]);
    expect(productive.some(f => f.ruleId === "17" && f.symbol === "foodLabel")).toBe(true);
    expect(evaluateFoodArchitectureGate(productive, [], [], today).errors.length).toBeGreaterThan(0);
    const visual = findFoodStaticCandidates([{ path: "client/src/components/FoodEntry.tsx",
      content: "const foodLabel = 'Alimento'; export function Display() { return <span>{foodLabel}</span>; }" }]);
    expect(visual.filter(f => f.symbol === "foodLabel")).toEqual([]);
  });

  it("audit 2026-10-14 detects materiality regexes in generic handlers, not unrelated formats", () => {
    for (const content of [
      "function decide(value: string) { return /integral/i.test(value); }",
      "const matcher = /light/i; function decide(value: string) { return matcher.test(value); }",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/handlers/generic.ts", content }]);
      expect(findings.some(f => f.ruleId === "18" && f.symbol.includes("lexical-regex")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "function decide(value: string) { return /active/i.test(value); }",
      "function decide(value: string) { return /^\\d+$/.test(value); }",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/handlers/generic.ts", content }]);
      expect(findings.filter(f => f.ruleId === "18")).toEqual([]);
    }
  });


  it("A1300-42 blocks food alias dictionaries consumed through Object.entries and replaceAll", () => {
    const cases = [
      { path: "server/foodItemResolution.ts",
        content: "function normalizeFoodInput(text: string) { const dict = { pao: 'pão', cafe: 'café' }; let result = text; for (const [from, to] of Object.entries(dict)) { result = result.replaceAll(from, to); } return result; }" },
      { path: "server/modules/whatsapp/informalLanguageNormalizer.ts",
        content: "function normalizeWhatsappInformalLanguage(text: string) { const changes = { pao: 'pão' }; return Object.entries(changes).reduce((value, [from, to]) => value.replaceAll(from, to), text); }" },
    ];
    for (const example of cases) {
      const findings = findFoodStaticCandidates([example]);
      expect(findings.some(f => f.symbol.includes("iterated-lexical-dictionary")), example.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const example of [
      { path: "server/accountHelpers.ts",
        content: "function normalizeStatus(input: string) { const values = { pending: 'Pendente' }; let result = input; for (const [from, to] of Object.entries(values)) { result = result.replaceAll(from, to); } return result; }" },
      { path: "client/src/components/FoodEntry.tsx",
        content: "function renderLabels() { const titles = { save: 'Salvar' }; return Object.entries(titles).map(([key, label]) => <span key={key}>{label}</span>); }" },
      { path: "server/foodItemResolution.ts",
        content: "function normalizeFoodInput(input: string) { const tags = { pending: 'Pendente' }; return Object.entries(tags).map(([code, name]) => name); }" },
    ]) {
      const findings = findFoodStaticCandidates([example]);
      expect(findings.filter(f => f.symbol.includes("iterated-lexical-dictionary")), example.content).toEqual([]);
    }
  });

  it("A1300-43 includes statically loaded async food JSON from fs/promises", () => {
    const json = { path: "server/weights.json", content: '{"pao":50,"arroz":90}' };
    const examples = [
      "import { readFile } from 'node:fs/promises'; async function resolvePortion(foodName: string) { const weights = JSON.parse(await readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "import * as io from 'node:fs/promises'; async function resolvePortion(foodName: string) { const weights = JSON.parse(await io.readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "import fs from 'node:fs'; async function resolvePortion(foodName: string) { const weights = JSON.parse(await fs.promises.readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "const io = require('node:fs/promises'); async function resolvePortion(foodName: string) { const weights = JSON.parse(await io.readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "async function resolvePortion(foodName: string) { const weights = JSON.parse(await require('node:fs/promises').readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "import { readFile as load } from 'node:fs/promises'; async function resolvePortion(foodName: string) { const raw = await load(new URL('./weights.json', import.meta.url), 'utf8'); const weights = JSON.parse(raw); return weights[foodName]; }",
    ];
    for (const content of examples) {
      const findings = findFoodStaticCandidates([json, { path: "server/foodItemResolution.ts", content }]);
      expect(findings.some(f => f.file === json.path && f.ruleId === "17" &&
        f.symbol === "json-food-catalog"), content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" &&
        f.symbol.includes("imported-numeric-food-map")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const content of [
      "import io from 'not-fs'; async function resolvePortion(foodName: string) { const weights = JSON.parse(await io.readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[foodName]; }",
      "import { readFile } from 'node:fs/promises'; async function getRole(user: string) { const weights = JSON.parse(await readFile(new URL('./weights.json', import.meta.url), 'utf8')); return weights[user]; }",
      "import { readFile } from 'node:fs/promises'; async function resolvePortion(foodName: string) { const weights = JSON.parse(await readFile(getPath(), 'utf8')); return weights[foodName]; }",
    ]) {
      const findings = findFoodStaticCandidates([json, { path: "server/foodItemResolution.ts", content }]);
      expect(findings.filter(f => f.symbol === "json-food-catalog" ||
        f.symbol.includes("imported-numeric-food-map")), content).toEqual([]);
    }
  });

  it("A1300-44 resolves imported food maps at lexical use sites without shadowing leaks", () => {
    const json = { path: "server/weights.json", content: '{"pao":50,"arroz":90}' };
    const source = "server/foodItemResolution.ts";
    const positive = [
      "import weights from './weights.json'; function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import weights from './weights.json'; function resolvePortion(foodName: string) { const alias = weights; return alias[foodName]; }",
      "function resolvePortion(foodName: string) { const weights = require('./weights.json'); return weights[foodName]; }",
    ];
    for (const content of positive) {
      const findings = findFoodStaticCandidates([json, { path: source, content }]);
      expect(findings.some(f => f.symbol.includes("imported-numeric-food-map")), content).toBe(true);
    }
    const shadows = [
      "import weights from './weights.json'; function resolvePortion(foodName: string) { const weights = loadDatabaseMap(); return weights[foodName]; }",
      "import weights from './weights.json'; function resolvePortion(weights: Record<string,number>, foodName: string) { return weights[foodName]; }",
      "import weights from './weights.json'; function resolvePortion(foodName: string) { const alias = weights; { const alias = loadDatabaseMap(); return alias[foodName]; } }",
    ];
    for (const content of shadows) {
      const findings = findFoodStaticCandidates([json, { path: source, content }]);
      expect(findings.filter(f => f.symbol.includes("imported-numeric-food-map")), content).toEqual([]);
    }
    const functions = "import weights from './weights.json'; function first(foodName: string) { const alias = weights; return alias[foodName]; } function second(foodName: string) { const alias = loadDatabaseMap(); return alias[foodName]; }";
    const findings = findFoodStaticCandidates([json, { path: source, content: functions }]);
    expect(findings.filter(f => f.ruleId === "17" && f.symbol.includes("imported-numeric-food-map"))).toHaveLength(1);
    // The real repository contains sparse destructuring patterns. An omitted
    // array element is not a binding and must never crash architecture:check.
    const sparse = findFoodStaticCandidates([json, { path: source, content:
      "import weights from './weights.json'; function resolvePortion(foodName: string) { for (const [, item] of [[1, 2]]) { void item; } return weights[foodName]; }" }]);
    expect(sparse.some(f => f.ruleId === "17" &&
      f.symbol.includes("imported-numeric-food-map"))).toBe(true);
  });


  it("A1300-45 blocks food lexicon string methods without flagging account/UI formats", () => {
    for (const method of ["includes", "startsWith", "endsWith"]) {
      const content = `function classifyFood(text: string) {
        return text.${method}("sem açúcar") ? "sugar_free" : "unknown";
      }`;
      const findings = findFoodStaticCandidates([{ path: "server/foodLexicon.ts", content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("literal-string-")), content).toBe(true);
      expect(findings.some(f => f.ruleId === "18" && f.symbol.includes("literal-string-")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const channel = findFoodStaticCandidates([{ path: "server/modules/whatsapp/normalizer.ts",
      content: 'function normalizeFoodInput(text: string) { return text.startsWith("sem açúcar"); }' }]);
    expect(channel.some(f => f.ruleId === "11" && f.symbol.includes("literal-string-"))).toBe(true);
    for (const item of [
      { path: "server/accountHelpers.ts", content: 'function classifyStatus(status: string) { return status.includes("error"); }' },
      { path: "server/foodLexicon.ts", content: 'function checkStatus(status: string) { return status.includes("error"); }' },
      { path: "client/src/pages/FoodPage.tsx", content: 'function displayInfo(text: string) { return text.startsWith("Salvar"); }' },
    ]) {
      const findings = findFoodStaticCandidates([item]);
      expect(findings.filter(f => f.symbol.includes("literal-string-")), item.content).toEqual([]);
    }
  });

  it("A1300-46 scans simple food alias arrays in productive and imported JSON only", () => {
    const data = { path: "server/foodAliases.json",
      content: '{"aliases":["pão", "pao", "pão de forma"]}' };
    const productive = findFoodStaticCandidates([data]);
    expect(productive.some(f => f.ruleId === "17" && f.symbol === "json-food-lexicon")).toBe(true);
    expect(evaluateFoodArchitectureGate(productive, [], [], today).errors.length).toBeGreaterThan(0);

    const imported = findFoodStaticCandidates([
      { path: "server/generated/aliases.json", content: '{"aliases":["pão","pao"]}' },
      { path: "server/foodAliasResolution.ts",
        content: 'import words from "./generated/aliases.json"; export const aliases = words.aliases;' },
    ]);
    expect(imported.some(f => f.file === "server/generated/aliases.json" &&
      f.symbol === "json-food-lexicon")).toBe(true);

    expect(findFoodStaticCandidates([{ path: "server/generated/aliases.json",
      content: '{"aliases":["pão","pao"]}' }])).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/accountAliases.json",
      content: '{"aliases":["admin","user"]}' }]).filter(f =>
        f.symbol === "json-food-lexicon")).toEqual([]);
    expect(findFoodStaticCandidates([{ path: "server/unrelated.ts",
      content: 'import aliases from "./accountAliases.json"; export const roles = aliases.aliases;' },
      { path: "server/accountAliases.json", content: '{"aliases":["admin","user"]}' },
    ]).filter(f => f.symbol === "json-food-lexicon")).toEqual([]);
  });

  it("A1300-47 permits only the actual canonical owner, never arbitrary V2 descendants", () => {
    const expected = findFoodStaticCandidates([{ path: "server/foodItemResolution.ts",
      content: 'export function resolveCanonicalFoodQuantity(foodName: string) { return foodName; }' }]);
    expect(expected.filter(f => f.ruleId === "1" || f.ruleId === "2")).toEqual([]);
    for (const path of ["server/foodItemResolution.ts",
      "server/modules/foodIntelligenceV1/foodResolver.ts",
      "server/modules/foodIntelligence" + "V2/extraResolver.ts",
      "server/modules/foodIntelligenceV3/foodResolver.ts"]) {
      const findings = findFoodStaticCandidates([{ path,
        content: 'export function resolveFood(input: string) { return input; }' }]);
      expect(findings.some(f => f.ruleId === "1" || f.ruleId === "2"), path).toBe(true);
    }
  });

  it("A1300-48 tracks food-identity key normalization in local and imported portion maps", () => {
    const cases = [
      [{ path: "server/foodPortionService.ts", content:
        "const table = {'pão': 50, arroz: 90}; function getFoodPortion(foodName: string) { const key = foodName.toLowerCase(); return table[key]; }" }],
      [{ path: "shared/lookup.ts", content: "export const lookup = {'pão': 50, arroz: 90};" },
        { path: "server/foodPortionService.ts", content:
          "import {lookup} from '../shared/lookup'; function getPortion(foodName: string) { const raw = foodName; const key = raw.trim().toLowerCase(); return lookup[key]; }" }],
    ];
    for (const files of cases) {
      const detected = findFoodStaticCandidates(files);
      expect(detected.some(f => f.ruleId === "17" && f.failureClass === "C"), JSON.stringify(files)).toBe(true);
      expect(detected.some(f => f.ruleId === "5"), JSON.stringify(files)).toBe(true);
      expect(evaluateFoodArchitectureGate(detected, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const legacyNumericLexicon = findFoodStaticCandidates([{ path: "server/foodTextNormalization.ts", content:
      "const NUMBER_WORDS = {um: 1, dois: 2}; function normalizeFoodText(input: string) { return NUMBER_WORDS[normalizeFoodLookupText(input)]; }" }]);
    expect(legacyNumericLexicon.some(f => f.ruleId === "17" && f.symbol.includes("numeric-food-map"))).toBe(true);
    const unrelated = findFoodStaticCandidates([{ path: "server/exerciseService.ts", content:
      "const table = {corrida:50, caminhada:90}; function getPortion(activityName: string) { const key = activityName.toLowerCase(); return table[key]; }" }]);
    expect(unrelated.filter(f => f.ruleId === "17" || f.ruleId === "5")).toEqual([]);
  });

  it("A1300-49 tracks lexical alias comparison using Object.entries, not only replaceAll", () => {
    const names = [
      "function normalizeFood(input: string) { for (const [raw, normalized] of Object.entries(table)) { if (input === raw) return normalized; } return input; }",
      "function normalizeFood(input: string) { for (const term of Object.keys(table)) { if (term == input) return table[term]; } return input; }",
    ];
    for (const variant of names) {
      const findings = findFoodStaticCandidates([{ path: "server/foodNormalizer.ts",
        content: "const table = {pao: 'pão', arro: 'arroz'}; " + variant }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("iterated-lexical-dictionary")), variant).toBe(true);
    }
    const unrelated = findFoodStaticCandidates([{ path: "server/accountService.ts", content:
      "const table={active:'A',blocked:'B'}; function classifyStatus(input:string){for (const [raw, normalized] of Object.entries(table)){if(input===raw) return normalized;}return input;}" }]);
    expect(unrelated.filter(f => f.symbol.includes("iterated-lexical-dictionary"))).toEqual([]);
  });

  it("A1300-50 tracks dynamic materiality tokens, not status or visual display", () => {
    const findings = findFoodStaticCandidates([{ path: "server/foodMaterialityService.ts", content:
      "const table={integral:'material',light:'material'}; function classifyMateriality(foodText:string){for(const [term,decision] of Object.entries(table)){if(foodText.includes(term))return decision;}return 'neutral';}" }]);
    expect(findings.some(f => f.ruleId === "18" && f.symbol.includes("iterated-lexical-dictionary"))).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    const display = findFoodStaticCandidates([{ path: "client/src/pages/FoodPage.tsx", content:
      "const labels={integral:'Integral',light:'Light'}; function renderOptions(){return Object.entries(labels).map(([term,label]) => label)}" }]);
    expect(display.filter(f => f.symbol.includes("iterated-lexical-dictionary"))).toEqual([]);
  });

  it("A1300-51 blocks arithmetic constants as nutritional knowledge but not dynamic DB values", () => {
    for (const numeric of ["20 + 30", "(100 / 2)", "40 * 2", "2 ** 4", "(60 - 10)"]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodPortionService.ts", content:
        `const table={'pão':${numeric}}; function getFoodPortion(foodName:string){return table[foodName]}` }]);
      expect(findings.some(f => f.ruleId === "17"), numeric).toBe(true);
      expect(findings.some(f => f.ruleId === "5"), numeric).toBe(true);
    }
    for (const numeric of ["20 + dbValue", "40 / externalGrams", "50 / 0"]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodPortionService.ts", content:
        `const table={'pão':${numeric}}; function getFoodPortion(foodName:string){return table[foodName]}` }]);
      expect(findings.filter(f => f.ruleId === "5" || f.ruleId === "17"), numeric).toEqual([]);
    }
  });

  it("A1300-52 blocks a lone fixed calorie/macro returned by a food resolver", () => {
    for (const literal of ["{ calories: 200 }", "{ protein: 3 }", "{ kcal: 50 }"]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodResolver.ts",
        content: `function resolveFood(foodName: string) { return ${literal}; }` }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge"),
        literal).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const negatives = findFoodStaticCandidates([{ path: "server/exerciseSummary.ts",
      content: "function calculateExercise(activity: string) { return { calories: 200 }; }" },
      { path: "server/foodResolver.ts",
        content: "function resolveFood(foodName: string, dbValue: number) { return { calories: dbValue }; }" }]);
    expect(negatives.filter(f => f.symbol === "inline-food-knowledge")).toEqual([]);
  });

  it("A1300-53 catches arrow resolvers in class and object properties without blocking pure forwarding", () => {
    const suspect = findFoodStaticCandidates([{ path: "server/modules/whatsapp/foodAdapter.ts",
      content: [
        "class AlternativeFoodResolver { resolveFood = async (foodName: string) => ({calories: 200}); }",
        "const channel = { resolveNutrition: (foodName: string) => ({calories: 90}) };",
      ].join("\n") }]);
    for (const gate of ["1", "2"]) {
      expect(suspect.some(f => f.ruleId === gate && f.symbol === "resolveFood")).toBe(true);
      expect(suspect.some(f => f.ruleId === gate && f.symbol === "resolveNutrition")).toBe(true);
    }
    const delegated = findFoodStaticCandidates([{ path: "server/modules/whatsapp/foodAdapter.ts",
      content: [
        "import { resolveCanonicalFoodQuantity } from '../../foodItemResolution';",
        "class Forwarder { resolveFood = (foodName: string) => resolveCanonicalFoodQuantity(foodName); }",
        "const admin = { resolveAccount: (id: string) => id };",
      ].join("\n") }]);
    expect(delegated.filter(f => ["1", "2"].includes(f.ruleId))).toEqual([]);
    const fake = findFoodStaticCandidates([{ path: "server/modules/whatsapp/foodAdapter.ts",
      content: "const channel = { resolveFood: (foodName: string) => resolveCanonicalFoodQuantity(foodName) };" }]);
    expect(fake.some(f => f.ruleId === "1")).toBe(true);
  });

  it("A1300-54 blocks opaque food JSON and dynamic imports but not unrelated filesystem data", () => {
    const cases = [
      "import { readFileSync } from 'node:fs'; function resolveFood(foodName: string, dataFile: string) { return JSON.parse(readFileSync(dataFile, 'utf8')); }",
      "import fs from 'node:fs'; function resolveFood(foodName: string, dataFile: string) { const raw = fs.readFileSync(dataFile, 'utf8'); return JSON.parse(raw); }",
      "import { readFile } from 'node:fs/promises'; async function resolveFood(foodName: string, fileName: string) { return JSON.parse(await readFile(fileName, 'utf8')); }",
      "async function resolveFood(foodName: string) { return import(`./fixtures/${foodName}.json`); }",
    ];
    for (const content of cases) {
      const findings = findFoodStaticCandidates([{ path: "server/foodPortionService.ts", content }]);
      expect(findings.some(f => f.ruleId === "17" &&
        f.symbol === "opaque-runtime-food-data-load"), content).toBe(true);
    }
    const unrelated = findFoodStaticCandidates([
      { path: "server/accountConfig.ts", content:
        "import { readFileSync } from 'node:fs'; function loadAccountSettings(configPath: string) { return JSON.parse(readFileSync(configPath, 'utf8')); }" },
      { path: "server/foodSettings.ts", content:
        "import { readFileSync } from 'node:fs'; function readSettings(settingsPath: string) { return JSON.parse(readFileSync(settingsPath, 'utf8')); }" },
      { path: "server/foodPortionService.ts", content:
        "import { readFileSync } from 'node:fs'; function resolveFood() { return JSON.parse(readFileSync('./catalog.json', 'utf8')); }" },
    ]);
    expect(unrelated.filter(f => f.symbol === "opaque-runtime-food-data-load")).toEqual([]);
  });

  it("AUD1300-01 blocks food presentation literals when passed into a decision sink", () => {
    const cases = [
      "const foodLabel = 'pão'; export const selected = resolveCanonicalFoodQuantity(foodLabel);",
      "const foodLabel = 'pão'; const chosen = foodLabel; function save() { return resolveCanonicalFoodQuantity(chosen); }",
      "const foodLabel = 'pão'; export const decision = { foodName: foodLabel };",
      "const foodLabel = 'pão'; function resolveFoodName() { return foodLabel; }",
      "const foodLabel = 'pão'; export const decision = resolveCanonicalFoodQuantity({ foodName: foodLabel });",
    ];
    for (const content of cases) {
      const found = findFoodStaticCandidates([{ path: "client/src/components/FoodEntry.tsx", content }]);
      expect(found.some(f => f.ruleId === "17" && f.symbol === "foodLabel"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(found, [], [], today).errors.some(
        error => error.includes("New food architecture violation")), content).toBe(true);
    }
    for (const content of [
      "const foodLabel = 'Adicionar alimento'; export const View = () => <span>{foodLabel}</span>;",
      "const foodLabel = 'Adicionar alimento'; const labelCopy = foodLabel; export const View = () => <span>{labelCopy}</span>;",
      "const foodLabel = 'Adicionar alimento'; function handle(foodLabel: string) { return resolveCanonicalFoodQuantity(foodLabel); }",
    ]) {
      const found = findFoodStaticCandidates([{ path: "client/src/components/FoodEntry.tsx", content }]);
      expect(found.filter(f => f.ruleId === "17" && f.symbol === "foodLabel"), content).toEqual([]);
    }
  });

  it("AUD1300-02 blocks parallel food decision owners outside channel paths", () => {
    const parallel = [
      "export function resolveFood(name: string) { return { foodName: name, calories: 95 }; }",
      "export const resolveNutrition = (foodName: string) => ({ calories: 95 });",
      "export function createCatalogResolver(foodName: string) { return { foodName, calories: 95 }; }",
    ];
    for (const content of parallel) {
      const found = findFoodStaticCandidates([{ path: "server/modules/catalog/service.ts", content }]);
      expect(found.some(f => f.ruleId === "2"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(found, [], [], today).errors.length, content).toBeGreaterThan(0);
    }
    const delegated = findFoodStaticCandidates([{ path: "server/modules/catalog/service.ts",
      content: [
        "import { resolveCanonicalFoodQuantity } from '../../foodItemResolution';",
        "export function resolveFood(foodName: string) { return resolveCanonicalFoodQuantity(foodName); }",
      ].join("\n"),
    }]);
    expect(delegated.filter(f => f.ruleId === "2")).toEqual([]);
    for (const expression of ["'pão'", "foodName.trim()", "otherFood"]) {
      const altered = findFoodStaticCandidates([{ path: "server/modules/catalog/service.ts",
        content: [
          "import { resolveCanonicalFoodQuantity } from '../../foodItemResolution';",
          "export function resolveFood(foodName: string) { return resolveCanonicalFoodQuantity(" + expression + "); }",
        ].join("\n"),
      }]);
      expect(altered.some(f => f.ruleId === "2"), expression).toBe(true);
    }
    const generic = findFoodStaticCandidates([{ path: "server/modules/accounts/service.ts",
      content: "export function createAccountResolver(userId: string) { return userId; }",
    }]);
    expect(generic.filter(f => f.ruleId === "2")).toEqual([]);
  });

  it("AUD1300-03 tracks immutable numeric aliases used as food macros, but not dynamic or shadowed values", () => {
    const cases = [
      "const n = 95; export function compute(foodId: string) { return { foodId, calories: n }; }",
      "const n = 60; const alias = n + 35; export function compute(foodId: string) { return { foodId, protein: alias }; }",
      "function resolveFood(foodName: string) { const n = 95; return { calories: n }; }",
      "const n = 50; function compute(foodId: string) { return { foodId, macros: { protein: n } }; }",
    ];
    for (const content of cases) {
      const found = findFoodStaticCandidates([{ path: "server/foodCompute.ts", content }]);
      expect(found.some(f => f.ruleId === "17" && f.symbol === "inline-food-knowledge"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(found, [], [], today).errors.length, content).toBeGreaterThan(0);
    }
    const negatives = [
      "const n = loadFromDatabase(); function compute(foodId: string) { return { foodId, calories: n }; }",
      "const n = 95; function compute(foodId: string, n: number) { return { foodId, calories: n }; }",
      "let n = 95; function compute(foodId: string) { return { foodId, calories: n }; }",
      "const n = 95; function exercise() { return { calories: n }; }",
    ];
    for (const content of negatives) {
      const found = findFoodStaticCandidates([{ path: "server/foodCompute.ts", content }]);
      expect(found.filter(f => f.symbol === "inline-food-knowledge"), content).toEqual([]);
    }
  });

  it("AUD1300-04 blocks mixed nutritional maps in TypeScript and imported JSON", () => {
    const mixedLocal = findFoodStaticCandidates([{ path: "server/foodPortions.ts",
      content: "const weights = { pao: 50, arroz: null }; function resolvePortion(foodName: string) { return weights[foodName]; }",
    }]);
    for (const id of ["17", "5"]) {
      expect(mixedLocal.some(f => f.ruleId === id && f.symbol.includes("numeric-food-map"))).toBe(true);
    }
    const mixedImported = findFoodStaticCandidates([
      { path: "server/data/weights.json", content: '{"pao":50,"arroz":null}' },
      { path: "server/foodPortions.ts",
        content: 'import weights from "./data/weights.json"; function resolvePortion(foodName: string) { return weights[foodName]; }' },
    ]);
    for (const id of ["17", "5"]) {
      expect(mixedImported.some(f => f.ruleId === id && f.file === "server/data/weights.json")).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(mixedImported, [], [], today).errors.length).toBeGreaterThan(0);
    const nonFood = findFoodStaticCandidates([
      { path: "server/data/accounts.json", content: '{"admin":50,"guest":null}' },
      { path: "server/accounts/service.ts",
        content: 'import weights from "../data/accounts.json"; function resolveAccount(role: string) { return weights[role]; }' },
    ]);
    expect(nonFood.filter(f => f.ruleId === "5" || f.symbol.includes("numeric-food-map"))).toEqual([]);
  });

  it("AUD1300-05 identifies generic resolver signatures by food catalog decisions", () => {
    const cases = [
      "import { FOOD_CATALOG_REFERENCE } from '../../foodCatalogReference'; export function createResolver(input: string) { return FOOD_CATALOG_REFERENCE.find(item => item.name === input); }",
      "import { foodCatalog } from '../../foodCatalogReference'; export const resolver = (input: string) => foodCatalog[input];",
      "export function createResolver(input: string) { const foodCatalog = require('../../foodCatalogReference'); return foodCatalog[input]; }",
    ];
    for (const content of cases) {
      const found = findFoodStaticCandidates([{ path: "server/modules/catalog/service.ts", content }]);
      expect(found.some(f => f.ruleId === "2"), content).toBe(true);
      expect(evaluateFoodArchitectureGate(found, [], [], today).errors.length, content).toBeGreaterThan(0);
    }
    for (const content of [
      "export function createResolver(input: string) { return accountCatalog[input]; }",
      "export const resolver = (input: string) => accountCatalog[input];",
      "export function createResolver(input: string) { return input; }",
    ]) {
      const found = findFoodStaticCandidates([{ path: "server/modules/accounts/service.ts", content }]);
      expect(found.filter(f => f.ruleId === "2"), content).toEqual([]);
    }
  });

  it("AUD1300-F01 blocks food identity decisions on generic arguments, not unrelated status", () => {
    for (const code of [
      "function normalize(item: string) { return item === 'pão' ? 'pão francês' : item; }",
      "function decide(input: string) { switch (input) { case 'arroz': return 90; default: return 0; } }",
    ]) {
      const findings = findFoodStaticCandidates([{ path: "server/foodRules.ts", content: code }]);
      expect(findings.some(f => f.ruleId === "17" && /lexical-(branch|switch)/.test(f.symbol)), code).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    for (const code of [
      "function normalizeStatus(item: string) { return item === 'active' ? 'ok' : item; }",
      "function decide(input: string) { return input === 'auto'; }",
    ]) {
      const path = code.includes("Status") ? "server/foodRules.ts" : "server/accounts/service.ts";
      expect(findFoodStaticCandidates([{ path, content: code }])
        .filter(f => f.ruleId === "17" && /lexical-(branch|switch)/.test(f.symbol)), code).toEqual([]);
    }
  });

  it("AUD1300-F02 detects generic parallel food owners without trapping account resolvers", () => {
    for (const code of [
      "function decide(input: string) { return foods.find(x => x.name === input); }",
      "function pick(input: string) { return foodCatalog.find(x => x.name === input); }",
    ]) {
      const found = findFoodStaticCandidates([{ path: "server/modules/catalog/service.ts", content: code }]);
      expect(found.some(f => f.ruleId === "2"), code).toBe(true);
      expect(evaluateFoodArchitectureGate(found, [], [], today).errors.length).toBeGreaterThan(0);
    }
    expect(findFoodStaticCandidates([{ path: "server/modules/accounts/service.ts",
      content: "function decide(input: string) { return accountCatalog.find(x => x.name === input); }" }])
      .filter(f => f.ruleId === "2")).toEqual([]);
  });

  it("AUD1300-F03 blocks generic JSON food rows selected by identity, not unused or activity lists", () => {
    const records = { path: "server/data/records.json",
      content: '[{"name":"pão","calories":90},{"name":"arroz","calories":130}]' };
    const resolver = { path: "server/foodResolver.ts",
      content: "import data from './data/records.json'; function resolveFood(input: string) { return data.find(row => row.name === input); }" };
    expect(findFoodStaticCandidates([records])).toEqual([]);
    const found = findFoodStaticCandidates([records, resolver]);
    for (const id of ["17", "5"]) {
      expect(found.some(f => f.ruleId === id && f.file === records.path), id).toBe(true);
    }
    expect(evaluateFoodArchitectureGate(found, [], [], today).errors.length).toBeGreaterThan(0);
    expect(findFoodStaticCandidates([records, { ...resolver,
      content: "import data from './data/records.json'; export const unused = data;" }])
      .filter(f => f.file === records.path)).toEqual([]);
    expect(findFoodStaticCandidates([records, {
      path: "server/exercises/activityService.ts",
      content: "import data from '../data/records.json'; function findActivity(input: string) { return data.find(row => row.name === input); }",
    }]).filter(f => f.file === records.path)).toEqual([]);
  });
  it("AUD1300-20261014-F04 blocks normalized food identity comparisons and switches", () => {
    const positives = [
      {
        path: "server/foodRules.ts",
        content: 'function pick(item: { name: string }) { return item.name.trim().toLowerCase() === "pão" ? 50 : 0; }',
        kind: "lexical-branch",
      },
      {
        path: "server/foodRules.ts",
        content: 'function choose(item: { name: string }) { switch (item.name.toLowerCase()) { case "pão": return 50; default: return 0; } }',
        kind: "lexical-switch",
      },
      {
        path: "server/foodRules.ts",
        content: 'function pick(input: string) { return input.normalize("NFC").trim().toLowerCase() === "pão" ? 50 : 0; }',
        kind: "lexical-branch",
      },
      {
        path: "server/foodRules.ts",
        content: 'function decide(item: { name: string }) { return item.name.replaceAll(" ", "").toLowerCase() === "pão" ? 50 : 0; }',
        kind: "lexical-branch",
      },
      {
        path: "server/foodRules.ts",
        content: 'function choose(item: { name: string }) { switch (normalizeFoodName(item.name)) { case "pão": return 50; default: return 0; } }',
        kind: "lexical-switch",
      },
      {
        path: "server/helpers.ts",
        content: 'function computeServing(item: { name: string }) { return item.name.trim().toLowerCase() === "pão" ? 50 : 0; }',
        kind: "lexical-branch",
      },
    ];
    for (const sample of positives) {
      const findings = findFoodStaticCandidates([sample]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes(sample.kind)),
        sample.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.some(error =>
        error.startsWith("New food architecture violation gate 17")), sample.content).toBe(true);
    }
  });

  it("AUD1300-20261014-F04 preserves non-food normalization and opaque-call negatives", () => {
    const negatives = [
      {
        path: "server/accounts.ts",
        content: 'function checkUser(user: { name: string }) { return user.name.trim().toLowerCase() === "admin"; }',
      },
      {
        path: "server/foodRules.ts",
        content: 'function checkStatus(status: string) { return status.trim().toLowerCase() === "active"; }',
      },
      {
        path: "server/exercises.ts",
        content: 'function decide(item: { name: string }) { return item.name.toLowerCase() === "walking" ? 1 : 0; }',
      },
      {
        path: "client/src/components/FoodTabs.tsx",
        content: 'function render(tab: { name: string }) { return tab.name.toLowerCase() === "daily"; }',
      },
      {
        path: "server/foodRules.ts",
        content: 'function pick(item: { name: string }) { return getStatus(item.name) === "active" ? 1 : 0; }',
      },
      {
        path: "server/accounts.ts",
        content: 'function checkUser(user: { name: string }) { return customTransform(user.name) === "admin"; }',
      },
    ];
    for (const sample of negatives) {
      const findings = findFoodStaticCandidates([sample]);
      expect(findings.filter(f => f.ruleId === "17" &&
        /lexical-(?:branch|switch)/.test(f.symbol)), sample.content).toEqual([]);
    }
  });

  it("AUD1300-LEX-01 blocks exec, match, search and matchAll food regex decisions", () => {
    const samples = [
      'return /\\\\bpão\\\\b/i.exec(foodName) ? "bread" : "unknown";',
      'return foodName.match(/pão|arroz/i) ? "bread" : "unknown";',
      'return foodName.search(/pão|arroz/i) >= 0 ? "bread" : "unknown";',
      'return [...foodName.matchAll(/pão|arroz/g)].length ? "bread" : "unknown";',
    ];
    for (const sample of samples) {
      const files = [{path: "server/foodClassifier.ts",
        content: "function classifyFood(foodName: string) { " + sample + " }"}];
      const findings = findFoodStaticCandidates(files);
      expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("lexical-regex")), sample).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.some(err =>
        err.startsWith("New food architecture violation gate 17")), sample).toBe(true);
    }
    const materiality = findFoodStaticCandidates([{ path: "server/foodMateriality.ts",
      content: 'function isMaterialFood(foodName: string) { return /light|sem açúcar/i.exec(foodName) !== null; }' }]);
    expect(materiality.some(f => f.ruleId === "18" && f.symbol.includes("lexical-regex"))).toBe(true);
    expect(evaluateFoodArchitectureGate(materiality, [], [], today).errors.length).toBeGreaterThan(0);
  });

  it("AUD1300-LEX-01 excludes account, status, UI and format-regex controls", () => {
    for (const sample of [
      {path:"server/accounts.ts",content:'function checkStatus(status: string) { return /active|pending/.exec(status); }'},
      {path:"server/foodService.ts",content:'function checkStatus(status: string) { return /active|pending/.exec(status); }'},
      {path:"client/src/components/FoodTabs.tsx",content:'function render(tab: string) { return tab.match(/daily|weekly/); }'},
      {path:"server/foodService.ts",content:'function validateFormat(code: string) { return /^\\\\d{3}$/.exec(code); }'},
    ]) {
      const findings = findFoodStaticCandidates([sample]);
      expect(findings.filter(f => f.symbol.includes("lexical-regex")), sample.content).toEqual([]);
    }
  });

  it("AUD1300-LEX-02 blocks imported generic lexical arrays at food decisions", () => {
    const source = {path:"shared/words.ts", content:'export const words = ["pão", "arroz"];'};
    const consumer = {path:"server/foodClassifier.ts", content:
      'import {words} from "../shared/words"; export function classifyFood(foodName: string) { return words.includes(foodName) ? "known" : "unknown"; }'};
    const findings = findFoodStaticCandidates([source, consumer]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("shared/words.ts#words"))).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    expect(findFoodStaticCandidates([source]).filter(f =>
      f.symbol.startsWith("consumed-lexical-table:"))).toEqual([]);
    const local = findFoodStaticCandidates([{path:"server/foodClassifier.ts",content:
      'const words = ["pão", "arroz"]; function classifyFood(foodName: string) { return words.includes(foodName); }'}]);
    expect(local.some(f => f.ruleId === "17" && f.symbol.startsWith("consumed-lexical-table:"))).toBe(true);
  });

  it("AUD1300-LEX-02 follows reexports, import aliases and const aliases", () => {
    const source = {path:"shared/vocab.ts",content:'export const words = ["pão", "arroz"];'};
    const barrel = {path:"shared/index.ts",content:'export {words as terms} from "./vocab";'};
    const consumer = {path:"server/foodClassifier.ts",content:
      'import { terms as vocabulary } from "../shared"; function classifyFood(foodName: string) { const names = vocabulary; return names.indexOf(foodName) >= 0; }'};
    const findings = findFoodStaticCandidates([source,barrel,consumer]);
    expect(findings.some(f => f.ruleId === "17" && f.symbol.includes("shared/vocab.ts#words"))).toBe(true);
    const shadowed = { ...consumer, content:
      'import { terms as vocabulary } from "../shared"; function classifyFood(foodName: string) { const vocabulary = loadFoodNames(); return vocabulary.includes(foodName); }'};
    expect(findFoodStaticCandidates([source,barrel,shadowed]).filter(f =>
      f.symbol.startsWith("consumed-lexical-table:"))).toEqual([]);
  });

  it("AUD1300-LEX-02 recognizes materiality and channel lexicons but not administrative data", () => {
    const words = {path:"shared/words.ts",content:'export const words = new Set(["integral", "light"]);'};
    const material = {path:"server/materiality.ts",content:
      'import {words} from "../shared/words"; function decideMateriality(attribute: string) { return words.has(attribute); }'};
    const candidate = findFoodStaticCandidates([words,material]);
    expect(candidate.some(f => f.ruleId === "18" && f.failureClass === "B")).toBe(true);
    expect(evaluateFoodArchitectureGate(candidate,[],[],today).errors.length).toBeGreaterThan(0);
    const channel = findFoodStaticCandidates([
      {path:"server/modules/whatsapp/vocab.ts",content:'export const words = ["pão","arroz"];'},
      {path:"server/modules/whatsapp/foodClassifier.ts",content:
        'import {words} from "./vocab"; function normalizeFoodInput(input:string) { return words.includes(input); }'},
    ]);
    expect(channel.some(f => f.ruleId === "11" && f.symbol.startsWith("consumed-lexical-table:"))).toBe(true);
    const administrative = findFoodStaticCandidates([
      {path:"shared/words.ts",content:'export const words = ["admin", "user"];'},
      {path:"server/accounts.ts",content:
        'import {words} from "../shared/words"; function checkStatus(status:string) { return words.includes(status); }'},
    ]);
    expect(administrative.filter(f => f.symbol.startsWith("consumed-lexical-table:"))).toEqual([]);
    expect(findFoodStaticCandidates([{path:"server/fixtures/vocab.ts",
      content:'export const words = ["pão", "arroz"];'}])).toEqual([]);
  });


  it("AUD1300-F01 blocks imported food/materiality dictionaries consumed by Object.entries", () => {
    const source = { path: "shared/lexical-tables.ts",
      content: "export const terms = { integral: 'material', light: 'material' };" };
    const barrel = { path: "shared/lexical-index.ts",
      content: 'export { terms as catalog } from "./lexical-tables";' };
    const positive = { path: "server/foodMateriality.ts",
      content: 'import { catalog as words } from "../shared/lexical-index"; function decideMateriality(foodText: string) { for (const [term, value] of Object.entries(words)) { if (foodText.includes(term)) return value; } return "neutral"; }' };
    const findings = findFoodStaticCandidates([source, barrel, positive]);
    expect(findings.some(f => f.ruleId === "18" &&
      f.symbol.includes("shared/lexical-tables.ts#terms"))).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    const normalized = { path: "server/foodNormalizer.ts",
      content: 'import { catalog } from "../shared/lexical-index"; function normalizeFood(input: string) { return Object.entries(catalog).reduce((text, [term, replacement]) => text.replaceAll(term, replacement), input); }' };
    expect(findFoodStaticCandidates([source, barrel, normalized]).some(f =>
      f.ruleId === "17" && f.symbol.includes("shared/lexical-tables.ts#terms"))).toBe(true);
    const negative = { path: "server/accounts.ts",
      content: 'import { catalog } from "../shared/lexical-index"; function normalizeStatus(status: string) { for (const [term, value] of Object.entries(catalog)) { if (status === term) return value; } return status; }' };
    expect(findFoodStaticCandidates([source, barrel, negative]).filter(f =>
      f.symbol.startsWith("consumed-lexical-table:"))).toEqual([]);
  });

  it("AUD1300-F02 follows generic JSON through map/reduce aliases before food decisions", () => {
    const records = { path: "data/records.json",
      content: JSON.stringify([{ name: "pão", calories: 90 }, { name: "arroz", calories: 140 }]) };
    const throughMap = { path: "server/foodResolver.ts", content:
      'import rows from "../data/records.json"; function resolveFood(foodName: string) { const mapped = rows.map(row => row); return mapped.find(row => row.name === foodName); }' };
    const throughReduce = { path: "server/foodResolver.ts", content:
      'import rows from "../data/records.json"; function resolveFood(foodName: string) { return rows.reduce((found, row) => row.name === foodName ? row : found, null); }' };
    for (const consumer of [throughMap, throughReduce]) {
      const findings = findFoodStaticCandidates([records, consumer]);
      expect(findings.some(f => f.file === records.path && f.ruleId === "17"),
        consumer.content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    }
    const exercise = { path: "server/exerciseResolver.ts", content:
      'import rows from "../data/records.json"; function resolveExercise(activityName: string) { return rows.find(row => row.name === activityName); }' };
    expect(findFoodStaticCandidates([records, exercise]).filter(f =>
      f.file === records.path)).toEqual([]);
    expect(findFoodStaticCandidates([records]).filter(f => f.file === records.path)).toEqual([]);
  });

  it("AUD1300-F03 inspects imported build/dist sources but leaves inert generated files alone", () => {
    expect(isFoodArchitectureSourcePath("dist/foodRules.ts")).toBe(true);
    expect(isFoodArchitectureSourcePath("build/foodRules.ts")).toBe(true);
    expect(isFoodArchitectureSourcePath("node_modules/example/foodRules.ts")).toBe(false);
    const root = mkdtempSync(path.join(tmpdir(), "food-architecture-1300-"));
    try {
      mkdirSync(path.join(root, "server"), { recursive: true });
      mkdirSync(path.join(root, "dist"), { recursive: true });
      mkdirSync(path.join(root, "build"), { recursive: true });
      writeFileSync(path.join(root, "server/foodResolver.ts"),
        'import { foodAliases } from "../dist/foodRules"; export const getFoodAliases = () => foodAliases;');
      writeFileSync(path.join(root, "dist/foodRules.ts"),
        "export const foodAliases = ['pão', 'arroz'];");
      writeFileSync(path.join(root, "build/isolated.ts"),
        "export const foodAliases = ['café'];");
      const files = readFoodWorkingFiles(root);
      expect(files.some(f => f.path === "dist/foodRules.ts")).toBe(true);
      expect(files.some(f => f.path === "build/isolated.ts")).toBe(true);
      const findings = findFoodStaticCandidates(files);
      expect(findings.some(f => f.file === "dist/foodRules.ts" && f.ruleId === "17")).toBe(true);
      expect(findings.some(f => f.file === "build/isolated.ts")).toBe(false);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("R1300-01 preserves each unreviewed legacy candidate as review-required, not debt", () => {
    const source = { path: "server/foodNormalizer.ts",
      content: "const foodAliases = ['pão', 'arroz'];" };
    const findings = findFoodStaticCandidates([source]);
    expect(findings.length).toBeGreaterThan(0);
    const assessment = evaluateFoodArchitectureGate(findings, findings, [], today);
    expect(assessment.errors).toEqual([]);
    expect(assessment.legacyUncovered).toHaveLength(findings.length);
    expect(assessment.warnings.some(message =>
      message.includes("requires triage"))).toBe(true);
  });

  it("AUD1300-FS-PATH resolves Node fs CWD paths separately from module imports", () => {
    const rootCatalog = { path: "data/weights.json", content: '{"pao":50,"arroz":90}' };
    const moduleCatalog = { path: "server/data/weights.json", content: '{"pao":120,"arroz":180}' };
    const fromCwd = { path: "server/foodPortionService.ts", content:
      'import { readFileSync } from "node:fs"; const weights = JSON.parse(readFileSync("./data/weights.json", "utf8")); function resolveFoodPortion(foodName: string) { return weights[foodName]; }' };
    const findings = findFoodStaticCandidates([rootCatalog, moduleCatalog, fromCwd]);
    for (const id of ["17", "5"]) {
      expect(findings.some(f => f.file === rootCatalog.path && f.ruleId === id), id).toBe(true);
      expect(findings.some(f => f.file === moduleCatalog.path && f.ruleId === id), id).toBe(false);
    }
    expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length).toBeGreaterThan(0);

    for (const specifier of [
      'path.join(__dirname, "data", "weights.json")',
      'new URL("./data/weights.json", import.meta.url)',
    ]) {
      const moduleReader = { ...fromCwd, content:
        'import { readFileSync } from "node:fs"; const weights = JSON.parse(readFileSync(' +
        specifier + ', "utf8")); function resolveFoodPortion(foodName: string) { return weights[foodName]; }' };
      const scoped = findFoodStaticCandidates([rootCatalog, moduleCatalog, moduleReader]);
      expect(scoped.some(f => f.file === moduleCatalog.path && f.ruleId === "17"), specifier).toBe(true);
      expect(scoped.some(f => f.file === rootCatalog.path && f.ruleId === "17"), specifier).toBe(false);
    }
    const unrelated = { path: "server/accounts.ts", content:
      'import { readFileSync } from "node:fs"; const weights = JSON.parse(readFileSync("./data/weights.json", "utf8")); function checkStatus(status: string) { return weights[status]; }' };
    const negative = findFoodStaticCandidates([rootCatalog, unrelated]);
    expect(negative.filter(f => f.file === rootCatalog.path)).toEqual([]);
  });

  it("AUD1300-REGEX-ALIAS follows immutable regex chains without shadowing or mutable false positives", () => {
    const candidates = [
      'const original = /pão|arroz/i; const regra = original; function resolveFood(foodName: string) { return regra.test(foodName); }',
      'const original = new RegExp("pão|arroz", "i"); const one = original; const two = one; function resolveFood(foodName: string) { return foodName.match(two); }',
      'function decideMateriality(attribute: string) { const original = /integral|light/; const copy = original; return copy.exec(attribute); }',
    ];
    for (const content of candidates) {
      const findings = findFoodStaticCandidates([{ path: "server/foodResolver.ts", content }]);
      expect(findings.some(f => ["17", "18"].includes(f.ruleId) && f.symbol.includes("lexical-regex")), content).toBe(true);
      expect(evaluateFoodArchitectureGate(findings, [], [], today).errors.length, content).toBeGreaterThan(0);
    }
    const negatives = [
      'let original = /pão|arroz/i; const regra = original; function resolveFood(foodName: string) { return regra.test(foodName); }',
      'const original = /pão|arroz/i; function resolveFood(foodName: string, original: RegExp) { return original.test(foodName); }',
      'const original = /pão|arroz/i; function resolveFood(foodName: string) { const original = createRegex(); return original.test(foodName); }',
      'const original = /pão|arroz/i; function resolveFood(foodName: string) { const regra = createRegex(); return regra.test(foodName); }',
      'const original = /active|pending/i; const regra = original; function checkStatus(status: string) { return regra.test(status); }',
    ];
    for (const content of negatives) {
      const findings = findFoodStaticCandidates([{ path: "server/foodResolver.ts", content }]);
      expect(findings.filter(f => f.symbol.includes("lexical-regex")), content).toEqual([]);
    }
  });

});
