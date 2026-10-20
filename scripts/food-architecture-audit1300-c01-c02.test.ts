/**
 * Issue #1300 independent-audit C01/C02 replays and sibling controls.
 * The oracle is the ADR: a newly introduced productive food source must be
 * attributed to the SOURCE file and rejected, not to an unrelated consumer.
 */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = {
  id: string;
  origin: string;
  files: FoodArchitectureFile[];
  blocked: boolean;
  rules?: readonly string[];
};
const source = (path: string, content: string): FoodArchitectureFile => ({ path, content });
const foodJson = JSON.stringify([{ name: "arroz", calories: 130 }, { name: "pao", calories: 70 }]);
const rawJson = (path = "client/public/foods.json") => source(path, foodJson);
const src = (content: string, path = "client/src/services/catalog.ts") => source(path, content);
const tests: Probe[] = [
  {
    id: "C01-module-serialized-catalog-to-named-function", origin: "server/m.ts", blocked: true, rules: ["17", "5"],
    files: [source("server/m.ts", `const foods=JSON.parse('${foodJson}');function foodValue(foodName:string){return foods.find(r=>r.name===foodName)?.calories}`)],
  },
  {
    id: "C01-module-generic-binding-to-generic-helper", origin: "server/helpers.ts", blocked: true, rules: ["17", "5"],
    files: [source("server/helpers.ts", `const rows=JSON.parse('${foodJson}');function check(foodName:string){return rows.some(row=>row.name===foodName)}`)],
  },
  {
    id: "C01-sibling-functions-still-share-module-catalog", origin: "server/foodLookup.ts", blocked: true, rules: ["17", "5"],
    files: [source("server/foodLookup.ts", `const rows=JSON.parse('${foodJson}');function unrelated(){return 10};function match(foodName:string){return rows.find(r=>r.name===foodName)}`)],
  },
  {
    id: "C01-lexical-module-table", origin: "server/foodLookup.ts", blocked: true, rules: ["17"],
    files: [source("server/foodLookup.ts", "const words=JSON.parse('[\"arroz\",\"pao\"]');function match(foodName:string){return words.includes(foodName)}")],
  },
  {
    id: "C01-local-in-function-regression", origin: "server/m.ts", blocked: true, rules: ["17", "5"],
    files: [source("server/m.ts", `function foodValue(foodName:string){const foods=JSON.parse('${foodJson}');return foods.find(r=>r.name===foodName)?.calories}`)],
  },
  {
    id: "C01-unused-module-constant", origin: "server/m.ts", blocked: false,
    files: [source("server/m.ts", `const foods=JSON.parse('${foodJson}');function otherValue(x:string){return x.length}`)],
  },
  {
    id: "C01-shadowed-module-constant-by-local", origin: "server/m.ts", blocked: false,
    files: [source("server/m.ts", `const foods=JSON.parse('${foodJson}');function foodValue(foodName:string){const foods=runtimeRecords();return foods.find(r=>r.name===foodName)}`)],
  },
  {
    id: "C01-shadowed-module-constant-by-parameter", origin: "server/m.ts", blocked: false,
    files: [source("server/m.ts", `const foods=JSON.parse('${foodJson}');function foodValue(foods:any[],foodName:string){return foods.find(r=>r.name===foodName)}`)],
  },
  {
    id: "C01-exercise-has-foodName-but-not-food-decision", origin: "server/helpers.ts", blocked: false,
    files: [source("server/helpers.ts", `const weights=JSON.parse('${foodJson}');function exercise(foodName:string){return weights.find(r=>r.name===foodName)?.calories}`)],
  },
  {
    id: "C01-native-JSON-shadowed", origin: "server/foodLookup.ts", blocked: false,
    files: [source("server/foodLookup.ts", `const JSON={parse:(s:string)=>[] as unknown[]};const foods=JSON.parse('${foodJson}');function check(foodName:string){return foods.some((r:any)=>r.name===foodName)}`)],
  },
  {
    id: "C01-dynamic-json-not-a-new-hardcode", origin: "server/foodLookup.ts", blocked: false,
    files: [source("server/foodLookup.ts", "function check(foodName:string,payload:string){const rows=JSON.parse(payload);return rows.find((r:any)=>r.name===foodName)}")],
  },
  {
    id: "C02-Vite-public-JSON-await-response", origin: "client/public/foods.json", blocked: true, rules: ["17", "5"],
    files: [rawJson(), src("export async function check(foodName:string){const response=await fetch('/foods.json');const rows=await response.json();return rows.find(r=>r.name===foodName)?.calories}")],
  },
  {
    id: "C02-Vite-public-JSON-direct-response", origin: "client/public/foods.json", blocked: true, rules: ["17", "5"],
    files: [rawJson(), src("export async function check(foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some(r=>r.name===foodName)}")],
  },
  {
    id: "C02-Vite-public-JSON-then", origin: "client/public/foods.json", blocked: true, rules: ["17", "5"],
    files: [rawJson(), src("export async function check(foodName:string){const rows=await fetch('/foods.json').then(r=>r.json());return rows.some(r=>r.name===foodName)}")],
  },
  {
    id: "C02-Vite-public-dynamic-JS-module", origin: "client/public/foodLookup.js", blocked: true, rules: ["17"],
    files: [source("client/public/foodLookup.js", "export const foodNames=['arroz','pao']"), src("export async function check(foodName:string){const module=await import('/foodLookup.js');return module.foodNames.includes(foodName)}")],
  },
  {
    id: "C02-internal-JSON-import-control", origin: "client/src/data/foods.json", blocked: true, rules: ["17", "5"],
    files: [rawJson("client/src/data/foods.json"), src("import rows from '../data/foods.json';export function check(foodName:string){return rows.find(r=>r.name===foodName)?.calories}")],
  },
  {
    id: "C02-public-catalog-not-referenced", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), src("export function check(status:string){return status==='active'}")],
  },
  {
    id: "C02-public-catalog-fetched-but-not-consumed", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), src("export function check(){return fetch('/foods.json').then(r=>r.status)}")],
  },
  {
    id: "C02-public-catalog-consumed-only-for-display", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), src("export async function show(){const response=await fetch('/foods.json');const rows=await response.json();return rows.length}")],
  },
  {
    id: "C02-public-JSON-administrative", origin: "client/public/status.json", blocked: false,
    files: [source("client/public/status.json", '{"active":1,"inactive":0}'), src("export async function check(status:string){const response=await fetch('/status.json');const rows=await response.json();return rows[status]}")],
  },
  {
    id: "C02-public-JSON-exercise", origin: "client/public/weights.json", blocked: false,
    files: [source("client/public/weights.json", '{"arroz":100,"pao":20}'), src("export async function exercise(foodName:string){const response=await fetch('/weights.json');const rows=await response.json();return rows[foodName]}", "client/src/exercise.ts")],
  },
  {
    id: "C02-fetch-shadowed-by-local-parameter", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), src("export async function check(fetch:(s:string)=>Promise<any>,foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.find((r:any)=>r.name===foodName)}")],
  },
  {
    id: "C02-external-URL-is-not-publicDir", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), src("export async function check(foodName:string){const rows=await (await fetch('https://example.com/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}")],
  },
  {
    id: "C02-server-fetch-does-not-imply-Vite-asset", origin: "client/public/foods.json", blocked: false,
    files: [rawJson(), source("server/api.ts", "export async function check(foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}")],
  },
];

describe("AUD1300 C01/C02 productive static source provenance", () => {
  for (const probe of tests) it(probe.id, () => {
    for (const file of probe.files.filter(f => /\.[cm]?[jt]sx?$/.test(f.path))) {
      const parsed = ts.createSourceFile(file.path, file.content, ts.ScriptTarget.Latest, true);
      expect(parsed.parseDiagnostics, probe.id).toHaveLength(0);
    }
    const findings = findFoodStaticCandidates(probe.files);
    const sourceFindings = findings.filter(f => f.file === probe.origin &&
      (probe.rules === undefined || probe.rules.includes(f.ruleId)));
    const gate = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T18:00:00Z"));
    expect(sourceFindings.length > 0, probe.id + " " + JSON.stringify(findings)).toBe(probe.blocked);
    if (probe.blocked) {
      for (const rule of probe.rules ?? []) {
        expect(sourceFindings.some(f => f.ruleId === rule), probe.id + " gate " + rule).toBe(true);
      }
      expect(gate.errors.some(error => error.startsWith("New food architecture violation")), probe.id).toBe(true);
    } else {
      expect(gate.errors, probe.id).toEqual([]);
    }
  });
});
