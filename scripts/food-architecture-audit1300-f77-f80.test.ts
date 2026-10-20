/** Issue #1300: declarative domain fields, static map keys and lexical aliases. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findFoodStaticCandidates, type FoodArchitectureFile } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";
import { validateFoodDebtLedger } from "./food-architecture-debt";

function inspect(path: string, content: string) {
  const files: FoodArchitectureFile[] = [{ path, content }];
  const findings = findFoodStaticCandidates(files);
  const gate = evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-19T12:00:00Z"));
  return { findings, gate };
}

describe("AUD1300 F77/F78 — declarative domain fields", () => {
  it("detects food fields in object, static class and Number-native values", () => {
    const { findings, gate } = inspect("server/foodDomain.ts", `
      const food = { name: "arroz", classification: "whole", aliases: ["rice"], portion: Number(50) };
      class FoodPolicy { static classification = "whole"; static portion = 50; }
    `);
    const fields = findings.filter(f => f.symbol.includes(":domain-field"));
    expect(fields.some(f => f.symbol.includes("classification"))).toBe(true);
    expect(fields.some(f => f.symbol.includes("aliases"))).toBe(true);
    expect(fields.some(f => f.symbol.includes("portion"))).toBe(true);
    expect(gate.errors.some(error => error.startsWith("New food architecture violation"))).toBe(true);
  });

  it("does not infer food knowledge from account/status fields", () => {
    const { findings } = inspect("server/accountMetrics.ts", `
      const account = { name: user.name, classification: "active", aliases: ["admin"], portion: 50 };
      const status = { classification: "pending", portion: 1 };
    `);
    expect(findings.filter(f => f.symbol.includes(":domain-field"))).toEqual([]);
  });

  it("accepts computed const keys only when the map is consumed by food identity", () => {
    const { findings } = inspect("server/foodPortions.ts", `
      const key = "pao";
      const portions = { [key]: Number(50) };
      export function resolvePortion(foodName: string) { return portions[foodName]; }
    `);
    expect(findings.some(f => f.symbol.includes("numeric-food-map"))).toBe(true);
  });

  it("keeps dynamic map keys and shadowed Number outside the static proof", () => {
    const { findings } = inspect("server/foodPortions.ts", `
      const makeKey = () => "pao";
      const Number = (value: unknown) => value;
      const portions = { [makeKey()]: Number(50) };
    `);
    expect(findings.filter(f => f.symbol.includes("numeric-food-map"))).toEqual([]);
  });
});

describe("AUD1300 F79 — immutable materiality aliases", () => {
  it("resolves a const lexical token used by String.includes", () => {
    const { findings } = inspect("server/foodMateriality.ts", `
      export function decideMateriality(value: string) {
        const token = "integral";
        return value.includes(token);
      }
    `);
    expect(findings.some(f => f.ruleId === "18" && f.symbol.includes("literal-string-includes"))).toBe(true);
  });

  it("rejects mutable or dynamic materiality tokens", () => {
    const { findings } = inspect("server/foodMateriality.ts", `
      export function decideMateriality(value: string, input: string) {
        let token = input;
        return value.includes(token);
      }
    `);
    expect(findings.filter(f => f.ruleId === "18" && f.symbol.includes("literal-string-includes"))).toEqual([]);
  });
});

describe("AUD1300 F80 — executable debt schema", () => {
  it("validates the committed ledger before consumers cast it", () => {
    const ledger = validateFoodDebtLedger({
      $schema: "./docs/design-docs/food-architecture-debt.schema.json",
      entries: [],
    });
    expect(ledger.entries).toEqual([]);
    expect(() => validateFoodDebtLedger({ entries: [{ ruleId: "unknown" }] })).toThrow(/Invalid|Unknown/);
  });

  it("keeps productive finding dispatches declarative", () => {
    for (const file of [
      "scripts/food-intelligence-architecture.ts",
      "scripts/food-architecture-lexical-imports.ts",
      "scripts/food-lexicon-architecture.ts",
      "scripts/food-materiality-architecture.ts",
    ]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toMatch(/for \(const ruleId of \[\"(?:5|11|17|18)\"/);
      expect(source, file).not.toMatch(/const ruleId = (?:materiality|channel)/);
    }
  });
});
