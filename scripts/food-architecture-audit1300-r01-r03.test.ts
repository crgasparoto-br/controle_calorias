/** Issue #1300 R01/R02/R03: independent audit escapes and paired safe controls.
 * Assert the real detector AND enforcement; no synthesized/whitelisted answers. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const decision = (call: string) => `export async function check(foodName:string){const rows=await (await ${call}).json();return rows.some((r:any)=>r.name===foodName)}`;
type Probe = [string, string, boolean];
const probes: Probe[] = [

['P0-native-direct', decision("fetch('/foods.json')"),true],
['P1-one-param-forwarder',`const load=(url:string)=>window.fetch(url);`+decision("load('/foods.json')"),true],
['P2-two-param-ignored',`const load=(url:string,ignored?:string)=>window.fetch(url);`+decision("load('/foods.json')"),true],
['P3-two-param-static-default',`const load=(url:string,init={cache:'no-store'})=>window.fetch(url,init);`+decision("load('/foods.json')"),true],
['P4-return-via-const',`const load=async(url:string)=>{const resp=await window.fetch(url);return resp;};`+decision("load('/foods.json')"),true],
['P5-extra-comment',`const load=(url:string)=>{const info={method:'GET'};return window.fetch(url,info);};`+decision("load('/foods.json')"),true],
['P6-POST-mutable-object',`const opts={method:'GET'};opts.method='POST';const load=(url:string)=>window.fetch(url,opts);`+decision("load('/foods.json')"),false],
['P7-shadowed-fetch',`const window={fetch:(_url:string)=>Promise.resolve({json:()=>[]})};`+decision("window.fetch('/foods.json')"),false],
['P8-display-only',`export async function view(){const rows=await (await fetch('/foods.json')).json();return rows.length}`,false],
['P9-wrapper-local-options',`const load=(url:string)=>{const opts={method:'GET'};return window.fetch(url,opts);};`+decision("load('/foods.json')"),true],
['P10-wrapper-default-param-ignored',`const load=(url:string,unused=false)=>window.fetch(url);`+decision("load('/foods.json')"),true],
['P11-simple-function-extra',`function load(url:string, unused?:string){return fetch(url)}`+decision("load('/foods.json')"),true],

 ['D00-direct-GET', decision("window.fetch('/foods.json',{method:'GET'})"),true],
 ['D01-direct-POST', decision("window.fetch('/foods.json',{method:'POST'})"),false],
 ['D02-direct-POST-body', decision("window.fetch('/foods.json',{method:'POST',body:'payload'})"),false],
 ['D03-direct-OPTIONS', decision("fetch('/foods.json',{method:'OPTIONS'})"),false],
 ['D04-direct-dynamic-options',`declare const userInit:RequestInit;`+decision("window.fetch('/foods.json',userInit)"),false],
 ['D05-direct-side-effect',`declare function mutate():RequestInit;`+decision("fetch('/foods.json',mutate())"),false],
 ['D06-direct-body-GET',decision("fetch('/foods.json',{body:'payload'})"),false],
 ['D07-direct-external',decision("fetch('https://example.com/foods.json',{method:'GET'})"),false],
 ['W00-forward-1-param',`const load=(url:string)=>window.fetch(url);`+decision("load('/foods.json')"),true],
 ['W01-forward-second-unused',`const load=(url:string,unused?:string)=>window.fetch(url);`+decision("load('/foods.json')"),true],
 ['W02-forward-second-unused-named',`function load(url:string, unused?:string){return window.fetch(url)}`+decision("load('/foods.json')"),true],
 ['W03-forward-async-return',`async function load(url:string){const r=await window.fetch(url);return r}`+decision("load('/foods.json')"),true],
 ['W04-forward-return-ternary',`const load=(url:string)=>true?window.fetch(url):window.fetch(url);`+decision("load('/foods.json')"),true],
 ['W05-forward-second-static-used',`const load=(url:string,unused?:number)=>window.fetch(url,{cache:'no-store'});`+decision("load('/foods.json')"),true],
 ['W06-forward-url-rewrite',`const load=(url:string)=>window.fetch(url+'/altered');`+decision("load('/foods.json')"),false],
 ['O00-get-const-opts',`const opts={method:'GET'};const load=(url:string)=>fetch(url,opts);`+decision("load('/foods.json')"),true],
 ['O01-mutated-POST',`const opts={method:'GET'};opts.method='POST';const load=(url:string)=>fetch(url,opts);`+decision("load('/foods.json')"),false],
 ['O02-mutated-body',`const opts:{method:string,body?:string}={method:'GET'};opts.body='payload';const load=(url:string)=>fetch(url,opts);`+decision("load('/foods.json')"),false],
 ['O03-mutated-spread',`const opts={method:'GET'};Object.assign(opts,{method:'POST'});const load=(url:string)=>fetch(url,opts);`+decision("load('/foods.json')"),false],
 ['O04-unmodified-extra-get',`const opts={method:'GET',headers:{Accept:'application/json'}};const load=(url:string)=>fetch(url,opts);`+decision("load('/foods.json')"),true],
 ['X00-non-food-display',`export async function view(){const rows=await (await fetch('/foods.json',{method:'GET'})).json();return rows.length}`,false],
 ['X01-exercise-only',`export async function exercise(foodName:string){const rows=await (await fetch('/foods.json',{method:'GET'})).json();return rows.some((r:any)=>r.name===foodName)}`,false],
  // Pairwise extensions: aliases, mutation timing, shadowing and safety limits.
  ["R01-static-ternary", `const load=(url:string)=>true?window.fetch(url):window.fetch(url);` + decision("load('/foods.json')"), true],
  ["R01-extra-unused-call-argument-unknown", `const load=(url:string,unused?:number)=>window.fetch(url);declare const sideEffect:()=>number;` + decision("load('/foods.json',sideEffect())"), false],
  ["R01-extra-default-side-effect", `declare function sideEffect():number;const load=(url:string,unused=sideEffect())=>window.fetch(url);` + decision("load('/foods.json')"), false],
  ["R01-return-alias-safe-options", `const load=async(url:string)=>{const opts={method:'GET'};const response=await window.fetch(url,opts);return response};` + decision("load('/foods.json')"), true],
  ["R01-return-alias-side-effect", `const load=async(url:string)=>{const resp=await window.fetch(url);sideEffect();return resp};` + decision("load('/foods.json')"), false],
  ["R02-direct-inline-cache", decision("fetch('/foods.json',{cache:'no-store'})"), true],
  ["R02-direct-const-init", `const opts={method:'GET'};` + decision("fetch('/foods.json',opts)"), true],
  ["R02-direct-const-post", `const opts={method:'POST'};` + decision("fetch('/foods.json',opts)"), false],
  ["R02-direct-three-args", decision("fetch('/foods.json',{method:'GET'},extra)"), false],
  ["R03-mutated-after-wrapper-declaration", `const opts={method:'GET'};const load=(url:string)=>window.fetch(url,opts);opts.method='POST';` + decision("load('/foods.json')"), false],
  ["R03-mutated-aliased-object", `const opts={method:'GET'};const alias=opts;alias.method='POST';const load=(url:string)=>window.fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-mutated-nested-object", `const opts={headers:{Accept:'application/json'}};opts.headers.Accept='text/html';const load=(url:string)=>window.fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-object-escaped-to-provider", `const opts={method:'GET'};configure(opts);const load=(url:string)=>window.fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-nested-escape", `const opts={method:'GET'};const ref={opts};ref.opts.method='POST';const load=(url:string)=>fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-destructured-escape", `const opts={headers:{Accept:'application/json'}};const {headers}=opts;headers.Accept='text/html';const load=(url:string)=>fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-dynamic-property-write", `const opts={method:'GET'};opts['method']='POST';const load=(url:string)=>fetch(url,opts);` + decision("load('/foods.json')"), false],
  ["R03-reused-native-reads", `const opts={method:'GET'};export async function check(foodName:string){const first=await fetch('/foods.json',opts);await fetch('/foods.json',opts);const rows=await first.json();return rows.some((r:any)=>r.name===foodName)}`, true],
  ["R03-reused-mixed-native-reads", `const opts={method:'GET'};export async function check(foodName:string){const first=await window.fetch('/foods.json',opts);await globalThis['fetch']('/foods.json',opts);const rows=await first.json();return rows.some((r:any)=>r.name===foodName)}`, true],
  ["R03-reused-unsafe-provider", `const opts={method:'GET'};unknownProvider(opts);` + decision("fetch('/foods.json',opts)"), false],
  ["R03-alias-unmodified", `const opts={method:'GET'};const alias=opts;const load=(url:string)=>window.fetch(url,alias);` + decision("load('/foods.json')"), true],
  ["R03-shadowed-unrelated-options", `const opts={method:'GET'};function irrelevant(){const opts={method:'POST'};opts.method='GET'}const load=(url:string)=>window.fetch(url,opts);` + decision("load('/foods.json')"), true],
];

describe("AUD1300 R01/R02/R03 — request provenance, wrapper equivalence, deep mutability", () => {
  for (const [id, code, blocked] of probes) it(id, () => {
    const files: FoodArchitectureFile[] = [
      { path: "client/public/foods.json", content: '[{"name":"arroz","calories":130}]' },
      { path: "client/src/services/catalog.ts", content: code },
    ];
    const parsed = ts.createSourceFile(files[1].path, code, ts.ScriptTarget.Latest, true);
    expect(parsed.parseDiagnostics, id).toHaveLength(0);
    const findings = findFoodStaticCandidates(files);
    const matches = findings.filter(f => f.file === files[0].path);
    const gate = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(matches.some(f => f.ruleId === "17"), id).toBe(blocked);
    expect(matches.some(f => f.ruleId === "5"), id).toBe(blocked);
    expect(gate.errors.some(e => e.startsWith("New food architecture violation")), id).toBe(blocked);
    if (!blocked) expect(gate.errors, id).toEqual([]);
  });
});
