import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";

const inspect = (content: string) =>
  findFoodStaticCandidates([
    { path: "server/modules/foodIntelligenceV2/contracts.ts", content },
  ]).filter(finding => finding.ruleId === "17");

describe("A-1298-006: gate 17 distingue metadata de evidencia", () => {
  it("aceita caminhos estruturais de contrato, inclusive novos campos", () => {
    const code = `export const FOOD_EVIDENCE_FIELDS = [
      "identity.foodName", "quantity.density",
      "nutrition.calories", "classification.isFood"
    ] as const;`;
    expect(inspect(code).filter(f => f.symbol === "FOOD_EVIDENCE_FIELDS")).toEqual([]);
  });

  it("continua bloqueando colecao com alimento literal misturado", () => {
    const code = `export const FOOD_EVIDENCE_FIELDS = [
      "identity.foodName", "arroz cozido"
    ] as const;`;
    expect(inspect(code).some(f => f.symbol === "FOOD_EVIDENCE_FIELDS")).toBe(true);
  });

  it("nao isenta catalogo alimentar com nome diferente", () => {
    const code = `export const FOOD_CATALOG_REFERENCE = [
      "Iogurte natural", "Arroz com feijao"
    ] as const;`;
    expect(inspect(code).some(f => f.symbol === "FOOD_CATALOG_REFERENCE")).toBe(true);
  });

  it("não interpreta metadados e validação estrutural de nutrientes como heurísticas", () => {
    const source = readFileSync(
      path.resolve("server/modules/foodIntelligenceV2/nutritionConsistency.ts"),
      "utf8"
    );
    const findings = findFoodStaticCandidates([
      { path: "server/modules/foodIntelligenceV2/nutritionConsistency.ts", content: source },
    ]);
    expect(findings.filter(finding =>
      ["17", "18"].includes(finding.ruleId) &&
      finding.symbol.includes("assertVerifiedNutritionEvidenceConsistency")
    )).toEqual([]);
  });

  it("nao marca a lista governada real como conhecimento de alimento", () => {
    const source = readFileSync(
      path.resolve("server/modules/foodIntelligenceV2/contracts.ts"),
      "utf8"
    );
    expect(inspect(source).filter(f => f.symbol === "FOOD_EVIDENCE_FIELDS")).toEqual([]);
  });
});
