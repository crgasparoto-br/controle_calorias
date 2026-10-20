/** C05: equivalent browser fetch syntax and immutable URL aliases must not
 * hide a productive Vite JSON catalog or create false positive ownership. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = { id: string; files: FoodArchitectureFile[]; blocked: boolean };
const file = (path: string, content: string): FoodArchitectureFile => ({ path, content });
const catalog = () => file("client/public/foods.json", JSON.stringify([
  { name: "arroz", calories: 130 }, { name: "pao", calories: 70 },
]));
const code = (content: string) => file("client/src/services/catalog.ts", content);
const decision = (fetchExpression: string) =>
  "export async function check(foodName:string){const response=await " + fetchExpression +
  ";const rows=await response.json();return rows.some((r:any)=>r.name===foodName)}";
const chained = (fetchExpression: string) =>
  "export async function check(foodName:string){return " + fetchExpression +
  ".then(r=>r.json()).then(rows=>rows.some((r:any)=>r.name===foodName))}";

const cases: Probe[] = [
  { id: "C05-globalThis-fetch", files: [catalog(), code(decision("globalThis.fetch('/foods.json')"))], blocked: true },
  { id: "C05-window-fetch", files: [catalog(), code(decision("window.fetch('/foods.json')"))], blocked: true },
  { id: "C05-globalThis-bracket", files: [catalog(), code(decision("globalThis['fetch']('/foods.json')"))], blocked: true },
  { id: "C05-window-bracket", files: [catalog(), code(decision("window[\"fetch\"]('/foods.json')"))], blocked: true },
  { id: "C05-local-const-url", files: [catalog(), code("export async function check(foodName:string){const url='/foods.json';const rows=await (await fetch(url)).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: true },
  { id: "C05-module-const-url", files: [catalog(), code("const url='/foods.json';" + decision("fetch(url)"))], blocked: true },
  { id: "C05-module-alias-chain", files: [catalog(), code("const base='/foods.json';const url=base;" + decision("globalThis.fetch(url)"))], blocked: true },
  { id: "C05-as-const", files: [catalog(), code("const url='/foods.json' as const;" + decision("window.fetch(url)"))], blocked: true },
  { id: "C05-template-const", files: [catalog(), code("const url=`/foods.json?v=2#view`;" + decision("fetch(url)"))], blocked: true },
  { id: "C05-member-query-fragment", files: [catalog(), code("const url='/foods.json?v=2#view';" + decision("globalThis.fetch(url)"))], blocked: true },
  { id: "C05-chained-globalThis", files: [catalog(), code(chained("globalThis.fetch('/foods.json')"))], blocked: true },
  { id: "C05-chained-window", files: [catalog(), code(chained("window.fetch('/foods.json')"))], blocked: true },
  { id: "C05-chained-aliased-url", files: [catalog(), code("const url='/foods.json?v=2';" + chained("globalThis.fetch(url)"))], blocked: true },
  { id: "C05-chained-computed", files: [catalog(), code(chained("globalThis['fetch']('/foods.json')"))], blocked: true },
  { id: "C05-shadowed-globalThis-param", files: [catalog(), code("export async function check(globalThis:any,foodName:string){const rows=await (await globalThis.fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-shadowed-window-param", files: [catalog(), code("export async function check(window:any,foodName:string){const rows=await (await window.fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-shadowed-window-const", files: [catalog(), code("const window={fetch:fetchFromTest};" + decision("window.fetch('/foods.json')"))], blocked: false },
  { id: "C05-shadowed-fetch-param", files: [catalog(), code("export async function check(fetch:any,foodName:string){const rows=await (await fetch('/foods.json')).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-third-party-fetch", files: [catalog(), code(decision("api.fetch('/foods.json')"))], blocked: false },
  { id: "C05-mutable-url", files: [catalog(), code("export async function check(foodName:string){let url='/foods.json';const rows=await (await fetch(url)).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-parameter-url", files: [catalog(), code("export async function check(url:string,foodName:string){const rows=await (await fetch(url)).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-shadowed-url", files: [catalog(), code("const url='/foods.json';export async function check(foodName:string){const url=getUrl();const rows=await (await fetch(url)).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C05-unresolved-alias", files: [catalog(), code("const url=buildCatalogUrl();" + decision("fetch(url)"))], blocked: false },
  { id: "C05-external-url", files: [catalog(), code("const url='https://example.com/foods.json';" + decision("globalThis.fetch(url)"))], blocked: false },
  { id: "C05-display-only", files: [catalog(), code("const url='/foods.json';export async function view(){const rows=await (await window.fetch(url)).json();return rows.length}")], blocked: false },
  { id: "C05-status-only", files: [catalog(), code("const url='/foods.json';export function view(){return globalThis.fetch(url).then(r=>r.status)}")], blocked: false },
  { id: "C05-not-json", files: [catalog(), code("const url='/foods.json';export async function check(foodName:string){return globalThis.fetch(url).then(r=>r.text()).then(rows=>rows.includes(foodName))}")], blocked: false },
  { id: "C05-missing-asset", files: [catalog(), code(decision("globalThis.fetch('/missing.json')"))], blocked: false },
  { id: "C05-server-not-vite", files: [catalog(), file("server/catalog.ts", decision("globalThis.fetch('/foods.json')"))], blocked: false },
  { id: "C05-exercise-consumer", files: [catalog(), code("const url='/foods.json';export async function exercise(foodName:string){return globalThis.fetch(url).then(r=>r.json()).then(rows=>rows.some((r:any)=>r.name===foodName))}")], blocked: false },
];

describe("AUD1300-C05 — equivalent productive browser fetch provenance", () => {
  for (const probe of cases) it(probe.id, () => {
    for (const entry of probe.files.filter(item => /\.[cm]?[jt]sx?$/.test(item.path))) {
      const parsed = ts.createSourceFile(entry.path, entry.content, ts.ScriptTarget.Latest, true);
      expect(parsed.parseDiagnostics, probe.id).toHaveLength(0);
    }
    const findings = findFoodStaticCandidates(probe.files);
    const attributed = findings.filter(f => f.file === "client/public/foods.json" &&
      (f.ruleId === "17" || f.ruleId === "5"));
    const result = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(attributed.length > 0, probe.id + JSON.stringify(findings)).toBe(probe.blocked);
    if (probe.blocked) {
      expect(attributed.some(f => f.ruleId === "17"), probe.id).toBe(true);
      expect(attributed.some(f => f.ruleId === "5"), probe.id).toBe(true);
      expect(result.errors.some(err => err.startsWith("New food architecture violation")), probe.id).toBe(true);
    } else {
      expect(result.errors, probe.id).toEqual([]);
    }
  });
});
