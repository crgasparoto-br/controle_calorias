import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";

const probe = (name: string, content: string) =>
  findFoodStaticCandidates([{path: "server/modules/foodIntelligenceV2/" + name + ".ts", content}]);

describe("#1307 — architecture structural telemetry vs food policy boundaries", () => {
  it("accepts only established input syntax regexes, not new food vocabulary", () => {
    const syntax = probe("shadowComparison", `
      export function normalize(value:string) {
        return value.normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").replace(/\\s+/g," ");
      }
      export function buildFoodShadowEvent(value:string) {
        return /^[0-9a-f]{40}$/i.test(value) &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
      }`);
    expect(syntax.filter(x=>x.failureClass==="A"||x.failureClass==="B"), JSON.stringify(syntax)).toEqual([]);
    const lexical = probe("shadowComparison", `
      export function normalizeFoodName(value:string) {
        return /\\b(?:integral|desnatado)\\b/i.test(value);
      }`);
    expect(lexical.some(x=>x.ruleId==="17" && x.failureClass==="A"), JSON.stringify(lexical)).toBe(true);
  });

  it("typed telemetry enums are not materiality vocabulary; ungoverned food decisions still fail", () => {
    const structural = probe("shadowComparison", `
      export function buildFoodShadowBaseline(event:any) {
        if(event.run==="compared") return event.stage==="S1" ? 1 : 0;
        if(event.callRole==="retry") return event.failure==="none" ? 2 : 0;
        return event.status==="resolved" ? 3 : 0;
      }
      export function buildFoodShadowEvent(item:any) {
        return item.processingLevel==="ultra_processed" ? 1 : 0;
      }`);
    expect(structural.filter(x=>x.ruleId==="18" && x.failureClass==="B"), JSON.stringify(structural)).toEqual([]);
    const nonStructural=probe("shadowComparison", `
      export function decideFoodVariant(item:any) {
        return item.productVariant==="integral" ? "matched" : "unmatched";
      }`);
    expect(nonStructural.some(x=>x.ruleId==="18"),JSON.stringify(nonStructural)).toBe(true);
  });

  it("A-028 distinguishes a typed nutrition provenance state from food materiality", () => {
    const allowed = probe("shadowComparison", `
      export function buildFoodShadowEvent(item:any) {
        const provenance = { origin: item.resolution?.nutritionOrigin ?? null };
        return !provenance.origin || provenance.origin === "unavailable";
      }`);
    expect(allowed.filter(item => item.ruleId === "17" || item.ruleId === "18"),
      JSON.stringify(allowed)).toEqual([]);
    const blocked = probe("shadowComparison", `
      export function decideFoodVariant(item:any) {
        const provenance = { origin: item.resolution?.nutritionOrigin ?? null };
        return item.productVariant === "integral";
      }`);
    expect(blocked.some(item => item.ruleId === "18"), JSON.stringify(blocked)).toBe(true);
  });

  it("schema reason codes pass while arbitrary food labels remain blocked", () => {
    const ok=probe("shadowComparison", `
      export function buildFoodShadowEvent(item:any) {
        return item.reasonCodes.includes("source_conflict");
      }`);
    expect(ok.some(x=>x.ruleId==="17" && x.symbol.includes("literal-string")),JSON.stringify(ok)).toBe(false);
    const blocked=probe("shadowComparison", `
      export function resolveFoodIdentity(item:any) {
        return item.reasonCodes.includes("leite integral");
      }`);
    expect(blocked.some(x=>x.ruleId==="17"),JSON.stringify(blocked)).toBe(true);
  });

  it("A-027 treats runtime pairing edges as telemetry, not static food knowledge", () => {
    const structural = probe("shadowPairing", `
      export function pairFoodShadowItems(left:any[], right:any[]) {
        const diagnosticEdges: Array<{i:number;j:number;cost:number}> = [];
        for (let i=0; i<left.length; i++) for (let j=0; j<right.length; j++) {
          diagnosticEdges.push({i, j, cost: left[i].calories - right[j].calories});
        }
        return diagnosticEdges;
      }`);
    expect(structural.filter(item => item.ruleId === "17"), JSON.stringify(structural)).toEqual([]);
    const staticKnowledge = probe("shadowPairing", `
      const FOOD_VARIANT_CATALOG = ["integral", "desnatado"];
      export function chooseFoodVariant(item:any) {
        return FOOD_VARIANT_CATALOG.includes(item.productVariant);
      }`);
    expect(staticKnowledge.some(item => item.ruleId === "17"), JSON.stringify(staticKnowledge)).toBe(true);
  });

  it("a hardcoded calorie catalog and lexical materiality table are still findings", () => {
    const blocked=probe("unsafeFood", `
      const FOOD_CATALOG_REFERENCE=[{ foodName:"arroz",calories:130,protein:3,carbs:28,fat:0.3 }];
      const COMMERCIAL_ATTRIBUTE_TOKENS=["integral","desnatado","light"];
      export function decideFood(value:any) { return COMMERCIAL_ATTRIBUTE_TOKENS.includes(value.variant); }
    `);
    expect(blocked.some(x=>x.ruleId==="17"),JSON.stringify(blocked)).toBe(true);
    expect(blocked.some(x=>x.ruleId==="18"),JSON.stringify(blocked)).toBe(true);
  });

  it("A-032 rejects unsafe name/portion-based post-save nutrition updates", () => {
    const service = readFileSync(resolve(process.cwd(), "server/modules/meals/service.ts"), "utf8");
    const snapshots = readFileSync(resolve(process.cwd(), "server/modules/meals/nutritionSnapshot.ts"), "utf8");
    const repository = readFileSync(resolve(process.cwd(), "server/repositories/mealsRepository.ts"), "utf8");
    // A write after the confirmed repository transaction can hit two homonyms
    // and overwrite both identities. The old post-save SQL must stay removed.
    expect(service).not.toContain("persistMealItemNutritionSnapshots");
    expect(snapshots).not.toContain("persistMealItemNutritionSnapshots");
    expect(snapshots).not.toMatch(/UPDATE\s+mealItems/);
    expect(repository).toContain("foodSnapshotJson: mergeConfirmedMealClassification");
    expect(repository).toContain("buildMealItemValues(input.meal.id, input.items");
  });

});
