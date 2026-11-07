import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFoodResolutionDecisionFixture } from "./fixtures";
import { createFoodD1PublicNutritionLabel,
  type PublicD1NutritionLabelDependencies } from "./publicNutritionLabel";
import type { runFoodD1Migration } from "./entrypointRunner";

const sha = "c".repeat(40);
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const digest = createHash("sha256").update(bytes).digest("hex");
const image = { base64: bytes.toString("base64"), mimeType: "image/png" };
const originalDecision = buildFoodResolutionDecisionFixture({
  ownerUserId: 7, traceId: "original-trace-001",
  observationIds: ["obs-1"],
  identity: { foodEntityId: 42, variantId: 102, variant: "Mortadela" },
  quantity: { value: 1.5, unit: "fatia", grams: 30 },
  nutrition: { profileId: 7, sourceId: 3, verified: true },
});
const physical = {
  ownerUserId: 7, mealId: 44, mealItemId: 81,
  mealLabel: "almoço",
  occurredAt: new Date("2026-11-04T15:00:00.000Z"),
  variantId: 102, foodId: 42, profileId: 7,
  quantity: 1.5, unit: "fatia", grams: 30,
  decision: originalDecision, snapshotHash: "original-snapshot",
};
const proof = {
  sourceId: 3, profileId: 7, variantId: 102,
  contentDigest: digest, basisQuantity: 100,
  basisUnit: "g" as const,
  caloriesKcal: 270, proteinG: 12, carbG: 3, fatG: 23,
};
const request = () => ({
  userId: 7, timeZone: "America/Sao_Paulo",
  request: { d1OperationId: "label-000001", mealId: 44, mealItemId: 81, image },
});
function createDeps() {
  const readAuthorizedContext = vi.fn(async () => ({
    expectedAuditedBaseSha: sha,
    approval: { status: "approved" as const, auditedBaseSha: sha,
      gateAReference: "approved-gate-fixture", rolloutReference: "approved-rollout-fixture" },
    revisions: { code: sha, knowledge: "k1", lexicon: "l1", policy: "p1", resolver: "r1" },
  }));
  const readTarget = vi.fn(async () => physical);
  const readVerifiedSource = vi.fn(async () => proof);
  const run = vi.fn(async (args: Parameters<typeof runFoodD1Migration>[0]) => {
    expect(args.request.entrypoint).toBe("nutrition_label");
    expect(args.request.envelope.traceId).toBe("original-trace-001");
    expect(args.request.envelope.conversationRef).toBe("d1-label-image:" + digest);
    expect(args.request.targets).toMatchObject([{
      observationId: "obs-1", mealItemId: "81",
      previousDecision: originalDecision,
    }]);
    if (args.request.evidence.kind !== "structured") throw new Error("missing label facts");
    const [observation] = args.request.evidence.observations;
    expect(observation.rawInput).toBeNull();
    expect(observation.identityHints.foodName).toBe(originalDecision.identity.canonicalName);
    expect(observation.evidence.filter(item =>
      item.origin === "nutrition_label" && item.verified)).toHaveLength(4);
    args.beforeCommit?.({ items: [{
      observationId: "obs-1", disposition: "ready", mealItemId: "81",
      decision: { identity: { variantId: 102, foodEntityId: 42 },
        nutrition: { profileId: 7, sourceId: 3, verified: true },
        evidence: observation.evidence },
    }] } as never);
    return { committed: true, replayed: false,
      mealId: 44, operationKey: args.request.envelope.idempotencyKey,
      recordedItemIds: [81], skipped: [] };
  });
  return { readAuthorizedContext, readTarget, readVerifiedSource, run };
}
afterEach(() => vi.unstubAllEnvs());
describe("#1308 verified post-registration label bound to original V2 item", () => {
  it("does not call Gate A, database or provider with the label rollout OFF", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "false");
    const deps = createDeps();
    const service = createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    );
    expect(await service(request())).toBeNull();
    expect(deps.readTarget).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("uses one physical item and independently verified exact-image source", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "nutrition_label");
    const deps = createDeps();
    const result = await createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    )(request());
    expect(result).toEqual({ mealId: 44, itemId: 81, replayed: false });
    expect(deps.readVerifiedSource).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 7, variantId: 102, imageDigest: digest,
    }));
    expect(deps.run).toHaveBeenCalledOnce();
  });
  it("a missing Gate A blocks before reading any stored item or image", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "nutrition_label");
    const deps = { ...createDeps(), readAuthorizedContext: async () => null };
    await expect(createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    )(request())).rejects.toThrow("food-d1-label-gate-unavailable");
    expect(deps.readTarget).not.toHaveBeenCalled();
  });
  it("refuses a foreign physical item before consulting a source or writing", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "nutrition_label");
    const deps = createDeps();
    deps.readTarget.mockResolvedValueOnce({ ...physical, ownerUserId: 8 });
    await expect(createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    )(request())).rejects.toThrow("food-d1-label-physical-item-not-authorized");
    expect(deps.readVerifiedSource).not.toHaveBeenCalled();
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("does not promote OCR-only or hash-mismatched evidence to verified nutrition", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "nutrition_label");
    const deps = createDeps();
    deps.readVerifiedSource.mockResolvedValueOnce({
      ...proof, contentDigest: "d".repeat(64),
    });
    await expect(createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    )(request())).rejects.toThrow("food-d1-label-independent-verification-required");
    expect(deps.run).not.toHaveBeenCalled();
  });
  it("rejects a healthy-looking decision that belongs to another nutrition profile", async () => {
    vi.stubEnv("FOOD_V2_D1_ENABLED", "true");
    vi.stubEnv("FOOD_V2_D1_ENTRYPOINTS", "nutrition_label");
    const deps = createDeps();
    deps.run.mockImplementationOnce(async args => {
      args.beforeCommit?.({ items: [{
        observationId: "obs-1", disposition: "ready", mealItemId: "81",
        decision: { identity: { variantId: 102, foodEntityId: 42 },
          nutrition: { profileId: 999, sourceId: 3, verified: true },
          evidence: [] },
      }] } as never);
      throw new Error("unexpected write");
    });
    await expect(createFoodD1PublicNutritionLabel(
      deps as unknown as PublicD1NutritionLabelDependencies,
    )(request())).rejects.toThrow("food-d1-label-evidence-conflict-or-needs-review");
  });
});
