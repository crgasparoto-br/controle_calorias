import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

type Source = {path: string; content: string};
const evaluate = (files: Source[]) => {
  const findings = findFoodStaticCandidates(files);
  return {findings, rejected: evaluateFoodArchitectureGate(
    findings, [], [], new Date("2026-10-16T00:00:00Z")).errors.length > 0};
};
const numeric = (findings: ReturnType<typeof findFoodStaticCandidates>) =>
  findings.filter(f => (f.ruleId === "17" || f.ruleId === "5") &&
    f.symbol.includes("numeric-food-map"));

describe("AUD1300 user goals and policy metadata vs food macro maps", () => {
  it("does not equate user goal multipliers with nutrition per food", () => {
    const result = evaluate([{path:"server/modules/goals/nutritionGoalService.ts",
      content:'type NutritionObjective = "emagrecimento" | "manutencao"; const PROTEIN_GRAMS_PER_KG: Record<NutritionObjective, number> = {emagrecimento: 1.8, manutencao: 1.6}; export function calculateGoalTarget(input: {objective: NutritionObjective, weightKg: number}) { return input.weightKg * PROTEIN_GRAMS_PER_KG[input.objective]; }'}]);
    expect(numeric(result.findings)).toEqual([]);
  });

  it("does not mistake an alias TTL and capacity policy for food composition", () => {
    const result = evaluate([{path:"server/modules/whatsapp/personalFoodAliasStore.ts",
      content:'export const PERSONAL_FOOD_ALIAS_POLICY = {maxAliasesPerUser:100,ttlDays:30,persistence:"memory",localMapIsAuthoritative:false,precedence:"explicit_current_message_wins",directGlobalPromotionAllowed:false} as const;'}]);
    expect(numeric(result.findings)).toEqual([]);
  });

  it("cannot hide food macros behind a policy variable name", () => {
    const result = evaluate([{path:"server/foodRules.ts",
      content:'const FOOD_ALIAS_POLICY = {maxAliasesPerUser:50, pao:90, arroz:125};'}]);
    expect(numeric(result.findings).some(f => f.ruleId === "5")).toBe(true);
    expect(result.rejected).toBe(true);
  });

  it("still detects same-module food indexing under goal/policy-shaped metadata", () => {
    for (const content of [
      'type NutritionObjective = string; const PROTEIN_GRAMS_PER_KG: Record<NutritionObjective,number> = {pao:20,arroz:30}; export function foodLookup(foodName:string){return PROTEIN_GRAMS_PER_KG[foodName];}',
      'const FOOD_ALIAS_POLICY = {maxAliasesPerUser:50,ttlDays:7}; export function foodLookup(foodName:string){return FOOD_ALIAS_POLICY[foodName as keyof typeof FOOD_ALIAS_POLICY];}',
    ]) {
      const result = evaluate([{path:"server/foodRules.ts", content}]);
      expect(numeric(result.findings).some(f => f.ruleId === "5")).toBe(true);
      expect(result.rejected).toBe(true);
    }
  });

  it("still detects cross-module use of a goal-typed numeric table for food identities", () => {
    const result = evaluate([
      {path:"server/modules/goals/nutritionGoalService.ts",
       content:'type NutritionObjective=string; export const PROTEIN_GRAMS_PER_KG: Record<NutritionObjective,number>={pao:20,arroz:30};'},
      {path:"server/foodRules.ts",
       content:'import { PROTEIN_GRAMS_PER_KG } from "./modules/goals/nutritionGoalService"; export function foodLookup(foodName:string){ return PROTEIN_GRAMS_PER_KG[foodName]; }'},
    ]);
    expect(result.findings.some(f => f.ruleId === "5" &&
      f.symbol.includes("imported-numeric-food-map"))).toBe(true);
    expect(result.rejected).toBe(true);
  });

  it("keeps actual number-word quantity decisions and hardcoded nutrition detectable", () => {
    for (const input of [
      {path:"server/foodTextNormalization.ts",
       content:'const NUMBER_WORDS={um:1,dois:2}; export function normalizeKnownFoodText(foodName:string){return NUMBER_WORDS[foodName];}'},
      {path:"server/mealItemBuilders.ts",
       content:'const GENERIC_ESTIMATED_FOOD_REFERENCE={name:"Generic Food",calories:150,protein:6,carbs:15,fat:5};'},
    ]) {
      expect(numeric(evaluate([input]).findings).some(f => f.ruleId === "5")).toBe(true);
    }
  });
});

describe("AUD1300 literal comparisons in nutrition admin forms", () => {
  const path="client/src/components/admin/NutritionLabelCandidateEditForm.tsx";
  it("does not classify a blank field check as nutritional materiality", () => {
    const result=evaluate([{path,content:'function normalizeNutrition(form:{fiber:string}){return form.fiber.trim()==="";}'}]);
    expect(result.findings.filter(f=>f.ruleId==="18" && f.symbol.includes("lexical-branch"))).toEqual([]);
  });
  it("still blocks actual materiality lexemes", () => {
    const result=evaluate([{path,content:'function decideMateriality(qualifier:string){return qualifier.trim()==="light";}'}]);
    expect(result.findings.some(f=>f.ruleId==="18" && f.symbol.includes("lexical-branch"))).toBe(true);
    expect(result.rejected).toBe(true);
  });
});
