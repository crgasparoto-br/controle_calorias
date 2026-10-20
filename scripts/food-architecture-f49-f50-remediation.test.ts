/** Issue #1300: F49/F50 reproducible mutation controls against public enforcement. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
type Case = { id: string; source: string; expected: boolean; rules: string[]; path: string; imported: boolean };
const cases: Case[] = [
  {
    "id": "R01 regex literal",
    "source": "function classify(foodName:string){return /pitaya/.test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R02 new RegExp literal",
    "source": "function classify(foodName:string){return new RegExp('pitaya').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R03 callable RegExp literal",
    "source": "function classify(foodName:string){return RegExp('pitaya').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R04 callable RegExp alternation",
    "source": "function classify(foodName:string){return RegExp('pitaya|arroz','i').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R05 new String.raw",
    "source": "function classify(foodName:string){return new RegExp(String.raw`pitaya|arroz`).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R06 callable String.raw",
    "source": "function classify(foodName:string){return RegExp(String.raw`pitaya|arroz`).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R07 constructor concat",
    "source": "const v='pitaya';function classify(foodName:string){return new RegExp(v+'|arroz').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R08 constructor join",
    "source": "function classify(foodName:string){return new RegExp(['pitaya','arroz'].join('|')).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R09 callable alias",
    "source": "const rx=RegExp;function classify(foodName:string){return rx('pitaya').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R09b chained alias",
    "source": "const rx=RegExp;const alias=rx;function classify(foodName:string){return alias('pitaya').test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R10 conditional",
    "source": "function classify(foodName:string){return (true ? RegExp('pitaya') : /arroz/).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R10b logical",
    "source": "function classify(foodName:string){return (RegExp('pitaya') || /arroz/).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R10c conditional dynamic",
    "source": "function classify(foodName:string){return (flag ? RegExp('pitaya') : new RegExp(foodName)).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R11 materiality callable",
    "source": "function isMaterial(attribute:string){return RegExp('integral|light').test(attribute)}",
    "expected": true,
    "rules": [
      "18"
    ],
    "path": "server/materiality.ts",
    "imported": false
  },
  {
    "id": "R12 materiality raw",
    "source": "function isMaterial(attribute:string){return new RegExp(String.raw`integral|light`).test(attribute)}",
    "expected": true,
    "rules": [
      "18"
    ],
    "path": "server/materiality.ts",
    "imported": false
  },
  {
    "id": "R12b raw interpolated",
    "source": "const term='pitaya';function classify(foodName:string){return RegExp(String.raw`${term}|arroz`).test(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R12c string.match",
    "source": "function classify(foodName:string){return foodName.match(RegExp('pitaya'))!==null}",
    "expected": true,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R13 admin regex",
    "source": "function checkStatus(status:string){return RegExp('active|pending').test(status)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/account/status.ts",
    "imported": false
  },
  {
    "id": "R14 inert regex",
    "source": "const rx=RegExp('pitaya');function classify(foodName:string){return queryDatabase(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R15 dynamic regex",
    "source": "function classify(foodName:string,term:string){return new RegExp(term).test(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R16 shadowed param",
    "source": "function classify(foodName:string,RegExp:(s:string)=>RegExp){return RegExp('pitaya').test(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R17 shadowed local",
    "source": "const RegExp=(term:string)=>lookupRegex(term);function classify(foodName:string){return RegExp('pitaya').test(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R18 mutable factory alias",
    "source": "let rx=RegExp;rx=unknownRegex;function classify(foodName:string){return rx('pitaya').test(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "R19 String.raw shadowed",
    "source": "function classify(foodName:string,String:{raw:(strings:TemplateStringsArray)=>string}){return RegExp(String.raw`pitaya`).test(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "18"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K01 Object.keys",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return Object.keys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K02 Reflect.ownKeys",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return Reflect.ownKeys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K03 getOwnPropertyNames",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return Object.getOwnPropertyNames(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K04 Reflect alias",
    "source": "const table={pitaya:91,arroz:130};const ownKeys=Reflect.ownKeys;function classify(foodName:string){return ownKeys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K05 Object destructuring",
    "source": "const table={pitaya:91,arroz:130};const {getOwnPropertyNames}=Object;function classify(foodName:string){return getOwnPropertyNames(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K06 Reflect conditional",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return (Math.random()>.5?Reflect.ownKeys(table):[]).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K06b Reflect destructuring",
    "source": "const table={pitaya:91,arroz:130};const {ownKeys}=Reflect;function classify(foodName:string){return ownKeys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K06c Reflect chained alias",
    "source": "const table={pitaya:91,arroz:130};const ownKeys=Reflect.ownKeys;const keys=ownKeys;function classify(foodName:string){return keys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K07 Object.entries",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return Object.entries(table).find(([key])=>key===foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K08 numeric direct lookup",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return table[foodName]??0}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K09 inert table",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return queryDatabase(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K10 admin Reflect",
    "source": "const table={active:91,pending:93};function checkStatus(status:string){return Reflect.ownKeys(table).includes(status)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/account/status.ts",
    "imported": false
  },
  {
    "id": "K11 admin Object names",
    "source": "const table={active:91,pending:93};function checkStatus(status:string){return Object.getOwnPropertyNames(table).includes(status)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/account/status.ts",
    "imported": false
  },
  {
    "id": "K12 shadowed Reflect",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string,Reflect:{ownKeys:(v:unknown)=>string[]}){return Reflect.ownKeys(table).includes(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K13 shadowed Object",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string,Object:{getOwnPropertyNames:(v:unknown)=>string[]}){return Object.getOwnPropertyNames(table).includes(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K14 shadowed alias",
    "source": "const table={pitaya:91,arroz:130};const ownKeys=Reflect.ownKeys;function classify(foodName:string,ownKeys:(v:unknown)=>string[]){return ownKeys(table).includes(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K15 mutable alias",
    "source": "const table={pitaya:91,arroz:130};let ownKeys=Reflect.ownKeys;ownKeys=custom;function classify(foodName:string){return ownKeys(table).includes(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": false
  },
  {
    "id": "K16 fixture isolated",
    "source": "const table={pitaya:91,arroz:130};function classify(foodName:string){return Reflect.ownKeys(table).includes(foodName)}",
    "expected": false,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/__fixtures__/food.ts",
    "imported": false
  },
  {
    "id": "K17 imported Reflect",
    "source": "import {table} from './nutrition';function classify(foodName:string){return Reflect.ownKeys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": true
  },
  {
    "id": "K18 imported Object names",
    "source": "import {table} from './nutrition';function classify(foodName:string){return Object.getOwnPropertyNames(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": true
  },
  {
    "id": "K19 imported Reflect alias",
    "source": "import {table} from './nutrition';const ownKeys=Reflect.ownKeys;function classify(foodName:string){return ownKeys(table).includes(foodName)}",
    "expected": true,
    "rules": [
      "17",
      "5"
    ],
    "path": "server/foodRules.ts",
    "imported": true
  }
];
describe("AUD1300-20261018-F49/F50 semantic equivalence and negative controls", () => {
  for (const c of cases) it(c.id, () => {
    const files: FoodArchitectureFile[] = c.imported ? [
      {path:"server/nutrition.ts", content:"export const table={pitaya:91,arroz:130};"},
      {path:c.path,content:c.source}] : [{path:c.path,content:c.source}];
    const findings = findFoodStaticCandidates(files);
    const recognized = findings.some(f => c.rules.includes(f.ruleId));
    const errors = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T12:00:00Z")).errors;
    const blocked = errors.some(e => e.startsWith("New food architecture violation"));
    expect(recognized, JSON.stringify(findings)).toBe(c.expected);
    expect(blocked, JSON.stringify(errors)).toBe(c.expected);
  });
});
