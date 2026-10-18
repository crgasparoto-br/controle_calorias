/** Issue #1300: F51/F52/F53 AST mutation tests and discriminating benign controls.
 * Derived from the independent audit's failure corpus. A true case must be
 * reported in the correct source and rejected by the real architecture gate;
 * benign and shadowed cases must remain accepted. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const tests: Array<{group: string; id: string; source: string; expected: boolean; rule: string[]; extra: FoodArchitectureFile[]}> = [];
const add=(group: string,id: string,source: string,expected: boolean,rule: string[],extra: FoodArchitectureFile[]=[])=>tests.push({group,id,source,expected,rule,extra});
const table='const table={pitaya:91,arroz:130};';
const fn=(x: string)=>table+'function check(foodName:string){return '+x+'}';
add('A-numeric-map-projection','A-01-known-direct-Object.keys',fn('Object.keys(table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-02-known-direct-Reflect.ownKeys',fn('Reflect.ownKeys(table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-03-computed-Object.keys',fn('Object["keys"](table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-04-computed-Reflect.ownKeys',fn('Reflect["ownKeys"](table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-05-computed-Object.getOwnPropertyNames',fn('Object["getOwnPropertyNames"](table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-06-computed-const-alias',table+'const keys=Object["keys"];function check(foodName:string){return keys(table).includes(foodName)}',true,['17','5']);
add('A-numeric-map-projection','A-07-direct-Object-keys-Set',fn('new Set(Object.keys(table)).has(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-08-Reflect-keys-Set',fn('new Set(Reflect.ownKeys(table)).has(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-09-join-split',fn('Object.keys(table).join(",").split(",").includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-10-destructure',table+'function check(foodName:string){const [first]=Object.keys(table);return first===foodName}',true,['17','5']);
add('A-numeric-map-projection','A-11-status-control','const table={active:91,pending:130};function check(status:string){return Object["keys"](table).includes(status)}',false,['17','5']);
add('A-numeric-map-projection','A-12-shadowed-Object-control',table+'function check(foodName:string,Object:{keys:(v:object)=>string[]}){return Object["keys"](table).includes(foodName)}',false,['17','5']);
const rx=(x: string)=>'function check(foodName:string){return '+x+'}';
add('B-regex-provenance','B-01-direct-RegExp',rx('RegExp("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-02-new-RegExp',rx('new RegExp("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-03-globalThis-RegExp',rx('globalThis.RegExp("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-04-new-globalThis-RegExp',rx('new globalThis.RegExp("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-05-globalThis-RegExp-alias','const Rx=globalThis.RegExp;'+rx('Rx("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-06-globalThis-RegExp-destructure','const {RegExp:Rx}=globalThis;'+rx('Rx("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-07-direct-String.raw',rx('RegExp(String.raw`pitaya|arroz`).test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-08-computed-String.raw',rx('RegExp(String["raw"]`pitaya|arroz`).test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-09-status-control','function check(status:string){return globalThis.RegExp("active|pending").test(status)}',false,['17','18']);
add('B-regex-provenance','B-10-shadowed-globalThis-control','function check(foodName:string,globalThis:{RegExp:(s:string)=>RegExp}){return globalThis.RegExp("pitaya").test(foodName)}',false,['17','18']);
const catalog={path:'server/data/records.json',content:JSON.stringify([{name:'pão',calories:90},{name:'arroz',calories:130}])};
const js=(body: string)=>'import rows from "./data/records.json";function selectFood(input:string){'+body+'}';
add('C-JSON-field-provenance','C-01-direct-map-includes',js('return rows.map(r=>r.name).includes(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-02-map-Set',js('return new Set(rows.map(r=>r.name)).has(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-03-flatMap-Set',js('return new Set(rows.flatMap(r=>[r.name])).has(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-04-string-coercion-map',js('return rows.map(r=>r.name+"").includes(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-05-unconsumed-import-control',js('return false'),false,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-06-admin-data-control','import rows from "./data/records.json";function checkStatus(status:string){return rows.length>0 && status==="active"}',false,['17','5'],[catalog]);
// Pairwise controls beyond the auditor's exact 28 reproducers.
add('A-numeric-map-projection','A-13-computed-template',fn('Object[`keys`](table).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-14-entries-projection',fn('Object["entries"](table).map(([key])=>key).includes(foodName)'),true,['17','5']);
add('A-numeric-map-projection','A-15-Set-parameter-shadow',table+'function check(foodName:string,Set:new(iterable:any)=>Set<string>){return new Set(Object.keys(table)).has(foodName)}',false,['17','5']);
add('A-numeric-map-projection','A-16-nonmatching-join-split',fn('Object.keys(table).join(",").split(";").includes(foodName)'),false,['17','5']);
add('A-numeric-map-projection','A-17-const-tuple-shadow',table+'function check(foodName:string){const [first]=Object.keys(table);{const first=loadKey();return first===foodName}}',false,['17','5']);
add('A-numeric-map-projection','A-18-destructure-local-mutable',table+'function check(foodName:string){let [first]=Object.keys(table); first="other";return first===foodName}',false,['17','5']);
add('B-regex-provenance','B-11-computed-global',rx('globalThis["RegExp"]("pitaya").test(foodName)'),true,['17','18']);
add('B-regex-provenance','B-12-local-global-shadow', 'const globalThis={RegExp:(_v:string)=>/placeholder/};'+rx('globalThis.RegExp("pitaya").test(foodName)'),false,['17','18']);
add('B-regex-provenance','B-13-let-global-alias', 'let Rx=globalThis.RegExp;'+rx('Rx("pitaya").test(foodName)'),false,['17','18']);
add('B-regex-provenance','B-14-shadowed-String', 'function check(foodName:string,String:{raw:(t:any)=>string}){return RegExp(String["raw"]`pitaya|arroz`).test(foodName)}',false,['17','18']);
add('C-JSON-field-provenance','C-07-String-call',js('return rows.map(r=>String(r.name)).includes(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-08-prepend-empty',js('return rows.map(r=>""+r.name).includes(input)'),true,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-09-changing-identity',js('return rows.map(r=>r.name+"!").includes(input)'),false,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-10-Set-shadow', 'import rows from "./data/records.json";function selectFood(input:string,Set: new(input:any)=>Set<string>){return new Set(rows.map(r=>r.name)).has(input)}',false,['17','5'],[catalog]);
add('C-JSON-field-provenance','C-11-Set-non-food-consumer', 'import rows from "./data/records.json";function checkStatus(status:string){return new Set(rows.map(r=>r.name)).has(status)}',false,['17','5'],[catalog]);

describe("AUD1300-F51/F52/F53 regression and pairwise controls", () => {
  for (const c of tests) it(`${c.group}: ${c.id}`, () => {
    const path = "server/foodService.ts";
    const parsed = ts.transpileModule(c.source, {fileName: path, reportDiagnostics: true,
      compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}});
    expect(parsed.diagnostics ?? [], `TS input must be valid: ${c.id}`).toHaveLength(0);
    const files: FoodArchitectureFile[] = [...c.extra, {path, content: c.source}];
    const findings = findFoodStaticCandidates(files);
    const target = c.extra.length ? c.extra[0].path : path;
    const recognized = findings.some(f => f.file === target && c.rule.includes(f.ruleId));
    const errors = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T12:00:00Z")).errors;
    expect(recognized, JSON.stringify(findings)).toBe(c.expected);
    expect(errors.length > 0, JSON.stringify(errors)).toBe(c.expected);
  });
});
