import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "../../../scripts/food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "../../../scripts/food-architecture-enforcement";

/** Source-behavior controls: structural bounds must not be confused with
 * knowledge indexed by actual food identities (ADR §25.2, Issue #1300).
 */
const examine = (content: string) => {
  const findings = findFoodStaticCandidates([{
    path: "server/modules/foodIntelligenceV2/contracts.ts",
    content,
  }]);
  return {
    relevant: findings.filter(f => f.ruleId === "17" || f.ruleId === "5"),
    errors: evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z")).errors,
  };
};

describe("AUD1300 semantic food-map boundaries", () => {
  it("does not classify pure schema size limits as food-specific nutrition knowledge", () => {
    const result = examine(`export const FOOD_CONTRACT_LIMITS = {
      rawText: 20000, identifier: 200, shortText: 120, nameText: 300,
      collection: 200, qualifiers: 50, alternatives: 20, observations: 100
    } as const;`);
    expect(result.relevant).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("still rejects nutritional numeric maps keyed by food identity", () => {
    const result = examine("export const FOOD_NUTRITION_BY_NAME = {pao: 150, arroz: 125};");
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not let a contract-limits name hide a nutritional record", () => {
    const result = examine("export const FOOD_CONTRACT_LIMITS = {calories: 150, protein: 6, carbs: 15, fat: 5};");
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("still blocks a structural-looking object indexed by food name", () => {
    const result = examine(`
      export const FOOD_CONTRACT_LIMITS = {rawText: 20000, identifier: 100};
      export function lookupFood(foodName: string) {
        return FOOD_CONTRACT_LIMITS[foodName as keyof typeof FOOD_CONTRACT_LIMITS];
      }`);
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});


describe("AUD1300 isolated test-fixture reachability", () => {
  const fixture = {
    path: "server/modules/whatsapp/testFixtures/knownFood.ts",
    content: "export const FOOD_ALIASES = ['pão', 'arroz'];",
  };
  it("does not treat an isolated testFixtures module as productive knowledge", () => {
    expect(findFoodStaticCandidates([fixture])).toEqual([]);
  });

  it("does not count an import type as productive fixture reachability", () => {
    const findings = findFoodStaticCandidates([
      fixture, { path: "server/liveFoodHandler.ts",
        content: 'import type { FoodRow } from "./modules/whatsapp/testFixtures/knownFood";' },
    ]);
    expect(findings.filter(f => f.file === fixture.path)).toEqual([]);
  });

  it("blocks food data in testFixtures actually imported at runtime", () => {
    const findings = findFoodStaticCandidates([
      fixture, { path: "server/liveFoodHandler.ts",
        content: 'import { FOOD_ALIASES } from "./modules/whatsapp/testFixtures/knownFood"; export function listFoods(){return FOOD_ALIASES;}' },
    ]);
    expect(findings.some(f => f.file === fixture.path && f.ruleId === "17")).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z"))
      .errors.length).toBeGreaterThan(0);
  });
});


describe("AUD1304 canonical linguistic grammar architecture boundary", () => {
  const file = "server/modules/foodIntelligenceV2/linguisticComprehension.ts";
  const repositoryFile = "server/modules/foodIntelligenceV2/linguisticLexiconRepository.ts";
  const surfaceFile = "server/modules/foodIntelligenceV2/linguisticSurface.ts";

  it("accepts only the canonical syntactic S1/S2 owner, not competing lexical channel rules", () => {
    for (const path of [file, surfaceFile, repositoryFile]) {
      const content = readFileSync(path, "utf8");
      const findings = findFoodStaticCandidates([{ path, content }]);
      expect(findings).toEqual([]);
    }
  });

  it("does not whitelist food-name comparisons hidden behind structural contract fields", () => {
    const source = readFileSync(file, "utf8");
    // The new S2 unit-alias helper also inspects targetType. Attack both
    // occurrences independently; replacing the first occurrence and assuming
    // comprehendFoodLanguage made this control fail without exercising its owner.
    for (const [original, injected, operand, owner] of [
      ['request.modality !== "image"', 'request.modality !== "panco"', "request.modality", "comprehendFoodLanguage"],
      ['request.imageRegionRole !== "front_identity"', 'request.imageRegionRole !== "panco"', "request.imageRegionRole", "comprehendFoodLanguage"],
      ['const unit = item.targetType === "canonical_term"', 'const unit = item.targetType === "panco"', "item.targetType", "governedUnitAliases"],
      ['foodName: item.targetType === "canonical_term"', 'foodName: item.targetType === "panco"', "item.targetType", "comprehendFoodLanguage"],
    ] as const) {
      expect(source).toContain(original);
      const findings = findFoodStaticCandidates([{ path: file, content: source.replace(original, injected) }]);
      expect(findings.some(f => f.ruleId === "18" &&
        f.symbol === `${owner}:${operand}:lexical-branch`)).toBe(true);
    }
  });

  it("AUD1304 A-028 accepts only the governed S2 protected-token marker", () => {
    const source = readFileSync(file, "utf8");
    const original = 'entry.kind === "protected_token"';
    expect(source.split(original)).toHaveLength(2);
    // An ungoverned food-name literal, a different lexicon kind or a negated
    // guard must still be flagged under architecture rule 18.
    for (const mutation of [
      'entry.kind === "panco"',
      'entry.kind === "alias_surface"',
      'entry.kind !== "protected_token"',
    ]) {
      const findings = findFoodStaticCandidates([{
        path: file, content: source.replace(original, mutation),
      }]);
      expect(findings.some(finding => finding.ruleId === "18" &&
        finding.symbol === "comprehendFoodLanguage:entry.kind:lexical-branch")).toBe(true);
    }
    // Whitelisting the marker cannot hide a second lexical owner.
    const competing = findFoodStaticCandidates([{
      path: "server/modules/whatsapp/newFoodNormalizer.ts",
      content: 'export const FOOD_ALIASES = { "pão branco": "panco" };'
        + ' export function normalizeFoodName(name: string) {'
        + ' return FOOD_ALIASES[name as keyof typeof FOOD_ALIASES] ?? name; }',
    }]);
    expect(competing.some(finding => finding.ruleId === "11" ||
      finding.ruleId === "17")).toBe(true);
  });

  it("AUD1304 A-031 exempts only the two spoon-unit accent discriminants", () => {
    const source = readFileSync(surfaceFile, "utf8");
    // The two allowed branches are canonical spellings of grammar units,
    // not food identities or nutrition decisions.
    for (const literal of ['qualifier === "cha"', 'qualifier === "cafe"']) {
      expect(source.split(literal)).toHaveLength(2);
    }
    expect(findFoodStaticCandidates([{ path: surfaceFile, content: source }])).toEqual([]);

    for (const [original, mutation] of [
      ['qualifier === "cha"', 'qualifier === "panco"'],
      ['qualifier === "cafe"', 'qualifier === "arroz"'],
      ['qualifier === "cha"', 'qualifier !== "cha"'],
      ['qualifier === "cafe"', 'qualifier !== "cafe"'],
    ] as const) {
      const findings = findFoodStaticCandidates([{
        path: surfaceFile, content: source.replace(original, mutation),
      }]);
      expect(findings.some(finding => finding.ruleId === "18" &&
        finding.symbol === "readQuantity:qualifier:lexical-branch")).toBe(true);
    }

    // The same expression outside the registered quantity owner is forbidden.
    const competing = findFoodStaticCandidates([{
      path: "server/modules/whatsapp/rogueSpoonParser.ts",
      content: 'export function chooseFood(qualifier: string) { return qualifier === "cha"; }',
    }]);
    expect(competing.some(finding => finding.ruleId === "18")).toBe(true);
  });

  it("allows only the exact canonical numeric grammar, never nutrition disguised as numerals", () => {
    const source = readFileSync(surfaceFile, "utf8");
    for (const [needle, replacement, symbol] of [
      ["onze: 11", "onze: 120", "writtenNumbers:numeric-food-map"],
      ['"½": 0.5', '"½": 90', "vulgar:numeric-food-map"],
      ['"¾": 0.75', '"pao": 140', "vulgar:numeric-food-map"],
    ] as const) {
      expect(source).toContain(needle);
      const findings = findFoodStaticCandidates([{
        path: surfaceFile, content: source.replace(needle, replacement),
      }]);
      expect(findings.some(f => (f.ruleId === "5" || f.ruleId === "17") &&
        f.symbol === symbol)).toBe(true);
    }
  });

  it("does not allow the extracted surface owner to hide food-specific nutrition maps", () => {
    const source = readFileSync(surfaceFile, "utf8");
    const infected = source + '\nexport const FOOD_NUTRITION_BY_NAME = { arroz: 120, feijao: 80 };\n'
      + 'export function getFoodNutrition(name: string) {'
      + ' return FOOD_NUTRITION_BY_NAME[name as keyof typeof FOOD_NUTRITION_BY_NAME]; }';
    const findings = findFoodStaticCandidates([{ path: surfaceFile, content: infected }]);
    expect(findings.some(f => f.ruleId === "5" || f.ruleId === "17")).toBe(true);
  });

  it("still rejects a literal nutrition lookup added inside the canonical owner", () => {
    const extra = "export const FOOD_NUTRITION_BY_NAME = {pao: 150, arroz: 120};\n"
      + "export function resolveFoodCalories(foodName: string) {\n"
      + "  return FOOD_NUTRITION_BY_NAME[foodName as keyof typeof FOOD_NUTRITION_BY_NAME];\n}";
    const content = readFileSync(file, "utf8") + "\n" + extra;
    const findings = findFoodStaticCandidates([{ path: file, content }]);
    expect(findings.some(f => f.ruleId === "5" || f.ruleId === "17")).toBe(true);
  });

  it("still rejects an unapproved lexical normalizer added in another module", () => {
    const findings = findFoodStaticCandidates([{
      path: "server/modules/whatsapp/newFoodNormalizer.ts",
      content: 'export const FOOD_ALIASES = { "pão branco": "panco" };'
        + ' export function normalizeFoodName(name: string) {'
        + ' return FOOD_ALIASES[name as keyof typeof FOOD_ALIASES] ?? name; }',
    }]);
    expect(findings.some(f => f.ruleId === "11" || f.ruleId === "17")).toBe(true);
  });
});
