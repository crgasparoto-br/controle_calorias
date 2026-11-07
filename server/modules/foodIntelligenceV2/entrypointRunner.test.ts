import { afterEach, describe, expect, it, vi } from "vitest";
import { buildFoodOperationEnvelopeFixture } from "./fixtures";
import { runFoodD1Migration } from "./entrypointRunner";
import type { FoodD1Dependencies, FoodD1Request } from "./entrypointMigration";
import type { FoodOperationEnvelope } from "./schemas";

const originalFlag = process.env.FOOD_V2_D1_ENABLED;
afterEach(() => {
  if (originalFlag === undefined) delete process.env.FOOD_V2_D1_ENABLED;
  else process.env.FOOD_V2_D1_ENABLED = originalFlag;
});

const request = (): FoodD1Request => ({
  authenticatedUserId: 7,
  entrypoint: "simulator",
  envelope: buildFoodOperationEnvelopeFixture() as FoodOperationEnvelope,
  evidence: {
    kind: "surface", modality: "text", rawText: "1,5 fatias de mortadela",
    sourceRef: "synthetic-simulator:1",
  },
  now: new Date("2026-11-01T12:00:00Z"),
});
function dependencies(): FoodD1Dependencies {
  return {
    lexicon: { load: vi.fn(async () => []) },
    knowledge: {
      readLocal: vi.fn(async () => ({ kind: "miss" as const, reason: "not_found" as const })),
      readPendingEvidence: vi.fn(async () => null),
      stagePendingEvidence: vi.fn(async () => {
        throw new Error("simulation must not stage evidence");
      }),
    },
    authorizeEvidence: vi.fn(async () => true),
    authorizeExistingItem: vi.fn(async () => true),
  };
}
const sha = "a".repeat(40);
const approved = {
  status: "approved" as const,
  gateAReference: "fixture:approved-gate-a",
  rolloutReference: "fixture:approved-rollout",
  auditedBaseSha: sha,
};
function scenario() {
  const deps = dependencies();
  const legacy = vi.fn(async () => ({ legacy: true }));
  return {
    request: request(), source: "whatsapp" as const,
    occurredAt: new Date("2026-10-05T12:00:00Z"),
    dependencies: deps, legacy, expectedAuditedBaseSha: sha,
    verifyGates: vi.fn(async () => approved),
  };
}

describe("#1308 simulator runner uses the same V2 resolver without any meal effect", () => {
  it("preserves the original simulator with the production flag off", async () => {
    delete process.env.FOOD_V2_D1_ENABLED;
    const input = scenario();
    expect(await runFoodD1Migration(input)).toEqual({ legacy: true });
    expect(input.legacy).toHaveBeenCalledTimes(1);
    expect(input.verifyGates).not.toHaveBeenCalled();
    expect(input.dependencies.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("rejects V2 when the independently certified gate is unavailable", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    const input = scenario();
    input.verifyGates.mockResolvedValueOnce(null as never);
    await expect(runFoodD1Migration(input)).rejects.toThrow("independent-gates-not-approved");
    expect(input.legacy).not.toHaveBeenCalled();
    expect(input.dependencies.knowledge.readLocal).not.toHaveBeenCalled();
  });

  it("runs only the V2 decision path after an injected test gate, never persists", async () => {
    process.env.FOOD_V2_D1_ENABLED = "true";
    const input = scenario();
    const response = await runFoodD1Migration(input);
    expect(response).toMatchObject({
      schemaVersion: 2, entrypoint: "simulator",
      committed: false, registeredCount: 0,
    });
    expect(input.legacy).not.toHaveBeenCalled();
    expect(input.dependencies.knowledge.readLocal).toHaveBeenCalled();
    expect(input.dependencies.knowledge.stagePendingEvidence).not.toHaveBeenCalled();
  });
});
