/** Issue #1300: audit escapes F43-F45; semantic equivalence, not food-name allowlists. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Source = FoodArchitectureFile;
const src = (content: string, path = "server/foodRules.ts"): Source => ({ path, content });
const assertDecision = (sources: Source[], expected: boolean, ruleIds: string[]): void => {
  const findings = findFoodStaticCandidates(sources);
  const rejected = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T00:00:00Z"))
    .errors.some(error => error.startsWith("New food architecture violation"));
  const matched = findings.some(f => ruleIds.includes(f.ruleId));
  expect(matched, JSON.stringify(findings)).toBe(expected);
  expect(rejected, JSON.stringify(findings)).toBe(expected);
};

const localMap = "const table = {pitaya:91,cupuacu:93};";
const importedMap = src("export const table = {pitaya:91,cupuacu:93};", "server/foodValues.ts");

describe("AUD1300-20261018-F43 numeric-map key/entry projections", () => {
  for (const [label, expression] of [
    ["entries.find", 'Object.entries(table).find(([key]) => key === foodName)?.[1]'],
    ["entries.filter", 'Object.entries(table).filter(([key]) => key === foodName)[0]?.[1]'],
    ["entries.some", 'Object.entries(table).some(([key]) => key === foodName)'],
    ["keys.find", 'Object.keys(table).find(key => key === foodName)'],
    ["keys.every", 'Object.keys(table).every(key => key !== foodName)'],
    ["keys.some", 'Object.keys(table).some(key => key === foodName)'],
    ["keys.includes", 'Object.keys(table).includes(foodName)'],
    ["entries.map(key).includes", 'Object.entries(table).map(([key]) => key).includes(foodName)'],
    ["entries.map(key).find", 'Object.entries(table).map(([key]) => key).find(key => key === foodName)'],
    ["keys.map(identity).some", 'Object.keys(table).map(key => key).some(key => key === foodName)'],
    ["keys Array.from", 'Array.from(Object.keys(table)).some(key => key === foodName)'],
    ["keys spread", '[...Object.keys(table)].some(key => key === foodName)'],
    ["keys.indexOf", 'Object.keys(table).indexOf(foodName) >= 0'],
    ["keys.slice().some", 'Object.keys(table).slice().some(key => key === foodName)'],
    ["entries.toReversed().find", 'Object.entries(table).toReversed().find(([key]) => key === foodName)'],
  ] as const) {
    it(`rejects ${label} locally`, () => {
      assertDecision([src(`${localMap} export function estimateFood(foodName:string) {
        return ${expression}; }`)], true, ["17", "5"]);
    });
    it(`rejects ${label} across runtime imports`, () => {
      assertDecision([importedMap, src(`import {table} from "./foodValues";
        export function estimateFood(foodName:string) {return ${expression};}`)], true, ["17", "5"]);
    });
  }
  it("recognizes a generic input parameter in a proven food resolver", () => {
    assertDecision([src(`${localMap} export function lookupFood(input:string) {
      return Object.entries(table).find(([key]) => key === input)?.[1]; }`)], true, ["17", "5"]);
  });
  it("follows an immutable local projection alias", () => {
    assertDecision([src(`${localMap} export function estimateFood(foodName:string) {
      const projected = Object.keys(table);
      return projected.some(key => key === foodName); }`)], true, ["17", "5"]);
  });
  it("does not preserve identity through an unrelated map callback", () => {
    assertDecision([src(`${localMap} export function estimateFood(foodName:string) {
      return Object.entries(table).map(([key]) => "result-" + key).includes(foodName); }`)], false, ["17", "5"]);
  });
  it("does not treat entries tuples as key strings", () => {
    assertDecision([src(`${localMap} export function estimateFood(foodName:string) {
      return Object.entries(table).includes(foodName); }`)], false, ["17", "5"]);
  });
  it("leaves enumeration without a decision inert", () => {
    assertDecision([src(`${localMap} export function estimateFood() {
      const projected = Object.entries(table); return queryDatabase(); }`)], false, ["17", "5"]);
  });
  it("leaves non-food administrative status maps out of scope", () => {
    assertDecision([src(`const table = {active:1,pending:2};
      export function lookupStatus(status:string) {
        return Object.entries(table).find(([key]) => key === status)?.[1];
      }`, "server/admin/status.ts")], false, ["17", "5"]);
  });
  it("does not trust shadowed Object as the intrinsic", () => {
    assertDecision([src(`${localMap} export function estimateFood(foodName:string, Object: {keys:(v:unknown)=>string[]}) {
      return Object.keys(table).some(key => key === foodName); }`)], false, ["17", "5"]);
  });
  it("does not attribute imported constants to shadowed parameters", () => {
    assertDecision([importedMap, src(`import {table} from "./foodValues";
      export function estimateFood(foodName:string, table:Record<string,number>) {
        return Object.keys(table).some(key => key === foodName); }`)], false, ["17", "5"]);
  });
});

describe("AUD1300-20261018-F44 literal methods in food identity and materiality", () => {
  for (const [label, expression] of [
    ["indexOf >= zero", 'foodName.indexOf("pitaya") >= 0'],
    ["indexOf != -one", 'foodName.indexOf("pitaya") !== -1'],
    ["localeCompare equal zero", 'foodName.localeCompare("pitaya") === 0'],
    ["localeCompare inequality", 'foodName.localeCompare("pitaya") !== 0'],
    ["localeCompare after normalization", 'foodName.trim().localeCompare("pitaya") === 0'],
  ] as const) {
    it(`rejects food identity ${label}`, () => {
      assertDecision([src(`export function decideFood(foodName:string) {return ${expression};}`)], true, ["17"]);
    });
  }
  it("rejects materiality via localeCompare", () => {
    assertDecision([src(`export function decideMateriality(qualifier:string) {
      return qualifier.localeCompare("light") === 0;
    }`)], true, ["18"]);
  });
  it("does not classify administrative localeCompare", () => {
    assertDecision([src(`export function decideStatus(status:string) {
      return status.localeCompare("active") === 0;
    }`, "server/admin/status.ts")], false, ["17", "18"]);
  });
  it("does not treat a non-decisional index as identity knowledge", () => {
    assertDecision([src(`export function renderFoodDebug(foodName:string) {
      const position = foodName.indexOf("pitaya"); return renderDebug(position);
    }`)], false, ["17"]);
  });
});

describe("AUD1300-20261018-F45 regexp constructor immutable aliases", () => {
  for (const [label, source] of [
    ["module const", 'const term="pitaya"; export function decideFood(foodName:string) {return new RegExp(term).test(foodName)}'],
    ["function const", 'export function decideFood(foodName:string) {const term="pitaya"; return new RegExp(term).test(foodName)}'],
    ["chained const", 'const term="pitaya"; const regexTerm=term; export function decideFood(foodName:string) {return new RegExp(regexTerm).test(foodName)}'],
  ] as const) {
    it(`rejects ${label}`, () => assertDecision([src(source)], true, ["17", "18"]));
  }
  for (const [label, source] of [
    ["shadowed parameter", 'const term="pitaya"; export function checkValue(foodName:string,term:string) {return new RegExp(term).test(foodName)}'],
    ["mutable binding", 'let term="pitaya"; export function checkValue(foodName:string) {return new RegExp(term).test(foodName)}'],
    ["administrative value", 'const term="active"; export function decideStatus(status:string) {return new RegExp(term).test(status)}'],
  ] as const) {
    it(`accepts non-proven ${label}`, () => assertDecision([src(source,
      label === "administrative value" ? "server/admin/status.ts" : "server/foodRules.ts")], false, ["17", "18"]));
  }
});
