/** Issue #1300: semantic-mutation saturation, generated from domain invariants.
 * These are in-memory mutants, never committed to runtime/baseline files.
 * Each variant must be rejected by BOTH the candidate detector and gate.
 */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const now = new Date("2026-10-17T12:00:00Z");
const catalog: FoodArchitectureFile = {
  path: "server/data/records.json",
  content: JSON.stringify([{ name: "pão", calories: 90 }, { name: "arroz", calories: 130 }]),
};
function audit(files: FoodArchitectureFile[]) {
  const findings = findFoodStaticCandidates(files);
  const verdict = evaluateFoodArchitectureGate(findings, [], [], now);
  return { findings, verdict };
}
function jsonUse(expression: string, consumer: string, prefix = "") {
  return audit([catalog, {
    path: "server/foodService.ts",
    content: 'import rows from "./data/records.json";' +
      'function selectFood(input: string) {' + prefix +
      'return (' + expression + ').' + consumer + ';}',
  }]);
}
function mustBlockJson(expression: string, consumer: string) {
  const result = jsonUse(expression, consumer);
  expect(result.findings.some(f => f.file === catalog.path && f.ruleId === "17")).toBe(true);
  expect(result.findings.some(f => f.file === catalog.path && f.ruleId === "5")).toBe(true);
  expect(result.verdict.errors.some(error =>
    error.startsWith("New food architecture violation"))).toBe(true);
}
const transforms = [
  ["direct", "rows"],
  ["slice", "rows.slice()"],
  ["toSorted", "rows.toSorted()"],
  ["toReversed", "rows.toReversed()"],
  ["toSpliced", "rows.toSpliced(0,0)"],
  ["concat left", "rows.concat([])"],
  ["concat right", "[].concat(rows)"],
  ["Array.from", "Array.from(rows)"],
  ["spread", "[...rows]"],
  ["sort", "rows.sort()"],
  ["reverse", "rows.reverse()"],
  ["copyWithin", "rows.copyWithin(0,0)"],
  ["filter preserving record", "rows.filter(row => row.calories > 0)"],
  ["map preserving record", "rows.map(row => row)"],
] as const;
const consumers = [
  ["find", "find(row => row.name === input)"],
  ["some", "some(row => row.name === input)"],
  ["filter", "filter(row => row.name === input)"],
] as const;

describe("AUD1300 F41: JSON provenance metamorphic matrix", () => {
  for (const [transformation, expression] of transforms) {
    for (const [consumption, consumer] of consumers) {
      it("blocks the same catalog after " + transformation + " / " + consumption, () => {
        mustBlockJson(expression, consumer);
      });
    }
  }
  it("records the full transformation x consumer matrix, not a fixed pair of examples", () => {
    expect(transforms.length).toBeGreaterThanOrEqual(12);
    expect(consumers.length).toBe(3);
    expect(transforms.length * consumers.length).toBeGreaterThanOrEqual(36);
  });
  for (const [transformation, expression] of transforms) {
    it("does not block unused catalog after " + transformation, () => {
      const result = jsonUse(expression, "find(row => row.name === input)",
        "const unused = " + expression + "; ");
      // A live selection above is intentionally present, so this probe only
      // validates that a separate unused transformation does not add findings.
      const isolated = audit([catalog, {
        path: "server/foodService.ts",
        content: 'import rows from "./data/records.json"; function selectFood(input: string) {' +
          "const unused = " + expression + "; return queryDatabase().find(row => row.name === input);}",
      }]);
      expect(isolated.findings.some(f => f.file === catalog.path)).toBe(false);
      expect(result.verdict.errors.length).toBeGreaterThan(0);
    });
  }
  it("does not mistake a shadowed Array.from for the intrinsic", () => {
    const result = jsonUse("Array.from(rows)", "find(row => row.name === input)",
      'const Array = { from: (_rows: unknown) => queryDatabase() }; ');
    expect(result.findings.some(f => f.file === catalog.path)).toBe(false);
  });
});

describe("AUD1300 F42: immutable lexical aliases and decision scope", () => {
  const cases: ReadonlyArray<{ name: string; content: string; shouldBlock: boolean; file?: string }> = [
    { name: "literal baseline", shouldBlock: true,
      content: 'function isFood(foodName:string){return foodName === "pão"}' },
    { name: "local const alias", shouldBlock: true,
      content: 'function isFood(foodName:string){const key="pão";return foodName === key}' },
    { name: "module const alias", shouldBlock: true,
      content: 'const key="pão";function isFood(foodName:string){return foodName === key}' },
    { name: "const alias chain", shouldBlock: true,
      content: 'const key="pão";const foodKey=key;function isFood(foodName:string){return foodName === foodKey}' },
    { name: "conditional boolean decision", shouldBlock: true,
      content: 'function isFood(foodName:string){const key="pão";if(foodName===key){return true}return false}' },
    { name: "non-food account", shouldBlock: false, file: "server/account/check.ts",
      content: 'function isAdmin(accountName:string){const key="admin";return accountName===key}' },
    { name: "mutable alias abandoned", shouldBlock: false,
      content: 'function isFood(foodName:string){let key="pão";key=foodName;return foodName===key}' },
    { name: "shadowed parameter", shouldBlock: false,
      content: 'const key="pão";function isFood(foodName:string,key:string){return foodName===key}' },
  ];
  for (const candidate of cases) {
    it(candidate.name + " => " + (candidate.shouldBlock ? "block" : "allow"), () => {
      const file = candidate.file ?? "server/foodRules.ts";
      const result = audit([{ path: file, content: candidate.content }]);
      const matched = result.findings.some(f => f.file === file && f.ruleId === "17" &&
        f.symbol.includes("lexical-branch"));
      expect(matched).toBe(candidate.shouldBlock);
      expect(result.verdict.errors.some(e => e.startsWith("New food architecture violation")))
        .toBe(candidate.shouldBlock);
    });
  }
});
