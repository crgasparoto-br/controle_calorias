/** Issue 1300 F66-F68: independent audit replay, real detector and enforcement. */
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
type Case = { id: string; files: FoodArchitectureFile[]; origin: string; rules: string[]; blocked: boolean };
const at = new Date("2026-10-18T18:00:00Z");
const json = (v: unknown) => JSON.stringify(v);
const records = { path: "server/data/records.json",
  content: json([{name:"pitaya",calories:91},{name:"arroz",calories:130}]) };
const cases: Case[] = [];
function push(id: string, files: FoodArchitectureFile[], origin: string, blocked: boolean, rules=["17"]) {
  cases.push({id,files,origin,blocked,rules});
}
const bodies: Array<[string,string,string,boolean]> = [
  ["A01-positive", "server/foodService.ts","return rows.some(row=>row.name===foodName)",true],
  ["A02-generic-some","server/helpers.ts","return rows.some(row=>row.name===foodName)",true],
  ["A03-generic-find","server/helpers.ts","return rows.find(row=>row.name===foodName)?.calories",true],
  ["A04-generic-filter","server/helpers.ts","return rows.filter(row=>row.name===foodName)",true],
  ["A05-generic-loop","server/helpers.ts","for(const row of rows){if(row.name===foodName)return row.calories;}return null",true],
  ["A06-generic-index","server/helpers.ts","return rows[0]?.name===foodName",true],
  ["A07-food-helper","server/foodHelpers.ts","return rows.some(row=>row.name===foodName)",true],
  ["A08-generic-select","server/helpers.ts","return rows.some(row=>row.name===foodName)",true],
  ["A09-generic-alias","server/helpers.ts","const label=foodName;return rows.some(row=>row.name===label)",true],
  ["A10-generic-macro","server/helpers.ts","return rows.find(row=>row.name===foodName)?.calories??0",true],
  ["A11-admin","server/helpers.ts","return rows.some(row=>row.name===activityName)",false],
  ["A12-ambiguous","server/helpers.ts","return rows.some(row=>row.name===name)",false],
  ["A13-normalized","server/helpers.ts","return rows.some(row=>row.name.toLowerCase()===foodName.toLowerCase())",true],
  ["A14-every","server/helpers.ts","return rows.every(row=>row.name!==foodName)",true],
];
for (const [id,location,body,blocked] of bodies) {
  const parameter = id==="A11-admin"?"activityName":id==="A12-ambiguous"?"name":"foodName";
  const name = id==="A01-positive"||id==="A08-generic-select"?"selectFood":"check";
  push(id,[records,{path:location,content:
    'import rows from "./data/records.json";export function '+name+'('+parameter+':string){'+body+'}'}],
    records.path,blocked,["17","5"]);
}
const vocab: Array<[string,string,unknown,string,string,boolean,string[]]> = [
  ["B01-food-names","server/foodNames.json",["pitaya","arroz"],"server/foodService.ts",
    'import names from "./foodNames.json";function isFood(foodName:string){return names.includes(foodName)}',true,["17"]],
  ["B02-food-choices","server/foodChoices.json",["pitaya","arroz"],"server/foodService.ts",
    'import names from "./foodChoices.json";function isFood(foodName:string){return names.includes(foodName)}',true,["17"]],
  ["B03-alias","server/foodAliases.json",["pitaya","arroz"],"server/foodService.ts",
    'import names from "./foodAliases.json";function isFood(foodName:string){return names.includes(foodName)}',true,["17"]],
  ["B04-nested","server/foodChoices.json",{lunch:["pitaya","arroz"]},"server/foodService.ts",
    'import names from "./foodChoices.json";function isFood(foodName:string){return names.lunch.includes(foodName)}',true,["17"]],
  ["B05-numeric","server/foodGrams.json",{pitaya:80,arroz:100},"server/foodService.ts",
    'import grams from "./foodGrams.json";function portion(foodName:string){return grams[foodName]}',true,["17","5"]],
  ["B06-status","server/status.json",["active","pending"],"server/admin/status.ts",
    'import names from "../status.json";function check(status:string){return names.includes(status)}',false,["17"]],
  ["B07-recipes","server/recipes.json",["pitaya","arroz"],"server/foodService.ts",
    'import names from "./recipes.json";function isFood(foodName:string){return names.includes(foodName)}',true,["17"]],
  ["B08-indexOf","server/foodNames.json",["pitaya","arroz"],"server/foodService.ts",
    'import names from "./foodNames.json";function isFood(foodName:string){return names.indexOf(foodName)>=0}',true,["17"]],
];
for (const [id,location,data,consumerPath,consumer,blocked,rules] of vocab) {
  push(id,[{path:location,content:json(data)},{path:consumerPath,content:consumer}],location,blocked,rules);
}
const cross: Array<[string,FoodArchitectureFile[],string,boolean,string[]]> = [
  ["C01-TS-lexical",[
    {path:"server/constants.ts",content:'export const choices=["pitaya","arroz"];'},
    {path:"server/helpers.ts",content:'import {choices} from "./constants";function check(foodName:string){return choices.includes(foodName)}'}
  ],"server/constants.ts",true,["17"]],
  ["C02-TS-numeric",[
    {path:"server/constants.ts",content:'export const table={pitaya:91,arroz:130};'},
    {path:"server/helpers.ts",content:'import {table} from "./constants";function check(foodName:string){return table[foodName]}'}
  ],"server/constants.ts",true,["17","5"]],
  ["C03-serialized-records",[{path:"server/foodService.ts",
    content:'function lookup(foodName:string){const rows=JSON.parse(\'[{"name":"pitaya","calories":91}]\');return rows.find((r:any)=>r.name===foodName)?.calories;}'}],
    "server/foodService.ts",true,["17","5"]],
  ["C04-serialized-list",[{path:"server/foodService.ts",
    content:'function check(foodName:string){const words=JSON.parse(\'["pitaya","arroz"]\');return words.includes(foodName)}'}],
    "server/foodService.ts",true,["17"]],
  ["C05-numeric-object",[{path:"server/foodService.ts",
    content:'function check(foodName:string){const words={pitaya:91,arroz:130};return words[foodName]}'}],
    "server/foodService.ts",true,["17","5"]],
  ["C06-TS-array",[{path:"server/foodService.ts",
    content:'function check(foodName:string){const words=["pitaya","arroz"];return words.includes(foodName)}'}],
    "server/foodService.ts",true,["18"]],
  ["C07-admin",[{path:"server/admin.ts",
    content:'function check(status:string){const rows=JSON.parse(\'["active","pending"]\');return rows.includes(status)}'}],
    "server/admin.ts",false,["17","18","5"]],
  ["C08-exercise",[
    {path:"server/constants.ts",content:'export const choices=["corrida","caminhada"];'},
    {path:"server/admin.ts",content:'import {choices} from "./constants";function check(activity:string){return choices.includes(activity)}'}
  ],"server/constants.ts",false,["17"]],
];
for (const [id,files,origin,blocked,rules] of cross) push(id,files,origin,blocked,rules);
push("X01-inert",[
  {path:"server/foodNames.json",content:'["pitaya","arroz"]'},
  {path:"server/foodService.ts",content:'import names from "./foodNames.json";function isFood(foodName:string){return queryDatabase(foodName)}'}
], "server/foodNames.json",false);
push("X02-dynamic-JSON",[{path:"server/foodService.ts",
  content:"function check(foodName:string,payload:string){const words=JSON.parse(payload);return words.includes(foodName)}"}],
  "server/foodService.ts",false,["17","18","5"]);
push("X03-shadowed-JSON",[{path:"server/foodService.ts",
  content:'function check(foodName:string,JSON:any){const words=JSON.parse(\'["pitaya","arroz"]\');return words.includes(foodName)}'}],
  "server/foodService.ts",false,["17","18","5"]);
push("X04-unused-JSON",[{path:"server/foodService.ts",
  content:'function check(foodName:string){const words=JSON.parse(\'["pitaya","arroz"]\');return queryDatabase(foodName)}'}],
  "server/foodService.ts",false,["17","18","5"]);
push("X05-structured-foodName",[
  records,{path:"server/helpers.ts",
  content:'import rows from "./data/records.json";function check(input:{foodName:string}){return rows.some(r=>r.name===input.foodName)}'}
],"server/data/records.json",true,["17","5"]);
push("X06-structured-status-not-food",[
  records,{path:"server/helpers.ts",
  content:'import rows from "./data/records.json";function check(input:{foodName:string,status:string}){return rows.some(r=>r.name===input.status)}'}
],"server/data/records.json",false,["17","5"]);
push("X07-structured-index-origin",[
  {path:"server/constants.ts",content:"export const table={pitaya:91,arroz:130};"},
  {path:"server/helpers.ts",content:'import {table} from "./constants";function check(input:{foodName:string}){return table[input.foodName]}'}
],"server/constants.ts",true,["17","5"]);
describe("AUD1300 F66 F67 F68 semantic consumption and source attribution", () => {
  for (const item of cases) it(item.id, () => {
    for (const file of item.files.filter(f=>/\.[cm]?[jt]sx?$/.test(f.path))) {
      const parsed=ts.createSourceFile(file.path,file.content,ts.ScriptTarget.Latest,true);
      expect(parsed.parseDiagnostics,item.id).toHaveLength(0);
    }
    const findings=findFoodStaticCandidates(item.files);
    const found=findings.filter(f=>f.file===item.origin && item.rules.includes(f.ruleId));
    const gate=evaluateFoodArchitectureGate(findings,[],[],new Date("2026-10-18T18:00:00Z"));
    expect(found.length>0,item.id+" "+JSON.stringify(findings)).toBe(item.blocked);
    if (item.blocked) expect(gate.errors.some(e=>e.startsWith("New food architecture violation")),item.id).toBe(true);
    else expect(gate.errors,item.id).toEqual([]);
  });
});
