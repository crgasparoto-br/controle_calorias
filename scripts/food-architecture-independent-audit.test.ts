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

describe("AUD1300 cross-path provenance and lexical controls", () => {
  const catalog = { path: "server/data/records.json", content: JSON.stringify([
    { name: "pão", calories: 90 }, { name: "arroz", calories: 130 },
  ]) };
  const jsonDecision = (source: string) => assess([
    catalog, { path: "server/foodService.ts", content: source },
  ]);
  const mustRejectJson = (source: string) => {
    const result = jsonDecision(source);
    expect(result.findings.some(f => f.file === catalog.path && (f.ruleId === "17" || f.ruleId === "5"))).toBe(true);
    expect(result.verdict.errors.length).toBeGreaterThan(0);
  };
  const mustIgnoreJson = (source: string) => {
    const result = jsonDecision(source);
    expect(result.findings.some(f => f.file === catalog.path && (f.ruleId === "17" || f.ruleId === "5"))).toBe(false);
  };

  it("blocks JSON identity projected through map then includes", () => {
    mustRejectJson('import rows from "./data/records.json"; function selectFood(input: string) { return rows.map(row => row.name).includes(input); }');
  });
  it("blocks JSON identity projected through map then some", () => {
    mustRejectJson('import rows from "./data/records.json"; function selectFood(input: string) { return rows.map(row => row.name).some(name => name === input); }');
  });
  it("blocks reconstructed food records through const aliases", () => {
    mustRejectJson('import rows from "./data/records.json"; function selectFood(input: string) { return rows.map(row => { const key = row.name; return {name: key, calories: row.calories}; }).find(row => row.name === input); }');
  });
  it("blocks JSON records after an optional rebind", () => {
    mustRejectJson('import rows from "./data/records.json"; function selectFood(input: string, flag: boolean) { let visible = rows; if (flag) visible = getDatabaseRows(); return visible.find(row => row.name === input); }');
  });
  it("does not attribute JSON when exhaustive branches overwrite its origin", () => {
    mustIgnoreJson('import rows from "./data/records.json"; function selectFood(input: string, flag: boolean) { let visible = rows; if (flag) { visible = getDatabaseRowsA(); } else { visible = getDatabaseRowsB(); } return visible.find(row => row.name === input); }');
  });
  it("does not attribute imported JSON when it is not consumed", () => {
    mustIgnoreJson('import rows from "./data/records.json"; function selectFood(input: string) { return getDatabaseRows().find(row => row.name === input); }');
  });
  it("does not confuse shadowed fs with a genuine Node reader", () => {
    mustIgnoreJson('import fs from "node:fs"; function selectFood(input: string) { const fs = { readFileSync: (_p: string, _e: string) => "[]" }; const rows = JSON.parse(fs.readFileSync("./server/data/records.json", "utf8")); return rows.find(row => row.name === input); }');
  });
  it("does detect genuine Node filesystem reading of food JSON", () => {
    mustRejectJson('import fs from "node:fs"; function selectFood(input: string) { const rows = JSON.parse(fs.readFileSync("./server/data/records.json", "utf8")); return rows.find(row => row.name === input); }');
  });
  it("does not exempt food-specific regex by administrative directory", () => {
    const result = assess([{ path: "server/account/foodNormalization.ts", content:
      'function normalizeFood(input: string) { if (/pão|arroz/i.test(input)) return "pão"; return input; }' }]);
    expect(result.findings.some(f => f.ruleId === "17" || f.ruleId === "18")).toBe(true);
    expect(result.verdict.errors.length).toBeGreaterThan(0);
  });
});

describe("AUD1300-20261017 independent audit remediations", () => {
  const cases = [
    { id: "F33 unknown meal choices", path: "server/mealSuggestion.ts",
      code: 'function suggestMealForUser(meal:string){ const optionsByContext={breakfast:["pitaya", "cupuaçu"]}; return optionsByContext[meal] ?? []; }',
      expected: ["17"] },
    { id: "F33 unknown brands", path: "server/mealSuggestion.ts",
      code: 'function recommendMeal(meal:string){ const choices={dinner:["Açaí Puro", "Graviola Natural"]}; return choices[meal] ?? []; }',
      expected: ["17"] },
    { id: "F33 unrelated admin status", path: "server/admin/status.ts",
      code: 'function suggestUserAction(action:string){ const optionsByContext={general:["Abrir conta", "Salvar fatura"]}; return optionsByContext[action] ?? []; }',
      expected: [] },
    { id: "F33 UI labels", path: "client/src/components/MealTabs.tsx",
      code: 'const optionsByContext={breakfast:["Abrir", "Fechar"]}; export function MealTabs(){return <nav>{optionsByContext.breakfast.map(x=><span>{x}</span>)}</nav>}',
      expected: [] },
    { id: "F34 spread map", path: "server/foodRules.ts",
      code: 'const base={pitaya:43,cupuacu:80}; const values={...base}; function getFoodCalories(foodName:string){return values[foodName]??0}',
      expected: ["17", "5"] },
    { id: "F34 nested alias spread", path: "server/foodRules.ts",
      code: 'const base={pitaya:43,cupuacu:80}; const alias=base; const values={...alias}; function getFoodCalories(foodName:string){return values[foodName]??0}',
      expected: ["17", "5"] },
    { id: "F34 inline spread map", path: "server/foodRules.ts",
      code: 'const base={pitaya:43}; function getFoodCalories(foodName:string){return ({...base})[foodName]??0}',
      expected: ["17", "5"] },
    { id: "F34 mutable source is not proved immutable", path: "server/foodRules.ts",
      code: 'let base={pitaya:43}; base=getFoodFromDB(); const values={...base}; function getFoodCalories(foodName:string){return values[foodName]??0}',
      expected: [] },
    { id: "F34 parameter shadowing", path: "server/foodRules.ts",
      code: 'const base={pitaya:43}; function getFoodCalories(foodName:string, base: Record<string,number>){const values={...base}; return values[foodName]??0}',
      expected: [] },
    { id: "F34 nonfood account", path: "server/account/fees.ts",
      code: 'const base={basic:43,premium:80}; const values={...base}; function getAccountFees(plan:string){return values[plan]??0}',
      expected: [] },
    { id: "F35 regex replace", path: "server/foodNormalization.ts",
      code: 'function normalizeFood(input:string){return input.replace(/pão|arroz/gi, "alimento");}',
      expected: ["17", "18"] },
    { id: "F35 replaceAll constructor", path: "server/foodNormalization.ts",
      code: 'const words=new RegExp("pão|arroz", "gi"); function normalizeFood(input:string){return input.replaceAll(words, "alimento");}',
      expected: ["17", "18"] },
    { id: "F35 lexical string replacement", path: "server/foodNormalization.ts",
      code: 'function normalizeFood(input:string){return input.replace("pitaya", "fruta");}',
      expected: ["17", "18"] },
    { id: "F35 nonfood administrative regex", path: "server/account/status.ts",
      code: 'function normalizeAccountStatus(input:string){return input.replace(/pending|paid/gi, "status");}',
      expected: [] },
  ];
  it.each(cases)("$id", ({ code, path, expected }) => {
    const findings = findFoodStaticCandidates([{ path, content: code }]);
    const actual = [...new Set(findings.map(f => f.ruleId))].sort();
    expect(actual).toEqual([...expected].sort());
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-17T12:00:00Z")).errors.length > 0)
      .toBe(expected.length > 0);
  });
});

describe("AUD1300-F33 UI menu controls remain presentation-only", () => {
  it("does not block UI actions even in food suggestion contexts", () => {
    for (const code of [
      'export function suggestMeal(meal:string){const optionsByContext={lunch:["Editar item","Excluir item"]};return optionsByContext[meal]??[]}',
      'const optionsByContext={breakfast:["Editar","Excluir"],lunch:["Abrir","Fechar"]};',
    ]) {
      const path = code.startsWith("export") ? "server/foodAssistant.ts" : "client/src/features/mealDashboard.tsx";
      const findings = findFoodStaticCandidates([{ path, content: code }]);
      expect(findings.filter(f => f.symbol.includes("meal-choice-catalog"))).toEqual([]);
    }
  });
});
