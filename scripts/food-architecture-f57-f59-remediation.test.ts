/** Issue #1300 — F57/F58/F59: independent audit escape controls.
 * Each probe invokes the real detector and the public wave-one enforcement gate.
 * Positive and benign siblings must coexist: no path-only exclusions. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Probe = { id: string; file: string; code: string; expectedBlock: boolean;
  catalog?: boolean; expectedJson?: boolean; runtime?: boolean;
  runtimeArg?: string; runtimeFunction?: string };
const jsonFile: FoodArchitectureFile = {
  path: "server/data/records.json",
  content: JSON.stringify([{ name: "pitaya", calories: 91 }, { name: "arroz", calories: 130 }]),
};
const jsonPrefix='import rows from "./data/records.json";';
const food=(body: string)=>'function selectFood(foodName:string){'+body+'}';
const isMaterial=(body: string)=>'function isMaterial(attribute:string){'+body+'}';
const tests: Probe[] = [
 {id:'C01-direct-JSON',file:'server/foodService.ts',code:jsonPrefix+food('return rows.map(r=>r.name).includes(foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C02-JSON-unused',file:'server/foodService.ts',code:jsonPrefix+food('const unused=rows.map(r=>r.name);return false'),catalog:true,expectedBlock:false,expectedJson:false,runtime:false},
 {id:'C03-helper-return-JSON',file:'server/foodService.ts',code:jsonPrefix+'function loadNames(){return rows.map(r=>r.name)};'+food('return loadNames().includes(foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C04-helper-parameter-JSON',file:'server/foodService.ts',code:jsonPrefix+'function toNames(items:typeof rows){return items.map(r=>r.name)};'+food('return toNames(rows).includes(foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C05-helper-arrow-JSON',file:'server/foodService.ts',code:jsonPrefix+'const loadNames=()=>rows.map(r=>r.name);'+food('return loadNames().includes(foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C06-object-property-JSON',file:'server/foodService.ts',code:jsonPrefix+'const store={items:rows};'+food('return store.items.some(r=>r.name===foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C07-destructured-property-JSON',file:'server/foodService.ts',code:jsonPrefix+'const store={items:rows};const {items}=store;'+food('return items.some(r=>r.name===foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C08-helper-identity-JSON',file:'server/foodService.ts',code:jsonPrefix+'function identity<T>(data:T):T{return data}'+food('return identity(rows).some(r=>r.name===foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C09-closure-JSON',file:'server/foodService.ts',code:jsonPrefix+'const load=()=>()=>rows;'+food('return load()().some(r=>r.name===foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},
 {id:'C10-JSON-independent-source',file:'server/foodService.ts',code:jsonPrefix+'declare function queryDatabase():{name:string}[];const store={items:queryDatabase()};'+food('return store.items.some(r=>r.name===foodName)'),catalog:true,expectedBlock:false,expectedJson:false,runtime:false},
 {id:'C11-literal-array',file:'server/foodService.ts',code:food('const names=["pitaya","arroz"];return names.includes(foodName)'),expectedBlock:true,runtime:true},
 {id:'C12-push-literal-food',file:'server/foodService.ts',code:food('const names:string[]=[];names.push("pitaya","arroz");return names.includes(foodName)'),expectedBlock:true,runtime:true},
 {id:'C13-unshift-literal-food',file:'server/foodService.ts',code:food('const names:string[]=[];names.unshift("pitaya","arroz");return names.includes(foodName)'),expectedBlock:true,runtime:true},
 {id:'C14-Set-add-literal-food',file:'server/foodService.ts',code:food('const names=new Set<string>();names.add("pitaya");names.add("arroz");return names.has(foodName)'),expectedBlock:true,runtime:true},
 {id:'C15-literal-split-food',file:'server/foodService.ts',code:food('const names="pitaya|arroz".split("|");return names.includes(foodName)'),expectedBlock:true,runtime:true},
 {id:'C16-literal-Set-food',file:'server/foodService.ts',code:food('const names=new Set(["pitaya","arroz"]);return names.has(foodName)'),expectedBlock:true,runtime:true},
 {id:'C17-materiality-push',file:'server/materiality.ts',code:isMaterial('const tokens:string[]=[];tokens.push("integral","light");return tokens.includes(attribute)'),expectedBlock:true,runtime:true,runtimeFunction:'isMaterial',runtimeArg:'integral'},
 {id:'C18-materiality-array',file:'server/materiality.ts',code:isMaterial('const tokens=["integral","light"];return tokens.includes(attribute)'),expectedBlock:true,runtime:true,runtimeFunction:'isMaterial',runtimeArg:'integral'},
 {id:'C19-admin-Set-account-module',file:'server/account/status.ts',code:'function checkStatus(status:string){const values=new Set(["active","pending"]);return values.has(status)}',expectedBlock:false,runtime:true,runtimeFunction:'checkStatus',runtimeArg:'active'},
 {id:'C20-admin-Set-food-module',file:'server/foodService.ts',code:'function checkStatus(status:string){const values=new Set(["active","pending"]);return values.has(status)}',expectedBlock:false,runtime:true,runtimeFunction:'checkStatus',runtimeArg:'active'},
 {id:'C21-food-unused-literal',file:'server/foodService.ts',code:food('const unused=["pitaya","arroz"];return false'),expectedBlock:false,runtime:false},
 {id:'C22-admin-unused-Set',file:'server/foodService.ts',code:'function checkStatus(status:string){const unused=new Set(["active","pending"]);return false}',expectedBlock:false,runtime:false,runtimeFunction:'checkStatus'},
 {id:'C23-JSON-join-split-collision',file:'server/foodService.ts',code:jsonPrefix+food('return rows.map(r=>r.name).join("|").split("|").includes(foodName)'),catalog:true,expectedBlock:true,expectedJson:true,runtime:true},

 {id:'F57-shadowed-argument',file:'server/foodService.ts',code:jsonPrefix+'declare function queryDatabase():{name:string}[];function toNames(items:{name:string}[]){return items.map(r=>r.name)};'+food('return toNames(queryDatabase()).includes(foodName)'),catalog:true,expectedBlock:false,expectedJson:false},
 {id:'F57-object-definite-overwrite',file:'server/foodService.ts',code:jsonPrefix+'declare function queryDatabase():typeof rows;'+food('const store={items:rows};store.items=queryDatabase();return store.items.some(r=>r.name===foodName)'),catalog:true,expectedBlock:false,expectedJson:false},
 {id:'F57-object-conditional-overwrite',file:'server/foodService.ts',code:jsonPrefix+'declare function queryDatabase():typeof rows;'+food('const store={items:rows};if(foodName.length>5)store.items=queryDatabase();return store.items.some(r=>r.name===foodName)'),catalog:true,expectedBlock:true,expectedJson:true},
 {id:'F58-dynamic-only-mutation',file:'server/foodService.ts',code:'declare function queryDatabase():string;'+food('const names:string[]=[];names.push(queryDatabase());return names.includes(foodName)'),expectedBlock:false},
 {id:'F58-mutation-after-use',file:'server/foodService.ts',code:food('const names:string[]=[];const answer=names.includes(foodName);names.push("pitaya");return answer'),expectedBlock:false},
 {id:'F58-shadowed-Set',file:'server/foodService.ts',code:'function checkName(input:string,Set:any){const names=new Set(["pitaya","arroz"]);return names.has(input)}',expectedBlock:false},
 {id:'F59-admin-split',file:'server/foodService.ts',code:'function checkStatus(status:string){const values="active|pending".split("|");return values.includes(status)}',expectedBlock:false},
 {id:'F59-anonymous-materiality-lexeme',file:'server/foodItemResolution.ts',code:'function decide(value:string){const words=["integral","light"];return words.includes(value)}',expectedBlock:true},
 {id:'F59-administrative-lexeme-in-food-module',file:'server/foodItemResolution.ts',code:'function checkStatus(status:string){const words=["active","pending"];return words.includes(status)}',expectedBlock:false},
];
describe("F57/F58/F59 independent architectural regressions", () => {
  for (const item of tests) {
    it(item.id, () => {
      const files: FoodArchitectureFile[] = [...(item.catalog ? [jsonFile] : []),
        { path: item.file, content: item.code }];
      const findings = findFoodStaticCandidates(files);
      const result = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-18T12:00:00Z"));
      expect(result.errors.length > 0).toBe(item.expectedBlock);
      if (item.expectedJson !== undefined) {
        expect(findings.some(f => f.file === jsonFile.path &&
          (f.ruleId === "17" || f.ruleId === "5"))).toBe(item.expectedJson);
      }
    });
  }
});
