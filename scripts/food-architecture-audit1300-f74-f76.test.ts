/** Issue #1300: independent audit F74-F76, RequestInit alias provenance. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const probes: readonly (readonly [string, string, boolean])[] = [
  ["CONTROL known GET","const opts={method:'GET'};",true],
  ["CONTROL direct write","const opts={method:'GET'}; opts.method='POST';",false],
  ["OBJECT destructure from container mutated","const opts={method:'GET'}; const holder={options:opts}; const {options:alias}=holder; alias.method='POST';",false],
  ["ARRAY destructure from container mutated","const opts={method:'GET'}; const holder=[opts]; const [alias]=holder; alias.method='POST';",false],
  ["OBJECT destructure safe","const opts={method:'GET'}; const holder={options:opts}; const {options:alias}=holder; const a=alias.method;",true],
  ["ARRAY destructure safe","const opts={method:'GET'}; const holder=[opts]; const [alias]=holder; const a=alias.method;",true],
  ["OBJECT destructure unrelated property mutation","const opts={method:'GET'}; const holder={options:opts,other:{method:'POST'}}; const {other}=holder; other.method='GET';",true],
  ["ARRAY destructure unrelated index mutation","const opts={method:'GET'}; const holder=[{method:'POST'},opts]; const [other]=holder; other.method='GET';",true],
  ["NESTED object destructure mutates options","const opts={method:'GET'}; const holder={outer:{options:opts}}; const {outer:{options:alias}}=holder; alias.method='POST';",false],
  ["ARRAY destructure literal direct mutant","const opts={method:'GET'}; const [alias]=[opts]; alias.method='POST';",false],
  ["ASSIGNMENT late alias then mutate","const opts={method:'GET'}; let alias; alias=opts; alias.method='POST';",false],
  ["OBJECT destructure assignment then mutate","const opts={method:'GET'}; const holder={options:opts}; let alias; ({options:alias}=holder); alias.method='POST';",false],
  ["TERNARY alias then mutate","const opts={method:'GET'}; const other={method:'POST'}; const alias=true?opts:other; alias.method='POST';",false],
  ["COALESCE alias then mutate","const opts={method:'GET'}; const other={method:'POST'}; const alias=opts??other; alias.method='POST';",false],
  ["ARRAY method at returns mutable alias","const opts={method:'GET'}; const alias=[opts].at(0)!; alias.method='POST';",false],
  ["CONTAINER method at returns mutable alias","const opts={method:'GET'}; const holder=[opts]; const alias=holder.at(0)!; alias.method='POST';",false],
  ["ARROW implicit return alias then mutate","const opts={method:'GET'}; const alias=(()=>opts)(); alias.method='POST';",false],
  ["ARROW implicit return container then mutate","const opts={method:'GET'}; const box=(()=>[opts])(); box[0].method='POST';",false],
  ["OBJECT destructure literal direct mutant","const opts={method:'GET'}; const {options:alias}={options:opts}; alias.method='POST';",false],
  ["F74 nested object destructure unchanged","const opts={method:'GET'};const holder={outer:{options:opts}};const {outer:{options:alias}}=holder;const value=alias.method;",true],
  ["F74 shorthand destructure mutation","const opts={method:'GET'};const holder={opts};const {opts:alias}=holder;alias.method='POST';",false],
  ["F74 nested destructure unrelated branch","const opts={method:'GET'};const holder={outer:{options:opts},side:{method:'POST'}};const {side:{method}}=holder;",true],
  ["F75 let initialized alias mutated","const opts={method:'GET'};let alias=opts;alias.method='POST';",false],
  ["F75 let initialized alias benign","const opts={method:'GET'};let alias=opts;const method=alias.method;",true],
  ["F75 assignment alias benign","const opts={method:'GET'};let alias;alias=opts;const method=alias.method;",true],
  ["F75 array destructure assignment mutated","const opts={method:'GET'};const holder=[opts];let alias;[alias]=holder;alias.method='POST';",false],
  ["F76 ternary benign","const opts={method:'GET'};const other={method:'POST'};const alias=true?opts:other;const method=alias.method;",true],
  ["F76 nullish benign","const opts={method:'GET'};const other={method:'POST'};const alias=opts??other;const method=alias.method;",true],
  ["F76 array at benign","const opts={method:'GET'};const alias=[opts].at(0)!;const method=alias.method;",true],
  ["F76 array at sibling mutated","const opts={method:'GET'};const alias=[{method:'POST'},opts].at(0)!;alias.method='GET';",true],
  ["F76 arrow container benign","const opts={method:'GET'};const box=(()=>[opts])();const method=box[0].method;",true],
  ["F76 arrow block mutation","const opts={method:'GET'};const alias=(()=>{return opts})();alias.method='POST';",false],
  ["F76 logical and mutation","const opts={method:'GET'};const alias=true&&opts;alias.method='POST';",false],
  ["F76 logical or mutation","const opts={method:'GET'};const alias=false||opts;alias.method='POST';",false],
  ["F76 arrow unrelated reference","const opts={method:'GET'};const other={method:'POST'};const alias=(()=>other)();alias.method='GET';",true],
  ["F77 property write stores RequestInit","const opts={method:'GET'};const holder:any={};holder.options=opts;holder.options.method='POST';",false],
  ["F77 computed property write stores RequestInit","const opts={method:'GET'};const holder:any={};holder['options']=opts;holder.options.method='POST';",false],
  ["F78 named transparent wrapper mutation","const opts={method:'GET'};const expose=()=>opts;const alias=expose();alias.method='POST';",false],
  ["F78 named block wrapper mutation","const opts={method:'GET'};const expose=()=>{return opts};const alias=expose();alias.method='POST';",false],
  ["F78 opaque named wrapper mutation","const opts={method:'GET'};const expose=()=>{sideEffect();return opts};const alias=expose();alias.method='POST';",false],
  ["F78 named transparent wrapper read","const opts={method:'GET'};const expose=()=>opts;const alias=expose();const method=alias.method;",true],
];

const consumer = `export async function check(foodName:string){
  const rows=await(await fetch('/foods.json',opts)).json();
  return rows.some((r:any)=>r.name===foodName)
}`;

describe("AUD1300 F74/F75/F76 — RequestInit identity across aliases", () => {
  for (const [id, setup, expectedGet] of probes) it(id, () => {
    const code = setup + "\n" + consumer;
    const files: FoodArchitectureFile[] = [
      { path: "client/public/foods.json", content: '[{"name":"arroz","calories":130}]' },
      { path: "client/src/services/catalog.ts", content: code },
    ];
    const source = ts.createSourceFile(files[1].path, code, ts.ScriptTarget.Latest, true);
    expect(source.parseDiagnostics, id).toHaveLength(0);
    const candidates = findFoodStaticCandidates(files);
    const jsonFindings = candidates.filter(f => f.file === "client/public/foods.json");
    const result = evaluateFoodArchitectureGate(candidates, [], [], new Date("2026-10-19T12:00:00Z"));
    expect(jsonFindings.some(f => f.ruleId === "17"), id).toBe(expectedGet);
    expect(jsonFindings.some(f => f.ruleId === "5"), id).toBe(expectedGet);
    expect(result.errors.some(error => error.startsWith("New food architecture violation") &&
      error.includes("client/public/foods.json")), id).toBe(expectedGet);
  });
});
