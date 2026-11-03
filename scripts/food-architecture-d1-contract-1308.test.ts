/** #1308: discriminating architecture gates for technical D1 contracts. */
import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const path = "server/modules/foodIntelligenceV2/entrypointMigration.ts";
const check = (content: string, file = path) => findFoodStaticCandidates([{path: file, content}]);
const issues = (content: string, rule: string, file = path) =>
  check(content, file).filter(f => f.ruleId === rule);
const gate = (content: string, file = path) =>
  evaluateFoodArchitectureGate(check(content, file), [], [],
    new Date("2026-11-02T00:00:00Z")).errors;

describe("#1308 typed operation states remain separate from food lexemes", () => {
  const states = '["text", "audio_transcript", "addition", "edit", "plate_image", "packaging", "nutrition_label", "continuation", "simulator"] as const';
  it("accepts only the complete nine-state technical entrypoint contract", () => {
    expect(issues(`export const FOOD_D1_ENTRYPOINTS = ${states};`, "17")).toEqual([]);
    expect(issues(`export const FOOD_D1_ENTRYPOINTS = ${states.replace('"simulator"', '"banana"')};`, "17")
      .length).toBeGreaterThan(0);
  });
  it("accepts exact D1 enum fields but still blocks real materiality claims", () => {
    const good = `
      function prepareFood(input: any, item: any) {
        return input.entrypoint === "nutrition_label" ||
          item.disposition === "deferred" || input.source === "whatsapp";
      }
    `;
    expect(issues(good,"18", "server/modules/foodIntelligenceV2/entrypointPersistence.ts")).toEqual([]);
    const bad = `
      function decideMateriality(input: any) {
        return input.entrypoint === "banana" || input.source === "light";
      }
    `;
    expect(issues(bad,"18", "server/modules/foodIntelligenceV2/entrypointPersistence.ts").length)
      .toBeGreaterThan(0);
    expect(gate(bad,"server/modules/foodIntelligenceV2/entrypointPersistence.ts")
      .some(e => e.includes("gate 18"))).toBe(true);
  });
  it("treats a typed public D1 entrypoint state as structure, not food materiality", () => {
    const file = "server/modules/foodIntelligenceV2/entrypointRouting.ts";
    const valid = `
      function routeFoodD1Operation(request: { entrypoint: "continuation" | "text" }, pin: unknown) {
        return !pin && request.entrypoint === "continuation";
      }
    `;
    const unsafe = valid.replace('=== "continuation"', '=== "light"');
    expect(issues(valid, "18", file)).toEqual([]);
    expect(issues(unsafe, "18", file).length).toBeGreaterThan(0);
  });
  it("does not mistake typed, independent version pinning for a food lexicon", () => {
    const file = "server/modules/foodIntelligenceV2/entrypointPersistenceRepository.ts";
    const valid = `
      function commitFoodD1NativeWrite(revisions: { code: string; knowledge: string },
        plan: { revisions: { code: string; knowledge: string } }) {
        return revisions.code !== plan.revisions.code ||
          revisions.knowledge !== plan.revisions.knowledge;
      }
    `;
    expect(issues(valid, "18", file)).toEqual([]);
    const unsafe = `
      function commitFoodD1NativeWrite(input: { nutrition: string }) {
        return ["integral", "diet"].includes(input.nutrition);
      }
    `;
    expect(issues(unsafe, "18", file).length).toBeGreaterThan(0);
  });
  it("retains food regex detection while accepting strict ID patterns", () => {
    const good = `
      function prepareFood(input: string) {
        return /^[1-9]\\d*$/.test(input) && /^[a-f0-9]{40}$/i.test(input);
      }
    `;
    expect(issues(good,"17")).toEqual([]);
    const bad = `
      function resolveFoodName(input: string) {
        return /sem\\s+açúcar/i.test(input);
      }
    `;
    expect(issues(bad,"17").length).toBeGreaterThan(0);
  });
  it("allows the canonical typed observation loop, not textual re-inference", () => {
    const canonical = `
      import { resolveFoodObservation } from "./resolver";
      async function readObservations(input: unknown): Promise<unknown[]> { return []; }
      export async function buildD1OperationPlan(deps: any) {
        const observations = await readObservations(deps);
        for (const observation of observations) {
          await resolveFoodObservation(observation, {
            previousDecision: deps.previousDecision,
          }, deps.knowledge);
        }
      }
    `;
    expect(issues(canonical,"3")).toEqual([]);
    const poisoned = canonical.replace(
      "resolveFoodObservation(observation, {",
      "resolveFoodObservation(JSON.stringify(deps.previousDecision), {");
    expect(issues(poisoned,"3").length).toBeGreaterThan(0);
    const foreign = canonical.replace('from "./resolver"', 'from "./legacy"');
    expect(issues(foreign,"3").length).toBeGreaterThan(0);
  });
});
