import { describe, expect, it } from "vitest";
import { findFoodStaticCandidates } from "./food-intelligence-architecture";
import { evaluateFoodArchitectureGate } from "./food-architecture-enforcement";

const gate10 = (files: Array<{path: string; content: string}>) =>
  findFoodStaticCandidates(files).filter(finding => finding.ruleId === "10");

describe("AUD1300 gate 10: proven inert edge vs competing resolver", () => {
  it("does not confuse a provably inert status dependency with a competing food owner", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/statusHandler.ts",
        content: 'import { getStatus } from "../../db"; export function isReady() { return getStatus() === "ready"; }'},
      {path: "server/db.ts",
        content: 'import { noop } from "./nutritionEngine"; export function getStatus() { noop(); return "ready"; }'},
      {path: "server/nutritionEngine.ts", content: "export function noop() { return null; }"},
    ]);
    expect(findings).toEqual([]);
  });

  it("blocks a real resolver behind named reexports and a neutral bridge", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/service.ts",
        content: "import { lookup } from './bridge'; export { lookup };"},
      {path: "server/modules/whatsapp/bridge.ts",
        content: "export { lookup } from '../../foodItemResolution';"},
      {path: "server/foodItemResolution.ts", content: "export function lookup() { return null; }"},
    ]);
    expect(findings.some(f => f.file === "server/modules/whatsapp/service.ts" &&
      f.symbol.includes("transitive-import:server/foodItemResolution.ts"))).toBe(true);
    expect(evaluateFoodArchitectureGate(findings, [], [], new Date("2026-10-16T00:00:00Z"))
      .errors.length).toBeGreaterThan(0);
  });

  it("does not exempt a noop alias that actually returns nutritional decisions", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/service.ts",
        content: "export { lookup } from './bridge';"},
      {path: "server/modules/whatsapp/bridge.ts",
        content: "export { noop as lookup } from '../../nutritionEngine';"},
      {path: "server/nutritionEngine.ts",
        content: "export function noop() { return { calories: 150, protein: 6, carbs: 15 }; }"},
    ]);
    expect(findings.some(f => f.file === "server/modules/whatsapp/service.ts" &&
      f.symbol.includes("nutritionEngine.ts"))).toBe(true);
  });

  it("keeps blocking when the imported module has top-level side effects", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/service.ts",
        content: "export { run } from './bridge';"},
      {path: "server/modules/whatsapp/bridge.ts",
        content: "export { noop as run } from '../../nutritionEngine';"},
      {path: "server/nutritionEngine.ts",
        content: "export function noop(){return null;} initializeResolver();"},
    ]);
    expect(findings.some(f => f.file === "server/modules/whatsapp/service.ts" &&
      f.symbol.includes("nutritionEngine.ts"))).toBe(true);
  });

  it("does not lose a real transitive edge when an inert route reaches the same target first", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/service.ts",
        content: "export { noop } from './inert'; export { lookup } from './active';"},
      {path: "server/modules/whatsapp/inert.ts",
        content: "export { noop } from '../../nutritionEngine';"},
      {path: "server/modules/whatsapp/active.ts",
        content: "export { lookup } from '../../nutritionEngine';"},
      {path: "server/nutritionEngine.ts",
        content: "export function noop(){return null;} export function lookup(){return null;}"},
    ]);
    expect(findings.some(f => f.file === "server/modules/whatsapp/service.ts" &&
      f.symbol.includes("nutritionEngine.ts"))).toBe(true);
  });

  it("continues to exempt exclusively type-only imports and reexports", () => {
    const findings = gate10([
      {path: "server/modules/whatsapp/service.ts",
        content: "import type { Lookup } from './bridge';"},
      {path: "server/modules/whatsapp/bridge.ts",
        content: "export type { Lookup } from '../../foodItemResolution';"},
      {path: "server/foodItemResolution.ts",
        content: "export type Lookup = string;"},
    ]);
    expect(findings).toEqual([]);
  });
});
