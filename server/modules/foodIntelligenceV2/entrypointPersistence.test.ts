import { describe, expect, it } from "vitest";
import { buildFoodOperationEnvelopeFixture, buildFoodResolutionDecisionFixture } from "./fixtures";
import { prepareFoodD1NativeWrite } from "./entrypointPersistence";
import { commitFoodD1NativeWrite } from "./entrypointPersistenceRepository";
import { hashFoodD1OperationScope } from "./entrypointRouting";
import type { FoodD1Result } from "./entrypointMigration";
import type { FoodOperationEnvelope, FoodResolutionDecision } from "./schemas";

const envelope = () => buildFoodOperationEnvelopeFixture() as FoodOperationEnvelope;
const decision = (overrides: unknown = {}) => buildFoodResolutionDecisionFixture({
  ownerUserId: 7, identity: { variantId: 102, variant: "Mortadela" },
  ...overrides as object,
}) as FoodResolutionDecision;
const result = (d = decision()): FoodD1Result => ({
  schemaVersion: 2, operationKey: "op-1", traceId: "trace-1", entrypoint: "addition",
  committed: false, registeredCount: 0, readyCount: 1, skippedCount: 0,
  items: [{ observationId: "obs-1", mealItemId: null, decision: d,
    disposition: "ready", reasonCodes: [] }],
});
const prepare = (overrides: Partial<Parameters<typeof prepareFoodD1NativeWrite>[0]> = {}) =>
  prepareFoodD1NativeWrite({ envelope: envelope(), result: result(),
    authenticatedUserId: 7, source: "whatsapp",
    occurredAt: new Date("2026-10-05T12:00:00Z"), ...overrides });

describe("#1308 D1 native write preparation (synthetic, no real runtime proof)", () => {
  it("retains real verified macros and physical grams without V1 serialization", () => {
    const output = prepare();
    expect(output.items).toHaveLength(1);
    expect(output.items[0].values.estimatedGrams).toBe(30);
    expect(output.items[0].values.calories).toBe(81);
    expect(output.items[0].values.foodCatalogId).toBeNull();
    expect(output.items[0].values.foodVariantId).toBe(102);
    expect(JSON.parse(output.items[0].values.foodSnapshotJson).nutrition.verified).toBe(true);
    expect(output.confidence).toBe(0.9);
    expect(output.requestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(output.operationScopeHash).toBe(hashFoodD1OperationScope(envelope(), "whatsapp"));
    expect(output.items[0].values.foodSnapshotJson).not.toContain("rawInput");
  });

  it("fails closed for unverified nutrition, absent variants, missing grams and provenance", () => {
    for (const invalid of [
      { nutrition: { verified: false, provisional: true } },
      { identity: { variantId: null } },
      { quantity: { grams: null, milliliters: 100 } },
      { nutrition: { snapshotHash: null } },
    ]) {
      const poisoned = decision({ ...invalid, identity: {
        variantId: 102, variant: "Mortadela", ...invalid.identity,
      } });
      expect(() => prepare({ result: result(poisoned) })).toThrow();
    }
  });

  it("rejects cross-owner, wrong meal date and tampered idempotency result", () => {
    expect(() => prepare({ authenticatedUserId: 8 })).toThrow("native-meal-operation");
    expect(() => prepare({ occurredAt: new Date("2026-10-06T12:00:00Z") }))
      .toThrow("native-meal-operation");
    expect(() => prepare({ result: { ...result(), registeredCount: 1 } }))
      .toThrow("native-decision-batch");
    expect(() => prepare({ result: { ...result(), operationKey: "foreign" } }))
      .toThrow("native-decision-batch");
  });

  it("requires physical targets for edits and newly verified nutrition for labels", () => {
    expect(() => prepare({ result: { ...result(), entrypoint: "edit" } }))
      .toThrow("item-action-mismatch");
    // The default fixture includes a verified label; strip just its label origin.
    const noLabelProof = decision({ evidence: [{}, {}, { origin: "catalog" }] });
    expect(() => prepare({ result: { ...result(noLabelProof),
      entrypoint: "nutrition_label",
      items: [{ ...result(noLabelProof).items[0], mealItemId: "100" }] } }))
      .toThrow("label-not-verified");
    const positive = prepare({ result: { ...result(), entrypoint: "nutrition_label",
      items: [{ ...result().items[0], mealItemId: "100" }] } });
    expect(positive.items[0].targetItemId).toBe(100);
  });

  it("keeps unresolved siblings in the result without recording them", () => {
    const other = { observationId: "obs-2", mealItemId: null,
      decision: decision({ observationIds: ["obs-2"] }),
      disposition: "deferred" as const, reasonCodes: ["needs_quantity"] };
    const output = prepare({ result: { ...result(), skippedCount: 1,
      items: [...result().items, other] } });
    expect(output.items).toHaveLength(1);
    expect(output.skipped).toEqual([{ observationId: "obs-2",
      reasonCodes: ["needs_quantity"] }]);
  });

  it("prevents writes when rollout gate is revoked before any DB access", async () => {
    const plan = prepare();
    await expect(commitFoodD1NativeWrite({ plan, testEnabled: true,
      verifyCurrentGate: async () => false })).rejects.toThrow("rollout-gate-revoked");
    await expect(commitFoodD1NativeWrite({ plan, testEnabled: true,
      verifyCurrentGate: async () => { throw new Error("down"); } }))
      .rejects.toThrow("rollout-gate-revoked");
  });
});
