/** #1305: keep the single canonical owner visible without disabling lexical-food gates. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";

const path = "server/modules/foodIntelligenceV2/resolver.ts";
const inspect = (content: string) => findFoodStaticCandidates([{ path, content }]);

describe("#1305 canonical resolver architecture control", () => {
  it("does not mistake the typed owner and structural states for rival food knowledge", () => {
    const findings = inspect(`
      type FoodResolutionDecision = { status: string };
      function nutritionFromMatch(match: unknown) { return match; }
      export function resolveFoodObservation(knowledge: {kind: string; reason: string}) {
        if (knowledge.kind === "conflict") return "clarify";
        if (knowledge.reason === "material_nutrition_conflict") return "clarify";
        return "unknown";
      }
      const decision: FoodResolutionDecision = { status: "unknown" };
    `);
    expect(findings.filter(item => ["1", "2", "17", "18"].includes(item.ruleId))).toEqual([]);
  });

  it("still detects static food catalogs even inside the canonical owner", () => {
    const findings = inspect(`
      export function resolveFoodObservation(foodName: string) {
        const FOOD_ALIASES = ["pitaya", "cupuaçu"];
        if (foodName === "pitaya") return FOOD_ALIASES[0];
        return foodName;
      }
    `);
    expect(findings.some(item => item.ruleId === "17")).toBe(true);
  });

  it("still detects explicit attribute materiality strings", () => {
    const findings = inspect(`
      export function resolveFoodObservation(value: string) {
        return value.includes("sem açúcar");
      }
    `);
    expect(findings.some(item => item.ruleId === "18")).toBe(true);
  });

  it("distinguishes the governed reason-code enum from real food vocabulary", () => {
    const contractsPath = "server/modules/foodIntelligenceV2/contracts.ts";
    const current = findFoodStaticCandidates([{
      path: contractsPath, content: readFileSync(contractsPath, "utf8"),
    }]);
    expect(current.filter(item => item.ruleId === "17" &&
      item.symbol === "FOOD_REASON_CODES")).toEqual([]);

    const forged = findFoodStaticCandidates([{
      path: contractsPath,
      content: 'export const FOOD_REASON_CODES = ["banana", "arroz"] as const;',
    }]);
    expect(forged.some(item => item.ruleId === "17" &&
      item.symbol === "FOOD_REASON_CODES")).toBe(true);

    const aliases = findFoodStaticCandidates([{
      path: contractsPath,
      content: 'export const FOOD_ALIASES = ["banana", "arroz"] as const;',
    }]);
    expect(aliases.some(item => item.ruleId === "17")).toBe(true);
  });

  it("the real source has no new static-food architecture findings", () => {
    const findings = inspect(readFileSync(path, "utf8"));
    expect(findings.filter(item => ["1", "2", "17", "18"].includes(item.ruleId))).toEqual([]);
  });
});
