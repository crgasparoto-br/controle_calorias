/** Issue #1300: F54/F55 discriminating mutation regressions and benign controls. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = { id:string; code:string; expected:boolean; rules:string[]; extra?:FoodArchitectureFile[] };
const probes: Probe[] = [];
const add=(id:string,code:string,expected:boolean,rules:string[],extra?:FoodArchitectureFile[]) =>
  probes.push({id,code,expected,rules,extra});
const catalog=(a="pitaya"): FoodArchitectureFile => ({
  path:"server/data/records.json",
  content:JSON.stringify([{name:a,calories:91},{name:"arroz",calories:130}]),
});
const json=(body:string)=>'import rows from "./data/records.json";function selectFood(input:string){'+body+"}";
const map=(expr:string,prefix="")=>'const table={pitaya:91,arroz:130};'+prefix+
  'function selectFood(foodName:string){return '+expr+"}";
const rx=(expr:string,prefix="")=>prefix+'function matchFood(foodName:string){return '+expr+"}";
add("F54-direct",json('return rows.map(r=>r.name).join("|").split("|").includes(input)'),true,["17","5"],[catalog()]);
add("F54-alias",json('const names=rows.map(r=>r.name);return names.join("|").split("|").includes(input)'),true,["17","5"],[catalog()]);
add("F54-computed",json('return rows.map(r=>r.name)["join"]("|")["split"]("|").includes(input)'),true,["17","5"],[catalog()]);
add("F54-flatmap",json('return new Set(rows.flatMap(r=>[r.name]).join("|").split("|")).has(input)'),true,["17","5"],[catalog()]);
add("F54-static-alias-separator",json('const sep="|";return rows.map(r=>r.name).join(sep).split(sep).includes(input)'),true,["17","5"],[catalog()]);
add("F54-different-separator",json('return rows.map(r=>r.name).join("|").split(":").includes(input)'),false,["17","5"],[catalog()]);
add("F54-collision",json('return rows.map(r=>r.name).join("|").split("|").includes(input)'),true,["17","5"],[catalog("pita|ya")]);
// F56: a collision only affects one name. Other names remain decisive; the
// catalog must be governed, even when ALL names become derived fragments.
add("F56-collision-computed",json('return rows.map(r=>r.name)["join"]("|")["split"]("|").includes(input)'),true,["17","5"],[catalog("pita|ya")]);
add("F56-collision-flatmap-set",json('return new Set(rows.flatMap(r=>[r.name]).join("|").split("|")).has(input)'),true,["17","5"],[catalog("pita|ya")]);
add("F56-collision-const-separator",json('const sep="|";return rows.map(r=>r.name).join(sep).split(sep).includes(input)'),true,["17","5"],[catalog("pita|ya")]);
add("F56-all-identities-collide",json('return rows.map(r=>r.name).join("|").split("|").includes(input)'),true,["17","5"],[{path:"server/data/records.json",content:JSON.stringify([{name:"pita|ya",calories:91},{name:"ar|roz",calories:130}])}]);
add("F56-collision-admin", 'import rows from "./data/records.json";function checkStatus(status:string){return rows.map(r=>r.name).join("|").split("|").includes(status)}',false,["17","5"],[catalog("pita|ya")]);
add("F56-collision-inert",json('const names=rows.map(r=>r.name).join("|").split("|");return false'),false,["17","5"],[catalog("pita|ya")]);
add("F56-collision-mismatch",json('return rows.map(r=>r.name).join("|").split(":").includes(input)'),false,["17","5"],[catalog("pita|ya")]);
add("F56-collision-empty",json('return rows.map(r=>r.name).join("").split("").includes(input)'),false,["17","5"],[catalog("pita|ya")]);
add("F56-collision-nonidentity",json('return rows.map(r=>r.calories).join("|").split("|").includes(input)'),false,["17","5"],[catalog("pita|ya")]);
add("F54-empty",json('return rows.map(r=>r.name).join("").split("").includes(input)'),false,["17","5"],[catalog()]);
add("F54-inert",json('const names=rows.map(r=>r.name).join("|").split("|");return false'),false,["17","5"],[catalog()]);
add("F54-admin", 'import rows from "./data/records.json";function checkStatus(status:string){return rows.map(r=>r.name).join("|").split("|").includes(status)}', false, ["17","5"],[catalog()]);
add("F55-Object",map("Obj.keys(table).includes(foodName)","const Obj=Object;"),true,["17","5"]);
add("F55-Object-chain",map("Alias['keys'](table).includes(foodName)","const Obj=Object;const Alias=Obj;"),true,["17","5"]);
add("F55-Reflect",map("Ref.ownKeys(table).includes(foodName)","const Ref=Reflect;"),true,["17","5"]);
add("F55-Set",map("new Set(Obj.keys(table)).has(foodName)","const Obj=Object;"),true,["17","5"]);
add("F55-Object-import", 'import {table} from "./nutrition";const Obj=Object;function selectFood(foodName:string){return Obj.keys(table).includes(foodName)}',true,["17","5"],[{path:"server/nutrition.ts",content:"export const table={pitaya:91,arroz:130};"}]);
add("F55-Object-shadow", 'const table={pitaya:91,arroz:130};function selectFood(foodName:string,Obj:{keys:(v:any)=>string[]}){return Obj.keys(table).includes(foodName)}',false,["17","5"]);
add("F55-Object-mutable",map("Obj.keys(table).includes(foodName)","let Obj=Object;"),false,["17","5"]);
add("F55-Object-origin-shadow", 'const table={pitaya:91,arroz:130};function selectFood(foodName:string,Object:{keys:(v:any)=>string[]}){const Obj=Object;return Obj.keys(table).includes(foodName)}',false,["17","5"]);
add("F55-Object-admin", 'const table={active:91,pending:130};const Obj=Object;function checkStatus(status:string){return Obj.keys(table).includes(status)}',false,["17","5"]);
add("F55-RegExp",rx('root.RegExp("pitaya|arroz").test(foodName)',"const root=globalThis;"),true,["17","18"]);
add("F55-RegExp-chain",rx('alias["RegExp"]("pitaya|arroz").test(foodName)',"const root=globalThis;const alias=root;"),true,["17","18"]);
add("F55-RegExp-new",rx('new root.RegExp("pitaya|arroz").test(foodName)',"const root=globalThis;"),true,["17","18"]);
add("F55-RegExp-mutable",rx('root.RegExp("pitaya|arroz").test(foodName)',"let root=globalThis;"),false,["17","18"]);
add("F55-RegExp-shadow", 'function matchFood(foodName:string,globalThis:{RegExp:(v:string)=>RegExp}){const root=globalThis;return root.RegExp("pitaya|arroz").test(foodName)}',false,["17","18"]);
add("F55-RegExp-admin", 'const root=globalThis;function checkStatus(status:string){return root.RegExp("active|pending").test(status)}',false,["17","18"]);

describe("Issue 1300 F54/F55 regressions and controls",()=>{
  for(const p of probes) it(p.id,()=>{
    const path="server/foodService.ts";
    const transpiled=ts.transpileModule(p.code,{fileName:path,reportDiagnostics:true,
      compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
    expect(transpiled.diagnostics ?? [],"invalid probe: "+p.id).toHaveLength(0);
    const current=findFoodStaticCandidates([...(p.extra??[]),{path,content:p.code}]);
    const target=p.id.startsWith("F54")?p.extra![0].path:path;
    const seen=current.some(f=>f.file===target&&p.rules.includes(f.ruleId));
    const errors=evaluateFoodArchitectureGate(current,[],[],new Date("2026-10-18T12:00:00Z")).errors;
    expect(seen,JSON.stringify(current)).toBe(p.expected);
    expect(errors.length>0,JSON.stringify(errors)).toBe(p.expected);
  });
});
