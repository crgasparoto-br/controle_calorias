/** Independent audit F46-F48 reproductions and metamorphic sibling controls, Issue #1300. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
type Case = { id:string; kind:string; files: FoodArchitectureFile[]; expected:string[] };
const cases: Case[] = [
  {
    "id": "F46/direct",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};export function estimateFood(foodName:string,flag:boolean){return Object.keys(table).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/function-alias",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const keys=Object.keys;export function estimateFood(foodName:string,flag:boolean){return keys(table).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/destructuring",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const {keys}=Object;export function estimateFood(foodName:string,flag:boolean){return keys(table).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/ternary",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};export function estimateFood(foodName:string,flag:boolean){return (flag ? Object.keys(table):[]).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/ternary-alias",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const keys=flag ? Object.keys(table):[];export function estimateFood(foodName:string,flag:boolean){return keys.includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/logical",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};export function estimateFood(foodName:string,flag:boolean){return (flag && Object.keys(table)||[]).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/nullish",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};export function estimateFood(foodName:string,flag:boolean){return (flag ? Object.keys(table):undefined ?? []).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/chained-alias",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const keys=Object.keys;const list=keys;export function estimateFood(foodName:string,flag:boolean){return list(table).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/entries-alias",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const entries=Object.entries;export function estimateFood(foodName:string,flag:boolean){return entries(table).find(([key])=>key===foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/imported-map",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/nutrition.ts",
        "content": "export const table={pitaya:91,cupuacu:93}"
      },
      {
        "path": "server/foodRules.ts",
        "content": "import {table} from './nutrition';const keys=Object.keys;export function estimateFood(foodName:string){return keys(table).includes(foodName)}"
      }
    ],
    "expected": [
      "17",
      "5"
    ]
  },
  {
    "id": "F46/admin",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/admin/status.ts",
        "content": "const table={active:91,pending:93};const keys=Object.keys;function getStatus(status:string){return keys(table).includes(status)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F46/inert",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const keys=Object.keys;function estimateFood(foodName:string){return fromDatabase(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F46/Object-shadowed",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};function estimateFood(foodName:string,Object:{keys:(v:unknown)=>string[]}){return Object.keys(table).includes(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F46/alias-shadowed",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};const keys=Object.keys;function estimateFood(foodName:string,keys:(v:unknown)=>string[]){return keys(table).includes(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F46/mutable",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};let keys=Object.keys;keys=customKeys;function estimateFood(foodName:string){return keys(table).includes(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F46/discarded",
    "kind": "numeric-map",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const table={pitaya:91,cupuacu:93};function estimateFood(foodName:string){return (true ? [] : []).includes(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F47/direct",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(term).test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/concat",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(term+'|arroz').test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/template",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(`${term}|arroz`).test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/join-const",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';const terms=['pitaya','arroz'];function checkFoodTerm(foodName:string){return new RegExp(terms.join('|')).test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/join-inline",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(['pitaya','arroz'].join('|')).test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/chained",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(`${term + '|'}arroz`).test(foodName)}"
      }
    ],
    "expected": [
      "17",
      "18"
    ]
  },
  {
    "id": "F47/admin",
    "kind": "regex",
    "files": [
      {
        "path": "server/admin/status.ts",
        "content": "const term='active';function selectStatus(status:string){return new RegExp(term+'|pending').test(status)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F47/mutable",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "let term='pitaya';function checkFoodTerm(foodName:string){return new RegExp(term+'|arroz').test(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F47/shadowed",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string,term:string){return new RegExp(term+'|arroz').test(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F47/dynamic-array",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function checkFoodTerm(foodName:string,terms:string[]){return new RegExp(terms.join('|')).test(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F47/unused",
    "kind": "regex",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "const term='pitaya';function checkFoodTerm(foodName:string){return providerMatches(foodName)}"
      }
    ],
    "expected": []
  },
  {
    "id": "F48/direct",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(foodName.indexOf('pitaya')>=0)return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/boolean",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(Boolean(foodName.indexOf('pitaya')+1))return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/bitwise",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(~foodName.indexOf('pitaya'))return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/locale",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(foodName.localeCompare('pitaya')===0)return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/locale-language",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(foodName.localeCompare('pitaya','pt-BR')===0)return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/locale-options",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function getScore(foodName:string){if(foodName.localeCompare('pitaya','pt-BR',{sensitivity:'base'})===0)return 50;return 0;}"
      }
    ],
    "expected": [
      "17"
    ]
  },
  {
    "id": "F48/admin",
    "kind": "lexical",
    "files": [
      {
        "path": "server/admin/status.ts",
        "content": "function statusCheck(status:string){return status.localeCompare('active','pt-BR')===0}"
      }
    ],
    "expected": []
  },
  {
    "id": "F48/diagnostic",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function foodDebug(foodName:string){console.log(foodName.indexOf('pitaya'));return true}"
      }
    ],
    "expected": []
  },
  {
    "id": "F48/render",
    "kind": "lexical",
    "files": [
      {
        "path": "server/foodRules.ts",
        "content": "function renderFoodDebug(foodName:string){return renderNumber(foodName.indexOf('pitaya')+1)}"
      }
    ],
    "expected": []
  }
];
describe("AUD1300-20261018-F46/F47/F48 exact behavioral gates", () => {
  for (const item of cases) {
    it(item.id, () => {
      const findings = findFoodStaticCandidates(item.files);
      const actual = [...new Set(findings.map(f => f.ruleId))].sort();
      const expected = [...item.expected].sort();
      const errors = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T00:00:00Z")).errors;
      expect(actual, JSON.stringify(findings)).toEqual(expected);
      expect(errors.length > 0, JSON.stringify(errors)).toBe(expected.length > 0);
    });
  }
});
