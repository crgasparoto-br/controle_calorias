/** AUD1300-F69/F70: native fetch origin survives transparent aliases;
 * unrelated destructured/shadowed fetch sources must not be misclassified. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = { id: string; code: string; blocked: boolean };
const decision = (call: string) => "export async function check(foodName:string){const rows=await (await " + call +
  ").json();return rows.some((r:any)=>r.name===foodName)}";
const chained = (call: string) => "export function check(foodName:string){return " + call +
  ".then(r=>r.json()).then(rows=>rows.some((r:any)=>r.name===foodName))}";
const probes: Probe[] = [
  { id: "native-direct", code: decision("fetch('/foods.json')"), blocked: true },
  { id: "native-global", code: decision("globalThis.fetch('/foods.json')"), blocked: true },
  { id: "native-window", code: decision("window['fetch']('/foods.json')"), blocked: true },
  { id: "F69-alias-direct", code: "const load=globalThis.fetch;" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-alias-bind", code: "const load=globalThis.fetch.bind(globalThis);" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-window-bind", code: "const load=window.fetch.bind(window);" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-wrapper-arrow", code: "const load=(u:string)=>globalThis.fetch(u);" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-wrapper-function", code: "function load(u:string){return globalThis.fetch(u)}" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-wrapper-return-await", code: "const load=async (u:string)=>{return await window.fetch(u)};" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-alias-chain", code: "const one=globalThis.fetch;const two=one;" + decision("two('/foods.json')"), blocked: true },
  { id: "F69-named-fetch", code: "const fetch=globalThis.fetch;" + decision("fetch('/foods.json')"), blocked: true },
  { id: "F69-destructure-global", code: "const {fetch:load}=globalThis;" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-destructure-window", code: "const {fetch}=window;" + decision("fetch('/foods.json')"), blocked: true },
  { id: "F69-bind-computed-then", code: "const load=globalThis['fetch'].bind(globalThis);" + chained("load('/foods.json?v=2#v')"), blocked: true },
  { id: "F69-const-url-then", code: "const url='/foods.json?v=2';const load=window.fetch.bind(window);" + chained("load(url)"), blocked: true },
  { id: "F69-wrapper-alias", code: "const load=(u:string)=>window.fetch(u);const alias=load;" + decision("alias('/foods.json')"), blocked: true },
  { id: "F69-bind-native", code: "const load=fetch.bind(globalThis);" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-bind-after-alias", code: "const base=globalThis.fetch;const load=base.bind(globalThis);" + decision("load('/foods.json')"), blocked: true },
  { id: "F69-bind-after-window-alias", code: "const base=window.fetch;const load=base.bind(window);" + decision("load('/foods.json')"), blocked: true },
  { id: "F70-bind-local-provider", code: "const api={fetch:()=>null};const base=api.fetch;const load=base.bind(globalThis);" + decision("load('/foods.json')"), blocked: false },
  { id: "F70-shadow-destructure", code: "const api={fetch:async (_u:string)=>({json:async()=>[]})};const {fetch}=api;" + decision("fetch('/foods.json')"), blocked: false },
  { id: "F70-shadow-window", code: "const api={window:{fetch:async()=>({json:async()=>[]})}};const {window}=api;" + decision("window.fetch('/foods.json')"), blocked: false },
  { id: "F70-param-destructure", code: "export async function check({fetch}:any,foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-param-window", code: "export async function check({window}:any,foodName:string){const rows=await (await window.fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-array-param", code: "export async function check([fetch]:any,foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-nested-destructure", code: "const api={nested:{fetch:async()=>({json:async()=>[]})}};const {nested:{fetch}}=api;" + decision("fetch('/foods.json')"), blocked: false },
  { id: "F70-catch-destructure", code: "export async function check(foodName:string){try{throw {fetch:async()=>({json:async()=>[]})}}catch({fetch}){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}}", blocked: false },
  { id: "F70-provider-method", code: decision("api.fetch('/foods.json')"), blocked: false },
  { id: "F70-param-identifier", code: "export async function check(fetch:any,foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-shadow-global", code: "const globalThis={fetch:async()=>({json:async()=>[]})};" + decision("globalThis.fetch('/foods.json')"), blocked: false },
  { id: "F70-imported-fetch", code: "import {fetch as load} from './client';" + decision("load('/foods.json')"), blocked: false },
  { id: "F70-mutable-alias", code: "let load=globalThis.fetch;" + decision("load('/foods.json')"), blocked: false },
  { id: "F70-unproven-bind", code: "const load=globalThis.fetch.bind(api);" + decision("load('/foods.json')"), blocked: false },
  { id: "F70-rewriting-wrapper", code: "const load=(u:string)=>globalThis.fetch(u+'/different');" + decision("load('/foods.json')"), blocked: false },
  { id: "F70-dynamic-url", code: "const load=globalThis.fetch.bind(globalThis);export async function check(url:string,foodName:string){const rows=await (await load(url)).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-display-only", code: "const load=globalThis.fetch;export async function view(){const rows=await (await load('/foods.json')).json();return rows.length}", blocked: false },
  { id: "F70-exercise-only", code: "const load=window.fetch.bind(window);export async function exercise(foodName:string){const rows=await (await load('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}", blocked: false },
  { id: "F70-external-url", code: "const load=globalThis.fetch;" + decision("load('https://example.com/foods.json')"), blocked: false },
];

describe("AUD1300-F69/F70 — native fetch, shadowing, semantic siblings", () => {
  for (const probe of probes) it(probe.id, () => {
    const files: FoodArchitectureFile[] = [
      { path: "client/public/foods.json", content: '[{"name":"arroz","calories":130}]' },
      { path: "client/src/services/catalog.ts", content: probe.code },
    ];
    const parsed = ts.createSourceFile(files[1].path, files[1].content, ts.ScriptTarget.Latest, true);
    expect(parsed.parseDiagnostics, probe.id).toHaveLength(0);
    const findings = findFoodStaticCandidates(files);
    const assigned = findings.filter(f => f.file === files[0].path && (f.ruleId === "17" || f.ruleId === "5"));
    const result = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(assigned.some(f => f.ruleId === "17"), probe.id).toBe(probe.blocked);
    expect(assigned.some(f => f.ruleId === "5"), probe.id).toBe(probe.blocked);
    expect(result.errors.some(e => e.startsWith("New food architecture violation")), probe.id).toBe(probe.blocked);
    if (!probe.blocked) expect(result.errors, probe.id).toEqual([]);
  });
});
