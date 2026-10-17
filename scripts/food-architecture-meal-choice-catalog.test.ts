import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
const inspect = (content: string, file = "server/modules/whatsapp/foodAssistant.ts") =>
  findFoodStaticCandidates([{ path: file, content }]);

describe("AUD1300 local food suggestion tables", () => {
  it("blocks a new lower-case local food menu and does not rely on the symbol name", () => {
    const content = [
      "export function suggest(meal: string) {",
      "const optionsByContext = {",
      " breakfast: [\"Iogurte com banana e aveia\", \"Ovos mexidos com pão\"],",
      " lunch: [\"Arroz com feijão e frango\", \"Carne magra e batata\"],",
      "}; return optionsByContext[meal]; }",
    ].join("\n");
    const findings = inspect(content).filter(f => f.ruleId === "17" &&
      f.symbol === "optionsByContext:meal-choice-catalog");
    expect(findings).toHaveLength(1);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z"))
      .errors.length).toBeGreaterThan(0);
  });
  it("detects the existing production food assistant options", () => {
    const source = readFileSync(path.resolve(process.cwd(),
      "server/modules/whatsapp/foodAssistant.ts"), "utf8");
    const findings = inspect(source);
    expect(findings.some(f => f.ruleId === "17" &&
      f.symbol === "optionsByContext:meal-choice-catalog")).toBe(true);
  });
  it("does not classify status actions in a meal UI as food-specific knowledge", () => {
    const findings = inspect(
      "const optionsByContext = {breakfast:[\"Editar\",\"Excluir\"],lunch:[\"Editar\",\"Excluir\"]};",
      "client/src/features/mealDashboard.tsx");
    expect(findings.filter(f => f.ruleId === "17" &&
      f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
  it("does not classify a non-meal indexed dictionary as meal knowledge", () => {
    const findings = inspect(
      "const optionsByContext = {account:[\"Banana e aveia\",\"Pão e ovo\"],status:[\"Arroz e feijão\",\"Batata e frango\"]};",
      "server/account.ts");
    expect(findings.filter(f => f.ruleId === "17" &&
      f.symbol.includes("meal-choice-catalog"))).toEqual([]);
  });
});
