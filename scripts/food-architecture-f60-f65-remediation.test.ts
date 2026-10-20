/** Issue #1300, F60-F65: semantic mutation and harmless-input controls.
 * Every positive must reject through the actual architecture gate; JSON
 * findings must be attributed to the catalog, not an unrelated resolver rule. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Case = { id: string; body: string; json: boolean; block: boolean };
const jsonPositive: Array<[string, string]> = [
  ["F60-array-from-mapper", "return Array.from(rows,r=>r.name).includes(foodName)"],
  ["F61-reduce-spread", "return rows.reduce((a:any[],r)=>[...a,r],[]).some(r=>r.name===foodName)"],
  ["F61-reduce-push", "return rows.reduce((a:any[],r)=>{a.push(r);return a},[]).some(r=>r.name===foodName)"],
  ["F61-native-set", "return [...new Set(rows)].some(r=>r.name===foodName)"],
  ["F61-map-key", "return new Map(rows.map(r=>[r.name,r.calories])).has(foodName)"],
  ["F61-json-round-trip", "return JSON.parse(JSON.stringify(rows)).some((r:any)=>r.name===foodName)"],
  ["F62-record-relabel", "return rows.map(r=>({title:r.name,calories:r.calories})).find(r=>r.title===foodName)"],
  ["F62-object-values", "const store={items:rows};return Object.values(store)[0].some(r=>r.name===foodName)"],
  ["F62-object-assign", "const store=Object.assign({},{items:rows});return store.items.some(r=>r.name===foodName)"],
  ["F62-row-destructure", "const {name}=rows[0];return name===foodName"],
];
const jsonNegative: Array<[string, string]> = [
  ["F60-mapper-discards-identity", 'return Array.from(rows,r=>"other").includes(foodName)'],
  ["F61-reducer-discard", "return rows.reduce((a:any[],r)=>a,[]).some(r=>r.name===foodName)"],
  ["F61-shadowed-Set", "function selectFood(foodName:string,Set:any){return [...new Set(rows)].some(r=>r.name===foodName)}"],
  ["F61-JSON-shadow", "function selectFood(foodName:string,JSON:any){return JSON.parse(JSON.stringify(rows)).some((r:any)=>r.name===foodName)}"],
  ["F62-other-object-index", 'const store={first:rows, second:[{name:"other"}]};return Object.values(store)[1].some(r=>r.name===foodName)'],
  ["F62-object-assign-overwrite", 'const store=Object.assign({items:rows},{items:[{name:"other"}]});return store.items.some(r=>r.name===foodName)'],
  ["F62-unused-projection", "const store={items:rows};Object.values(store);return false"],
  ["F62-admin-decision", "function checkStatus(status:string){const store={items:rows};return Object.values(store)[0].some(r=>r.name===status)}"],
];
const lexicalPositive: Array<[string, string]> = [
  ["F63-some-equality", 'return ["pitaya","arroz"].some(n=>n===foodName)'],
  ["F64-array-spread", 'const words=[...[],"pitaya","arroz"];return words.includes(foodName)'],
  ["F64-concat", 'const words=["pitaya"].concat(["arroz"]);return words.includes(foodName)'],
  ["F64-split-reverse", 'const words="pitaya|arroz".split("|").reverse();return words.includes(foodName)'],
  ["F64-split-filter", 'const words="pitaya|arroz".split("|").filter(Boolean);return words.includes(foodName)'],
  ["F65-conditional-alias", 'const word=foodName.length>3?"pitaya":"arroz";return foodName===word'],
];
const lexicalNegative: Array<[string, string]> = [
  ["F63-nondeciding-some", 'const result=["pitaya","arroz"].some(n=>Boolean(n));return false'],
  ["F63-admin-some", 'function checkStatus(status:string){return ["active","pending"].some(n=>n===status)}'],
  ["F64-filter-removes-identity", 'const words="pitaya|arroz".split("|").filter(()=>false);return words.includes(foodName)'],
  ["F64-shadow-Boolean", 'function checkFood(foodName:string,Boolean:any){const words="pitaya|arroz".split("|").filter(Boolean);return words.includes(foodName)}'],
  ["F65-mutable-alias", 'let word="pitaya";word=foodName;return foodName===word'],
  ["F65-dynamic-branch", 'const word=foodName.length>3?"pitaya":loadFromDatabase();return foodName===word'],
];
const mk = (id: string, body: string, json: boolean, block: boolean): Case => ({
  id, json, block, body: body.startsWith("function ") ? body :
    "function " + (json ? "selectFood" : "checkFood") + "(foodName:string){" + body + "}",
});
const cases: Case[] = [
  ...jsonPositive.map(([id, body]) => mk(id, body, true, true)),
  ...jsonNegative.map(([id, body]) => mk(id, body, true, false)),
  ...lexicalPositive.map(([id, body]) => mk(id, body, false, true)),
  ...lexicalNegative.map(([id, body]) => mk(id, body, false, false)),
];
const catalog: FoodArchitectureFile = {
  path: "server/data/records.json",
  content: JSON.stringify([{name: "pitaya", calories: 91}, {name: "arroz", calories: 130}]),
};
describe("Issue 1300 F60-F65 semantic mutation regressions", () => {
  for (const item of cases) it(item.id, () => {
    const source = (item.json ? 'import rows from "./data/records.json";' : "") + item.body;
    const parsed = ts.transpileModule(source, {fileName: "server/foodService.ts",
      reportDiagnostics: true, compilerOptions: {target: ts.ScriptTarget.ES2022}});
    expect(parsed.diagnostics ?? [], item.id).toHaveLength(0);
    const files: FoodArchitectureFile[] = [
      ...(item.json ? [catalog] : []), {path: "server/foodService.ts", content: source},
    ];
    const findings = findFoodStaticCandidates(files);
    const outcome = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T12:00:00Z"));
    if (item.json) {
      expect(findings.some(f => f.file === catalog.path && ["17", "5"].includes(f.ruleId)),
        item.id + " " + JSON.stringify(findings)).toBe(item.block);
    }
    // An unrelated gate 2 may flag a resolver named selectFood; negative JSON
    // checks assert absence of gates 17/5 instead of an unrelated gate's outcome.
    if (!item.json || item.block) {
      expect(outcome.errors.length > 0, item.id + " " + JSON.stringify(outcome.errors)).toBe(item.block);
    }
  });
});
