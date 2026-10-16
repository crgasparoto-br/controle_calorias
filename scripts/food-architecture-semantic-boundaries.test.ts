import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

/** Source-behavior controls: structural bounds must not be confused with
 * knowledge indexed by actual food identities (ADR §25.2, Issue #1300).
 */
const examine = (content: string) => {
  const findings = findFoodStaticCandidates([{
    path: "server/modules/foodIntelligenceV2/contracts.ts",
    content,
  }]);
  return {
    relevant: findings.filter(f => f.ruleId === "17" || f.ruleId === "5"),
    errors: evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z")).errors,
  };
};

describe("AUD1300 semantic food-map boundaries", () => {
  it("does not classify pure schema size limits as food-specific nutrition knowledge", () => {
    const result = examine(`export const FOOD_CONTRACT_LIMITS = {
      rawText: 20000, identifier: 200, shortText: 120, nameText: 300,
      collection: 200, qualifiers: 50, alternatives: 20, observations: 100
    } as const;`);
    expect(result.relevant).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it("still rejects nutritional numeric maps keyed by food identity", () => {
    const result = examine("export const FOOD_NUTRITION_BY_NAME = {pao: 150, arroz: 125};");
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("does not let a contract-limits name hide a nutritional record", () => {
    const result = examine("export const FOOD_CONTRACT_LIMITS = {calories: 150, protein: 6, carbs: 15, fat: 5};");
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("still blocks a structural-looking object indexed by food name", () => {
    const result = examine(`
      export const FOOD_CONTRACT_LIMITS = {rawText: 20000, identifier: 100};
      export function lookupFood(foodName: string) {
        return FOOD_CONTRACT_LIMITS[foodName as keyof typeof FOOD_CONTRACT_LIMITS];
      }`);
    expect(result.relevant.some(f => f.ruleId === "5")).toBe(true);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
