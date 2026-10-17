import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
const inspect = (content: string) =>
  findFoodStaticCandidates([{ path: "server/modules/foodIntelligenceV2/observationSchemas.ts", content }])
    .filter(f => f.ruleId === "3");

describe("AUD1300 gate 3: called symbol rather than receiver payload", () => {
  it("does not misclassify a Zod schema validator as text re-inference", () => {
    const found = inspect('const foodObservationSchema = z.strictObject({resolveFood: z.string(), normalizedText: z.string()}).superRefine((o,ctx) => {if(!o.normalizedText) ctx.addIssue({message:"decision invalid"});});');
    expect(found).toEqual([]);
  });
  it("blocks direct inference from the structured decision text", () => {
    const found = inspect('export function replayFood(decision:{normalizedText:string}) {return parseFoodText({normalizedText:decision.normalizedText});}');
    expect(found.some(f => f.symbol === "parseFoodText")).toBe(true);
    expect(evaluateFoodArchitectureGate(found, [], [], new Date("2026-10-16T00:00:00Z")).errors.length).toBeGreaterThan(0);
  });
  it("preserves property, computed-property and returned-wrapper calls", () => {
    for (const call of [
      'runtime.parseFoodText({normalizedText:decision.normalizedText})',
      'runtime["parseFoodText"]({normalizedText:decision.normalizedText})',
      'getResolver().parseFoodText({normalizedText:decision.normalizedText})',
    ]) {
      const found = inspect('export function replayFood(decision:{normalizedText:string}) {return ' + call + ';}');
      expect(found.some(f => f.symbol.includes("parseFoodText"))).toBe(true);
    }
  });
});
