import { afterEach, describe, expect, it, vi } from "vitest";
import { createFoodD1PublicEdit } from "./publicEdit";
import type { AuthorizedD1SimulationContext } from "./publicSimulator";
import type { runFoodD1Migration } from "./entrypointRunner";
import type { UpdateMealItemInput } from "../meals/schemas";

const sha = "c".repeat(40);
const authorized: AuthorizedD1SimulationContext = {
  expectedAuditedBaseSha: sha,
  approval: { status: "approved", auditedBaseSha: sha,
    gateAReference: "gate-a-approved-fixture", rolloutReference: "rollout-approved-fixture" },
  revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
};
const request = (): UpdateMealItemInput => ({
  mealId: 90, itemIndex: 0, mealLabel: "Almoço", d1OperationId: "edit-req-0001",
  item: {
    foodName: "arroz", canonicalName: "arroz", portionText: "100 g",
    quantity: 100, unit: "g", servings: 1, estimatedGrams: 100,
    calories: 9999, protein: 999, carbs: 999, fat: 999,
    confidence: 1, source: "heuristic",
  },
});
const target = () => ({
  itemId: 501, mealId: 90, ownerUserId: 7,
  mealLabel: "Almoço", occurredAt: new Date("2026-11-03T15:00:00.000Z"),
});
afterEach(() => {
  delete process.env.FOOD_V2_D1_ENABLED;
  delete process.env.FOOD_V2_D1_ENTRYPOINTS;
});
describe("#1308 verified physical V2 item edit boundary", () => {
  it("never invokes V2 or DB while flag is off", async () => {
    const readTarget = vi.fn(async () => target());
    const readAuthorizedContext = vi.fn(async () => null);
    const bridge = createFoodD1PublicEdit({ readAuthorizedContext, readTarget });
    expect(await bridge({ userId: 7, request: request(), timeZone: "America/Sao_Paulo" })).toBeNull();
    expect(readTarget).not.toHaveBeenCalled();
    expect(readAuthorizedContext).not.toHaveBeenCalled();
  });
  it("fails closed if Gate A is unavailable before inspecting legacy or physical items", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "edit";
    const readTarget = vi.fn(async () => target());
    const bridge = createFoodD1PublicEdit({ readAuthorizedContext: async () => null, readTarget });
    await expect(bridge({ userId: 7, request: request(), timeZone: "America/Sao_Paulo" }))
      .rejects.toThrow("food-d1-public-edit-gate-unavailable");
    expect(readTarget).not.toHaveBeenCalled();
  });
  it("does not re-resolve old V1 physical items through a made-up V2 profile", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "edit";
    const bridge = createFoodD1PublicEdit({
      readAuthorizedContext: async () => authorized,
      readTarget: async () => null, lexicon: { load: async () => [] },
    });
    expect(await bridge({ userId: 7, request: request(), timeZone: "America/Sao_Paulo" })).toBeNull();
  });
  it("rejects a mismatched physical meal before any nutrition interpretation", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "edit";
    const lexicon = { load: vi.fn(async () => []) };
    const bridge = createFoodD1PublicEdit({
      readAuthorizedContext: async () => authorized,
      readTarget: async () => ({ ...target(), ownerUserId: 8 }), lexicon,
    });
    await expect(bridge({ userId: 7, request: request(), timeZone: "America/Sao_Paulo" }))
      .rejects.toThrow("food-d1-public-edit-target-scope-mismatch");
    expect(lexicon.load).not.toHaveBeenCalled();
  });
  it("keeps same physical target and rejects undecided change before commit", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    process.env.FOOD_V2_D1_ENTRYPOINTS = "edit";
    const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
      const targetInRun = args.request.targets?.[0];
      expect(targetInRun?.mealItemId).toBe("501");
      expect(args.request.envelope.mealOperation?.targetMeal).toBe("Almoço");
      expect(args.request.envelope.mealOperation?.date).toBe("2026-11-03");
      expect(JSON.stringify(args.request.evidence)).not.toContain("9999");
      args.beforeCommit?.({ items: [{ disposition: "deferred", mealItemId: "501" }] } as never);
      throw new Error("unreachable-writer");
    });
    const bridge = createFoodD1PublicEdit({
      readAuthorizedContext: async () => authorized,
      readTarget: async () => target(), lexicon: { load: async () => [] },
      run: run as unknown as typeof runFoodD1Migration,
    });
    await expect(bridge({ userId: 7, request: request(), timeZone: "America/Sao_Paulo" }))
      .rejects.toThrow("food-d1-public-edit-needs-clarification");
    expect(run).toHaveBeenCalledOnce();
  });
});
