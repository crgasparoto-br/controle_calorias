/** #1305: keep the single canonical owner visible without disabling lexical-food gates. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const path = "server/modules/foodIntelligenceV2/resolver.ts";
const inspect = (content: string, sourcePath = path) =>
  findFoodStaticCandidates([{ path: sourcePath, content }]);
const gate = (findings: ReturnType<typeof inspect>) =>
  evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-27T03:00:00Z"));

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
    expect(gate(findings).errors).toEqual([]);
  });

  it.each(["FoodResolutionDecision", "Resolution", null])(
    "accepts transparent runtime copies regardless of the decision annotation %s",
    annotation => {
      const typeImport = annotation === "Resolution"
        ? "FoodResolutionDecision as Resolution" : "FoodResolutionDecision";
      const findings = inspect(`
        import type { ${typeImport} } from "./schemas";
        export function resolveFoodObservation(seed: ${annotation ?? "FoodResolutionDecision"}) {
          const foodDecision${annotation ? ": " + annotation : ""} = {
            ...seed, identity: { ...seed.identity }, alternatives: [...seed.alternatives],
            status: "unknown",
          };
          return foodDecision;
        }
      `);
      expect(findings.filter(item => item.ruleId === "17")).toEqual([]);
      expect(gate(findings).errors).toEqual([]);
    },
  );

  it.each(["FoodResolutionDecision", "Resolution", null])(
    "blocks nested literal identity regardless of the decision annotation %s",
    annotation => {
      const typeImport = annotation === "Resolution"
        ? "FoodResolutionDecision as Resolution" : "FoodResolutionDecision";
      const findings = inspect(`
        import type { ${typeImport} } from "./schemas";
        export function resolveFoodObservation(seed: ${annotation ?? "FoodResolutionDecision"}) {
          const foodDecision${annotation ? ": " + annotation : ""} = {
            ...seed, identity: { ...seed.identity, canonicalName: "banana" },
          };
          return foodDecision;
        }
      `);
      expect(findings.some(item => item.ruleId === "17")).toBe(true);
      expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
    },
  );

  it.each([path, "server/modules/foodCatalog.ts"])(
    "blocks literal food lists hidden behind a homonymous type in %s",
    sourcePath => {
      const findings = inspect(`
        type FoodResolutionDecision = readonly string[];
        export const FOOD_ALIASES: FoodResolutionDecision = ["banana", "arroz"];
      `, sourcePath);
      expect(findings.some(item => item.ruleId === "17")).toBe(true);
      expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
    },
  );

  it("inspects nested collections and literal spreads in a typed decision", () => {
    const findings = inspect(`
      import type { FoodResolutionDecision } from "./schemas";
      export function resolveFoodObservation(seed: FoodResolutionDecision) {
        const foodDecision: FoodResolutionDecision = {
          ...seed,
          identity: { ...seed.identity, ...{ canonicalName: "banana" } },
          alternatives: [{ ...seed.identity, aliases: ["banana", "arroz"] }],
        };
        return foodDecision;
      }
    `);
    expect(findings.some(item => item.ruleId === "17")).toBe(true);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it("does not treat a local literal or a shadowed parameter as runtime provenance", () => {
    for (const declaration of [
      'const seed = { identity: { canonicalName: "banana" } };',
      'const { value: seed } = { value: { identity: { canonicalName: "banana" } } };',
    ]) {
      const findings = inspect(`
        export function resolveFoodObservation(seed: unknown) {
          {
            ${declaration}
            const foodDecision = { ...seed, identity: { ...seed.identity } };
            return foodDecision;
          }
        }
      `);
      expect(findings.some(item => item.ruleId === "17")).toBe(true);
      expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
    }
  });

  it.each([
    'seed = { ...seed, identity: { ...seed.identity, canonicalName: "banana" } };',
    'seed.identity.canonicalName = "banana";',
    '{ seed.identity.canonicalName = "banana"; }',
    'if (seed) seed.identity.canonicalName = "banana";',
    'Object.assign(seed.identity, { canonicalName: "banana" });',
    'const alias = seed; alias.identity.canonicalName = "banana";',
    'const { identity } = seed; identity.canonicalName = "banana";',
    'function mutate(value: any) { value.identity.canonicalName = "banana"; } mutate(seed);',
  ])("does not exempt a parameter after a mutation or escape: %s", mutation => {
    const findings = inspect(`
      export function resolveFoodObservation(seed: any) {
        ${mutation}
        const foodDecision = { ...seed, identity: { ...seed.identity } };
        return foodDecision;
      }
    `);
    expect(findings.some(item => item.ruleId === "17")).toBe(true);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it.each([
    '{ value = (seed.identity.canonicalName = "banana") }: { value?: string }',
    '[value = (seed.identity.canonicalName = "banana")]: [string?]',
    '{ [seed.identity.canonicalName = "banana"]: value }: Record<string, string>',
  ])("does not exempt mutations inside a parameter binding: %s", binding => {
    const findings = inspect(`
      export function resolveFoodObservation(seed: any, ${binding}) {
        const foodDecision = { ...seed, identity: { ...seed.identity } };
        return foodDecision;
      }
    `);
    expect(findings.some(item => item.ruleId === "17")).toBe(true);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it.each([
    'seed.nutrition.calories = 100;',
    'foodDecision.identity.canonicalName = "banana";',
    'mutate(foodDecision);',
  ])("does not exempt writes or escapes after the projection: %s", mutation => {
    const findings = inspect(`
      export function resolveFoodObservation(seed: any) {
        const foodDecision = { ...seed, identity: { ...seed.identity } };
        ${mutation}
        return foodDecision;
      }
    `);
    expect(findings.some(item => item.ruleId === "17")).toBe(true);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it.each([
    ["status", "integral"], ["origin", "banana"], ["field", "fatia"],
    ["nextAction", "banana"],
  ])("keeps food literals in metadata-looking %s fields gated", (field, literal) => {
    const envelope = inspect(`
      export function resolveFoodObservation(seed: unknown) {
        const foodDecision = { ...seed, ${field}: "${literal}" };
        return foodDecision;
      }
    `);
    expect(envelope.some(item => item.ruleId === "17")).toBe(true);
    expect(gate(envelope).errors.some(error => error.includes("gate 17"))).toBe(true);
    const comparison = inspect(`
      export function resolveFoodObservation(seed: unknown) {
        return seed.${field} === "${literal}";
      }
    `);
    expect(comparison.some(item => item.ruleId === "18")).toBe(true);
    expect(gate(comparison).errors.some(error => error.includes("gate 18"))).toBe(true);
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

  const contractsPath = "server/modules/foodIntelligenceV2/contracts.ts";
  const reasonDeclaration = () => {
    const source = readFileSync(contractsPath, "utf8");
    const declaration = source.match(/export const FOOD_REASON_CODES = \[([\s\S]*?)\] as const;/)?.[0];
    if (!declaration) throw new Error("FOOD_REASON_CODES is absent from the canonical contract");
    return { source, declaration };
  };
  const inspectReasonMutation = (mutate: (declaration: string) => string) => {
    const { source, declaration } = reasonDeclaration();
    return findFoodStaticCandidates([{
      path: contractsPath, content: source.replace(declaration, mutate(declaration)),
    }]).filter(item => item.ruleId === "17" && item.symbol === "FOOD_REASON_CODES");
  };

  it("exempts only the unchanged governed reason-code vocabulary", () => {
    const { source } = reasonDeclaration();
    const findings = findFoodStaticCandidates([{ path: contractsPath, content: source }]);
    expect(findings.filter(item => item.ruleId === "17" &&
      item.symbol === "FOOD_REASON_CODES")).toEqual([]);
    expect(inspectReasonMutation(declaration => declaration.replace(
      '"brand_variant_unresolved",\n  "commercial_identity_unverified"',
      '"commercial_identity_unverified",\n  "brand_variant_unresolved"',
    ))).toEqual([]);
  });

  it.each([
    "banana_unresolved", "arroz_unresolved", "banana_unverified",
    "banana_missing", "banana_unproven", "banana_conflict",
    "banana_unavailable", "banana_failed", "banana_locale",
    "banana_surface", "banana_evidence", "banana_version",
    "banana_calibrated", "banana",
  ])("blocks a food name hidden inside a reason-code suffix: %s", added => {
    const findings = inspectReasonMutation(declaration => declaration.replace(
      "] as const;", `  "${added}",\n] as const;`,
    ));
    expect(findings).toHaveLength(1);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it.each([
    ["unknown_surface", "banana_surface"],
    ["source_conflict", "arroz_conflict"],
    ["provider_unavailable", "banana_unavailable"],
  ])("blocks a replaced operational reason %s => %s", (original, replacement) => {
    const findings = inspectReasonMutation(declaration => declaration.replace(
      `"${original}"`, `"${replacement}"`,
    ));
    expect(findings).toHaveLength(1);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it("does not exempt a duplicated or silently removed canonical reason", () => {
    for (const mutate of [
      (declaration: string) => declaration.replace('  "unknown_surface",\n', ""),
      (declaration: string) => declaration.replace('"unknown_surface"', '"non_food"'),
    ]) {
      const findings = inspectReasonMutation(mutate);
      expect(findings).toHaveLength(1);
      expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
    }
  });

  it("still flags a real food alias even if it looks like an operational reason", () => {
    const findings = findFoodStaticCandidates([{
      path: contractsPath,
      content: 'export const FOOD_ALIASES = ["banana_unresolved", "arroz_unresolved"] as const;',
    }]);
    expect(findings.some(item => item.ruleId === "17" &&
      item.symbol === "FOOD_ALIASES")).toBe(true);
    expect(gate(findings).errors.some(error => error.includes("gate 17"))).toBe(true);
  });

  it("the real source has no new static-food architecture findings", () => {
    const findings = inspect(readFileSync(path, "utf8"));
    expect(findings.filter(item => ["1", "2", "17", "18"].includes(item.ruleId))).toEqual([]);
  });
});
