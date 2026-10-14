import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { normalizeWhatsappInformalLanguage } from "../server/modules/whatsapp/informalLanguageNormalizer";
import { normalizeText } from "../server/mealTextParsing";
import { findFoodStaticCandidates, isProductionFoodSource, findCompetingOwnerInventory, groupCompetingFoodOwners } from "./food-intelligence-architecture";
import { assessFoodDebt, assessFoodDebtRenewal, assessReviewedFoodDebt } from "./food-architecture-debt";
import { compareFoodArchitectureFindings, isFoodArchitectureSourcePath } from "./food-architecture-baseline";
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
    for (const canonical of ["server/foodItemResolution.ts",
      "server/modules/foodIntelligenceV3/foodResolver.ts"]) {
      expect(findFoodStaticCandidates([{ path: canonical,
        content: "export function resolveFood(input: string) { return input; }" }]
      ).filter(f => f.ruleId === "1" || f.ruleId === "2")).toEqual([]);
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
      "import { readFileSync } from 'node:fs'; const rows = JSON.parse(readFileSync('./fixtures/foodPortions.json', 'utf8'));",
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
      "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'node:fs'; function resolvePortion(foodName: string) { const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); const sizes = weights; return sizes[foodName]; }",
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
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); function role(user: string) { return weights[user]; }" },
      { path: "server/exerciseService.ts", content:
        "import fs from 'node:fs'; const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); function exercise(foodName: string) { return weights[foodName]; }" },
      { path: foodPath, content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); function status(value: string) { return weights[value]; }" },
      { path: foodPath, content:
        "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); const unused = weights;" },
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
      "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const { readFileSync: load } = require('node:fs'); const weights = JSON.parse(load('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fileSystem = require('node:fs'); const weights = JSON.parse(fileSystem.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'node:fs'; const weights = JSON.parse(fs['readFileSync']('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import * as io from 'fs'; const weights = JSON.parse(io.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import { readFileSync as load } from 'node:fs'; const readAlias = load; const weights = JSON.parse(readAlias('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
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
      "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load('./fixtures/weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }" }])
      .some(f => f.file === fixture.path && f.ruleId === "17" && f.symbol === "json-food-catalog")).toBe(true);
    const negatives = [
      { path: "server/account.ts", content:
        "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load('./weights.json', 'utf8')); function role(user: string) { return weights[user]; }" },
      { path: "server/exerciseService.ts", content:
        "const fileSystem = require('fs'); const weights = JSON.parse(fileSystem.readFileSync('./weights.json', 'utf8')); function exercise(foodName: string) { return weights[foodName]; }" },
      { path: foodPath, content:
        "import * as io from 'fs'; const weights = JSON.parse(io.readFileSync('./weights.json', 'utf8')); function status(value: string) { return weights[value]; }" },
      { path: foodPath, content:
        "import { readFileSync as load } from 'node:fs'; const weights = JSON.parse(load('./weights.json', 'utf8')); const unused = weights;" },
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
      "const weights = JSON.parse(require('node:fs').readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('node:fs').readFileSync; const weights = JSON.parse(load('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('fs')['readFileSync']('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('fs')['readFileSync']; const weights = JSON.parse(load('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
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
      "const weights = JSON.parse(require('not-fs').readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require(moduleName).readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('node:fs/promises').readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('node:fs').readFileSync('./weights.json', 'utf8')); function role(user: string) { return weights[user]; }",
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
      "import { readFileSync } from 'node:fs'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs = require('node:fs'); const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const weights = JSON.parse(require('fs').readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const load = require('fs').readFileSync; const weights = JSON.parse(load('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of positive) {
      const findings = findFoodStaticCandidates([source, { path, content }]);
      expect(findings.some(f => f.ruleId === "17" && f.symbol === "json-food-catalog"),
        content).toBe(true);
      expect(findings.some(f => f.ruleId === "5" && f.symbol.includes("imported-numeric-food-map")),
        content).toBe(true);
    }
    const negative = [
      "const readFileSync = (_path: string) => '{\"arroz\":90}'; const weights = JSON.parse(readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fs = { readFileSync: (_path: string) => '{\"arroz\":90}' }; const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "import fs from 'fake-fs'; const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
      "const fs = require('my-fs-wrapper'); const weights = JSON.parse(fs.readFileSync('./weights.json', 'utf8')); function resolvePortion(foodName: string) { return weights[foodName]; }",
    ];
    for (const content of negative) {
      const findings = findFoodStaticCandidates([source, { path, content }]);
      expect(findings.filter(f => f.symbol === "json-food-catalog" ||
        f.symbol.includes("imported-numeric-food-map")), content).toEqual([]);
    }
  });

});
