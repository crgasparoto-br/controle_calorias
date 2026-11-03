import { afterEach, describe, expect, it, vi } from "vitest";
import type { ManualMealInput } from "../meals/schemas";
import type { FoodD1Result } from "./entrypointMigration";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import { createFoodD1PublicManualAddition } from "./publicManualAddition";
import type { FoodD1CommitResult } from "./entrypointPersistenceRepository";
import type { runFoodD1Migration } from "./entrypointRunner";

const sha = "a".repeat(40);
const approved: AuthorizedD1SimulationContext = {
  expectedAuditedBaseSha: sha,
  approval: { status: "approved", auditedBaseSha: sha,
    gateAReference: "gate-a-tested-reference", rolloutReference: "rollout-tested-reference" },
  revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
};
const meal = (): ManualMealInput => ({
  mealLabel: "Almoço", occurredAt: "2026-11-03T15:00:00.000Z",
  d1OperationId: "manual-submission-1",
  items: [{
    foodName: "arroz", canonicalName: "arroz", portionText: "100 g",
    quantity: 100, unit: "g", servings: 1, estimatedGrams: 100,
    calories: 9999, protein: 999, carbs: 999, fat: 999,
    confidence: 1, source: "heuristic",
  }],
});

afterEach(() => {
  delete process.env.FOOD_V2_D1_ENABLED;
  delete process.env.FOOD_V2_D1_ENTRYPOINTS;
});
describe("#1308 authenticated manual addition V2 boundary", () => {
  it("preserves existing V1 with flags OFF, without reading Gate A or the lexicon", async () => {
    const load = vi.fn(async () => []);
    const readAuthorizedContext = vi.fn(async () => null);
    const bridge = createFoodD1PublicManualAddition({
      readAuthorizedContext, lexicon: { load },
    });
    expect(await bridge({ userId: 7, meal: meal(), timeZone: "America/Sao_Paulo" })).toBeNull();
    expect(load).not.toHaveBeenCalled();
    expect(readAuthorizedContext).not.toHaveBeenCalled();
  });
  it("fails closed on selected flag without independent authority", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "addition";
    const load = vi.fn(async () => []);
    const bridge = createFoodD1PublicManualAddition({
      readAuthorizedContext: async () => null, lexicon: { load },
    });
    await expect(bridge({ userId: 7, meal: meal(), timeZone: "America/Sao_Paulo" }))
      .rejects.toThrow("food-d1-public-addition-gate-unavailable");
    expect(load).not.toHaveBeenCalled();
  });
  it("pins a server-owned structured request and never trusts client nutrition", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "addition";
    const calls: Array<Parameters<typeof runFoodD1Migration>[0]> = [];
    const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      calls.push(args);
      expect(args.request.authenticatedUserId).toBe(7);
      expect(args.request.envelope.mealOperation?.targetMeal).toBe("Almoço");
      expect(args.request.envelope.mealOperation?.date).toBe("2026-11-03");
      expect(args.request.evidence.kind).toBe("structured");
      if (args.request.evidence.kind === "structured") {
        expect(args.request.evidence.observations).toHaveLength(1);
        expect(args.request.evidence.observations[0].evidence.every(e => !e.verified)).toBe(true);
        expect(JSON.stringify(args.request.evidence)).not.toContain("9999");
      }
      const plan = {
        items: [{ disposition: "ready" }],
      } as FoodD1Result;
      args.beforeCommit?.(plan);
      return { committed: true, operationKey: args.request.envelope.idempotencyKey,
        mealId: 123, recordedItemIds: [456], skipped: [] } satisfies FoodD1CommitResult;
    });
    const bridge = createFoodD1PublicManualAddition({
      readAuthorizedContext: async () => approved,
      lexicon: { load: async () => [] },
      run: run as unknown as typeof runFoodD1Migration,
    });
    expect(await bridge({ userId: 7, meal: meal(), timeZone: "America/Sao_Paulo" })).toBe(123);
    expect(calls).toHaveLength(1);
    const repeated = await bridge({ userId: 7, meal: meal(), timeZone: "America/Sao_Paulo" });
    expect(repeated).toBe(123);
    expect(calls[1].request.envelope.idempotencyKey).toBe(calls[0].request.envelope.idempotencyKey);
  });
  it("rejects unresolved siblings before any native write", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "addition";
    const runner = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      args.beforeCommit?.({ items: [{ disposition: "ready" }, { disposition: "deferred" }] } as FoodD1Result);
      throw new Error("unreachable-native-write");
    });
    const bridge = createFoodD1PublicManualAddition({
      readAuthorizedContext: async () => approved, lexicon: { load: async () => [] },
      run: runner as unknown as typeof runFoodD1Migration,
    });
    const two = meal();
    two.items.push({ ...two.items[0], foodName: "pão", canonicalName: "pão" });
    await expect(bridge({ userId: 7, meal: two, timeZone: "America/Sao_Paulo" }))
      .rejects.toThrow("food-d1-public-addition-needs-clarification");
    expect(runner).toHaveBeenCalledOnce();
  });
  it("requires a stable client operation ID before any resolution", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "addition";
    const run = vi.fn();
    const bridge = createFoodD1PublicManualAddition({
      readAuthorizedContext: async () => approved, lexicon: { load: async () => [] },
      run: run as unknown as typeof runFoodD1Migration,
    });
    await expect(bridge({ userId: 7, meal: { ...meal(), d1OperationId: undefined },
      timeZone: "America/Sao_Paulo" })).rejects.toThrow("stable-operation-required");
    expect(run).not.toHaveBeenCalled();
  });
});
