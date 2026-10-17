/** AUD1300-20261017-F37/F38/F39: negative controls must preserve precise
 * provenance of a meal menu, not grant an exemption based on verb or length. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const table = 'const optionsByContext = { breakfast: ["pitaya", "cupuaçu"] };';
const file = "server/mealService.ts";
const at = (source: string, location = file): FoodArchitectureFile => ({ path: location, content: source });
const mealFindings = (sources: FoodArchitectureFile[]) =>
  findFoodStaticCandidates(sources).filter(f =>
    f.ruleId === "17" && f.symbol.endsWith(":meal-choice-catalog"));
const assertGate = (sources: FoodArchitectureFile[], expected: boolean, origin = file): void => {
  const findings = mealFindings(sources);
  expect(findings.filter(f => f.file === origin).length > 0).toBe(expected);
  if (expected) {
    const report = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-17T14:00:00Z"));
    expect(report.errors.length).toBeGreaterThan(0);
  }
};

describe("AUD1300-F37: productive meal catalog consumption", () => {
  const positive = [
    ["dot property", "optionsByContext.breakfast"],
    ["string key", 'optionsByContext["breakfast"]'],
    ["computed key", "optionsByContext[meal]"],
    ["optional property", "optionsByContext?.breakfast"],
    ["Object.values flat", "Object.values(optionsByContext).flat()"],
    ["Object.values slice", "Object.values(optionsByContext).slice(0)"],
    ["Object bracket values", 'Object["values"](optionsByContext).flat()'],
    ["spread literal meal options", "[...optionsByContext.breakfast]"],
    ["conditional", "flag ? optionsByContext.breakfast : []"],
    ["fallback", "optionsByContext.breakfast ?? []"],
    ["opaque-named variable alias", "pick"],
  ] as const;
  for (const [name, access] of positive) {
    it(`blocks ${name}`, () => {
      assertGate([at(`${table}\nexport function recommendMeal(meal: string, flag = true) {
        const pick = optionsByContext; return ${access}; }`)], true);
    });
  }
  it("blocks direct destructuring and renamed property", () => {
    assertGate([at(`${table} export function recommendMeal() {
      const { breakfast: selected } = optionsByContext; return selected; }`)], true);
    assertGate([at(`${table} export function recommendMeal() {
      const { breakfast } = optionsByContext; return breakfast; }`)], true);
  });
  it("blocks array destructuring of genuine Object.values", () => {
    assertGate([at(`${table} export function recommendMeal() {
      const [first] = Object.values(optionsByContext); return first; }`)], true);
  });
  it("attributes an imported and re-exported catalog to its original declaration", () => {
    assertGate([
      at(`export ${table}`, "server/menuData.ts"),
      at('export { optionsByContext as menu } from "./menuData";', "server/barrel.ts"),
      at(`import * as choices from "./barrel";
        export function recommendMeal() { return choices.menu.breakfast; }`),
    ], true, "server/menuData.ts");
  });
  it("does not confuse a shadowed Object with native Object.values", () => {
    assertGate([at(`${table} export function recommendMeal(Object: {values: (x: unknown) => string[]}) {
      return Object.values(optionsByContext).flat(); }`)], false);
    assertGate([at(`${table} const Object = { values: (_: unknown) => ["unrelated"] };
      export function recommendMeal() { return Object.values(optionsByContext); }`)], false);
  });
  it("does not follow keys or opaque transformations", () => {
    assertGate([at(`${table} export function recommendMeal() {
      return Object.keys(optionsByContext); }`)], false);
    assertGate([at(`${table} export function recommendMeal() {
      return buildFromDatabase(optionsByContext); }`)], false);
  });
  it("does not treat declarations or inert references as decisions", () => {
    assertGate([at(`${table} export function recommendMeal() { return loadFoodFromDatabase(); }`)], false);
    assertGate([at(`${table} function unusedHelper() { return optionsByContext.breakfast; }
      export function recommendMeal() { return loadFoodFromDatabase(); }`)], false);
  });
  it("does not follow shadowed bindings", () => {
    assertGate([at(`${table} export function recommendMeal(optionsByContext: Record<string, string[]>) {
      return optionsByContext.breakfast; }`)], false);
  });
});

describe("AUD1300-F38: consumer evidence rather than verb allowlists", () => {
  for (const name of ["buildRecommendationsForFood", "chooseMeal", "createNutritionAdvice", "planMeal", "pick"]) {
    it(`blocks exported ${name} consuming menu`, () => {
      assertGate([at(`${table} export function ${name}(meal: string) {
        return optionsByContext[meal]; }`)], true);
    });
  }
  it("blocks a food entry point through a generically named helper", () => {
    assertGate([at(`${table} const lookup = (key: string) => optionsByContext[key];
      export function prepareMealResponse(key: string) { return lookup(key); }`)], true);
  });
  it("blocks an exported server consumer without a food-specific name or path", () => {
    assertGate([at(`${table} export function pick(key: string) { return optionsByContext[key]; }`,
      "server/generic.ts")], true, "server/generic.ts");
  });
  it("does not block a general administrative status catalog", () => {
    assertGate([at(`const optionsByContext = { general: ["Ativo", "Pendente"] };
      export function suggestAccountStatus(key: string) { return optionsByContext[key]; }`,
      "server/account/status.ts")], false, "server/account/status.ts");
  });
  it("does not include a type-only imported catalog or unused helper", () => {
    assertGate([
      at(`export ${table}`, "server/menuData.ts"),
      at(`import type { optionsByContext } from "./menuData";
        export function buildFoodAdvice() { return []; }`),
    ], false, "server/menuData.ts");
  });
  it("excludes isolated fixtures and nonproductive exercises", () => {
    assertGate([at(`${table} export function recommendMeal(key: string) {return optionsByContext[key]; }`,
      "server/__fixtures__/menu.ts")], false, "server/__fixtures__/menu.ts");
    assertGate([at(`const optionsByContext = { general: ["Corrida", "Bicicleta"] };
      export function recommendExercise(key: string) { return optionsByContext[key]; }`,
      "server/exercise/status.ts")], false, "server/exercise/status.ts");
  });
});

describe("AUD1300-F39: catalogue cardinality", () => {
  it("blocks a productive single option without using a food-name dictionary", () => {
    assertGate([at(`const optionsByContext = { breakfast: ["pitaya"] };
      export function recommendMeal(key: string) { return optionsByContext[key]; }`)], true);
  });
  it("blocks two and multiple options equally", () => {
    for (const options of ['"pitaya", "cupuaçu"', '"pitaya", "cupuaçu", "kiwi"']) {
      assertGate([at(`const optionsByContext = { breakfast: [${options}] };
        export function recommendMeal(key: string) { return optionsByContext[key]; }`)], true);
    }
  });
  it("does not block empty arrays as food knowledge", () => {
    assertGate([at(`const optionsByContext = { breakfast: [] };
      export function recommendMeal(key: string) { return optionsByContext[key]; }`)], false);
  });
  it("does not block a single UI action as food knowledge", () => {
    assertGate([at(`const optionsByContext = { breakfast: ["Editar item"] };
      export function recommendMeal(key: string) { return optionsByContext[key]; }`)], false);
  });
  it("does not block a single admin general status", () => {
    assertGate([at(`const optionsByContext = { general: ["Ativo"] };
      export function status(key: string) { return optionsByContext[key]; }`,
      "server/account/status.ts")], false, "server/account/status.ts");
  });
  it("does not classify runtime-fetched choice data as a static literal", () => {
    assertGate([at(`const optionsByContext = loadGovernedFoodData();
      export function recommendMeal(key: string) { return optionsByContext[key]; }`)], false);
  });
});
