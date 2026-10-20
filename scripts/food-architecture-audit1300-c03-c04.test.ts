/** Regression matrix for AUD1300-C03/C04. A source is blocked iff its
 * statically proven food identity is consumed by productive decision code. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = { id: string; origin: string; files: FoodArchitectureFile[]; blocked: boolean };
const source = (path: string, content: string): FoodArchitectureFile => ({ path, content });
const foodData = JSON.stringify([{ name: "arroz", calories: 130 }, { name: "pao", calories: 70 }]);
const food = () => source("client/public/foods.json", foodData);
const client = (code: string) => source("client/src/services/catalog.ts", code);
const byUrl = (url: string) => "export async function check(foodName:string){const rows=await (await fetch('" + url + "')).json();return rows.some((r:any)=>r.name===foodName)}";
const byThen = (expr: string, url = "/foods.json") => "export async function check(foodName:string){return fetch('" + url + "').then(r=>r.json()).then(rows=>" + expr + ")}";
const cases: Probe[] = [
  { id: "C03-query", origin: "client/public/foods.json", files: [food(), client(byUrl("/foods.json?v=2"))], blocked: true },
  { id: "C03-fragment", origin: "client/public/foods.json", files: [food(), client(byUrl("/foods.json#sha"))], blocked: true },
  { id: "C03-query-fragment", origin: "client/public/foods.json", files: [food(), client(byUrl("/foods.json?v=2#sha"))], blocked: true },
  { id: "C03-plain-control", origin: "client/public/foods.json", files: [food(), client(byUrl("/foods.json"))], blocked: true },
  { id: "C03-missing-source", origin: "client/public/foods.json", files: [food(), client(byUrl("/different.json?v=2"))], blocked: false },
  { id: "C03-external-URL", origin: "client/public/foods.json", files: [food(), client(byUrl("https://example.com/foods.json?v=2"))], blocked: false },
  { id: "C03-scheme-relative", origin: "client/public/foods.json", files: [food(), client(byUrl("//example.com/foods.json?v=2"))], blocked: false },
  { id: "C03-traversal", origin: "client/public/foods.json", files: [food(), client(byUrl("/../foods.json?v=2"))], blocked: false },
  { id: "C03-display-only", origin: "client/public/foods.json", files: [food(), client("export async function view(){const rows=await (await fetch('/foods.json?v=2')).json();return rows.length}")], blocked: false },
  { id: "C03-status-only", origin: "client/public/foods.json", files: [food(), client("export function check(){return fetch('/foods.json?x=1').then(r=>r.status)}")], blocked: false },
  { id: "C03-fetch-shadow", origin: "client/public/foods.json", files: [food(), client("export async function check(fetch:any,foodName:string){const rows=await (await fetch('/foods.json?v=2')).json();return rows.some((r:any)=>r.name===foodName)}")], blocked: false },
  { id: "C03-server-is-not-Vite", origin: "client/public/foods.json", files: [food(), source("server/catalog.ts", byUrl("/foods.json?v=2"))], blocked: false },
  { id: "C04-second-then-some", origin: "client/public/foods.json", files: [food(), client(byThen("rows.some((r:any)=>r.name===foodName)"))], blocked: true },
  { id: "C04-second-then-find", origin: "client/public/foods.json", files: [food(), client(byThen("rows.find((r:any)=>r.name===foodName)?.calories"))], blocked: true },
  { id: "C04-second-then-project", origin: "client/public/foods.json", files: [food(), client(byThen("rows.map((r:any)=>r.name).includes(foodName)"))], blocked: true },
  { id: "C04-url-and-then", origin: "client/public/foods.json", files: [food(), client(byThen("rows.some((r:any)=>r.name===foodName)", "/foods.json?v=2"))], blocked: true },
  { id: "C04-block-callback", origin: "client/public/foods.json", files: [food(), client(byThen("{const visible=rows;return visible.some((r:any)=>r.name===foodName)}"))], blocked: true },
  { id: "C04-not-json", origin: "client/public/foods.json", files: [food(), client("export async function check(foodName:string){return fetch('/foods.json').then(r=>r.status).then(rows=>rows.some((r:any)=>r.name===foodName))}")], blocked: false },
  { id: "C04-display-only", origin: "client/public/foods.json", files: [food(), client(byThen("rows.length"))], blocked: false },
  { id: "C04-replaced-before-decision", origin: "client/public/foods.json", files: [food(), client(byThen("getDatabaseRows().some((r:any)=>r.name===foodName)"))], blocked: false },
  { id: "C04-exercise", origin: "client/public/foods.json", files: [food(), client("export async function exercise(foodName:string){return fetch('/foods.json').then(r=>r.json()).then(rows=>rows.some((r:any)=>r.name===foodName))}")], blocked: false },
  { id: "C04-shadowed-fetch", origin: "client/public/foods.json", files: [food(), client("export async function check(fetch:any,foodName:string){return fetch('/foods.json').then((r:any)=>r.json()).then((rows:any)=>rows.some((r:any)=>r.name===foodName))}")], blocked: false },
  { id: "C04-unrelated-status-source", origin: "client/public/status.json", files: [source("client/public/status.json", '{"active":true}'), client("export async function check(status:string){return fetch('/status.json').then(r=>r.json()).then(rows=>rows[status])}")], blocked: false },
];

describe("AUD1300-C03/C04 — productive Vite JSON source provenance", () => {
  for (const probe of cases) it(probe.id, () => {
    for (const f of probe.files.filter(f => /\.[cm]?[jt]sx?$/.test(f.path))) {
      const parsed = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, true);
      expect(parsed.parseDiagnostics, probe.id).toHaveLength(0);
    }
    const found = findFoodStaticCandidates(probe.files);
    const attributed = found.filter(f => f.file === probe.origin && ["17","5"].includes(f.ruleId));
    const verdict = evaluateFoodArchitectureGate(found, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(attributed.length > 0, probe.id + JSON.stringify(found)).toBe(probe.blocked);
    if (probe.blocked) {
      expect(attributed.some(f => f.ruleId === "17"), probe.id).toBe(true);
      expect(attributed.some(f => f.ruleId === "5"), probe.id).toBe(true);
      expect(verdict.errors.some(e => e.startsWith("New food architecture violation")), probe.id).toBe(true);
    } else {
      expect(verdict.errors, probe.id).toEqual([]);
    }
  });
});
